// A challenge's 12-character id shown as a room code, like A1B2-C3D4-E5F6, so it is easy to read out loud
// or type on a phone. It is the id itself, so anyone with the code has the same access as the link.
export const toRoomCode = (id: string): string => (id.match(/.{1,4}/g) ?? [id]).join("-").toUpperCase();

export function fromRoomCode(input: string): string | null {
  const id = input.toLowerCase().replace(/[^0-9a-f]/g, "");
  return /^[0-9a-f]{12}$/.test(id) ? id : null;
}
