// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// StakeEscrow: holds the tPOT stakes of Portalsweeper PvP matches on Portaldot V3 (EVM side).
//
// Each match has an id (keccak256 of the challenge id). One player opens it with their stake and a deadline,
// the second player joins with the same amount. Then the referee (the game's server wallet) names the winner
// and the contract pays the whole pot to that player. If the match is a draw the referee can refund both.
// If the referee never settles, ANYONE can refund both players once the deadline has passed.
//
// What is trustless: the pot sits in this contract, not in a person's wallet. The referee can only pay one
// of the two players in that match, never itself. After the deadline the players always get their own stake back.
// What is not: before the deadline the referee decides who wins, as the game server runs the match.
contract StakeEscrow {
    enum Status { None, Open, Locked, Settled, Refunded }

    struct Match {
        address creator;
        address opponent;
        uint128 amount;     // each player's stake, in wei
        uint64 deadline;    // after this time anyone can refund
        Status status;
    }

    address public immutable referee;
    mapping(bytes32 => Match) private matches_;

    event Created(bytes32 indexed id, address indexed creator, uint256 amount, uint64 deadline);
    event Joined(bytes32 indexed id, address indexed opponent, uint256 amount);
    event Settled(bytes32 indexed id, address indexed winner, uint256 pot);
    event Refunded(bytes32 indexed id, address indexed player, uint256 amount);

    error NotReferee();
    error Exists();
    error BadState();
    error BadAmount();
    error BadDeadline();
    error NotAPlayer();
    error TooEarly();
    error SendFailed();

    constructor(address _referee) {
        referee = _referee;
    }

    // Open a match with your stake. The deadline is a timestamp in the future.
    function create(bytes32 id, uint64 deadline) external payable {
        if (matches_[id].status != Status.None) revert Exists();
        if (msg.value == 0 || msg.value > type(uint128).max) revert BadAmount();
        if (deadline <= block.timestamp) revert BadDeadline();
        matches_[id] = Match(msg.sender, address(0), uint128(msg.value), deadline, Status.Open);
        emit Created(id, msg.sender, msg.value, deadline);
    }

    // Join an open match with exactly the same stake.
    function join(bytes32 id) external payable {
        Match storage m = matches_[id];
        if (m.status != Status.Open) revert BadState();
        if (msg.sender == m.creator) revert NotAPlayer();
        if (msg.value != m.amount) revert BadAmount();
        if (block.timestamp > m.deadline) revert BadState();
        m.opponent = msg.sender;
        m.status = Status.Locked;
        emit Joined(id, msg.sender, msg.value);
    }

    // The referee names the winner. The whole pot goes to that player.
    function settle(bytes32 id, address winner) external {
        if (msg.sender != referee) revert NotReferee();
        Match storage m = matches_[id];
        if (m.status != Status.Locked) revert BadState();
        if (winner != m.creator && winner != m.opponent) revert NotAPlayer();
        uint256 pot = uint256(m.amount) * 2;
        m.status = Status.Settled;
        emit Settled(id, winner, pot);
        _pay(winner, pot);
    }

    // Give every stake back. The referee may do it any time (a draw or a cancelled match).
    // Anyone may do it after the deadline. A match nobody joined can also be refunded this way.
    function refund(bytes32 id) external {
        Match storage m = matches_[id];
        if (m.status != Status.Open && m.status != Status.Locked) revert BadState();
        if (msg.sender != referee && block.timestamp <= m.deadline) revert TooEarly();
        Status was = m.status;
        m.status = Status.Refunded;
        uint256 amt = m.amount;
        emit Refunded(id, m.creator, amt);
        _pay(m.creator, amt);
        if (was == Status.Locked) {
            emit Refunded(id, m.opponent, amt);
            _pay(m.opponent, amt);
        }
    }

    function getMatch(bytes32 id) external view returns (address creator, address opponent, uint256 amount, uint64 deadline, uint8 status) {
        Match storage m = matches_[id];
        return (m.creator, m.opponent, m.amount, m.deadline, uint8(m.status));
    }

    function _pay(address to, uint256 amt) private {
        (bool ok, ) = to.call{value: amt}("");
        if (!ok) revert SendFailed();
    }
}
