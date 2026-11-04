// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// DailyLedger: the public record of Portalsweeper's daily boards on Portaldot V3 (EVM side).
//
// Each day the game's server hides a secret (the "salt") that decides the board. Before anyone plays,
// the server posts the salt's fingerprint here. After the day ends the salt is revealed and THIS CONTRACT
// checks that it really matches the fingerprint, so the board cannot have been changed after the fact.
// The fingerprint is keccak256 of the salt as 32 bytes (the same rule the game uses off chain).
//
// What is trustless: the fingerprint is fixed before play, and a reveal that does not match is refused.
// What is not: the writer (the game's server wallet) chooses what to commit and who to record as winner.
// Anyone can reveal, because the contract checks the secret itself.
contract DailyLedger {
    struct Day {
        bytes32 commit;       // keccak256 of the 32 salt bytes, posted before play
        uint64 committedAt;   // timestamp of the commit
        bytes32 chainRandom;  // random number the chain made after the commit (0 if none was used)
        uint64 randomBlock;   // block that random number was read from
        bool revealed;
    }

    address public immutable writer;
    mapping(uint32 => Day) private records; // key is the date as a number, 2026-11-05 is 20261105

    event Committed(uint32 indexed day, bytes32 commit);
    event RandomnessSet(uint32 indexed day, bytes32 chainRandom, uint64 randomBlock);
    event Revealed(uint32 indexed day, bytes32 salt);
    event Winner(uint32 indexed day, uint16 portal, address winner, bytes32 moveLogHash);

    error NotWriter();
    error AlreadySet();
    error NotCommitted();
    error WrongSalt();
    error NotRevealed();

    constructor(address _writer) {
        writer = _writer;
    }

    modifier onlyWriter() {
        if (msg.sender != writer) revert NotWriter();
        _;
    }

    // Post the fingerprint before play. One time only per day.
    function commit(uint32 day, bytes32 fingerprint) external onlyWriter {
        if (records[day].commit != bytes32(0)) revert AlreadySet();
        records[day].commit = fingerprint;
        records[day].committedAt = uint64(block.timestamp);
        emit Committed(day, fingerprint);
    }

    // Record the chain's own random number (read from the native side at a named block after the commit).
    // Must happen before the reveal, one time only. The contract cannot read that number itself on this
    // chain, so a reader checks it against the chain at `randomBlock`.
    function setRandomness(uint32 day, bytes32 chainRandom, uint64 randomBlock) external onlyWriter {
        Day storage d = records[day];
        if (d.commit == bytes32(0)) revert NotCommitted();
        if (d.revealed || d.randomBlock != 0) revert AlreadySet();
        d.chainRandom = chainRandom;
        d.randomBlock = randomBlock;
        emit RandomnessSet(day, chainRandom, randomBlock);
    }

    // Reveal the salt. Anyone may call this. It only works if the salt matches the fingerprint.
    function reveal(uint32 day, bytes32 salt) external {
        Day storage d = records[day];
        if (d.commit == bytes32(0)) revert NotCommitted();
        if (d.revealed) revert AlreadySet();
        if (keccak256(abi.encodePacked(salt)) != d.commit) revert WrongSalt();
        d.revealed = true;
        emit Revealed(day, salt);
    }

    // Record who won a day and the fingerprint of their move log. Only after the day was revealed.
    function recordWinner(uint32 day, uint16 portal, address winner, bytes32 moveLogHash) external onlyWriter {
        if (!records[day].revealed) revert NotRevealed();
        emit Winner(day, portal, winner, moveLogHash);
    }

    function getDay(uint32 day) external view returns (bytes32 commit_, uint64 committedAt, bytes32 chainRandom, uint64 randomBlock, bool revealed) {
        Day storage d = records[day];
        return (d.commit, d.committedAt, d.chainRandom, d.randomBlock, d.revealed);
    }

    // True if `salt` is the secret behind that day's fingerprint, revealed or not. A read only check.
    function matches(uint32 day, bytes32 salt) external view returns (bool) {
        bytes32 c = records[day].commit;
        return c != bytes32(0) && keccak256(abi.encodePacked(salt)) == c;
    }
}
