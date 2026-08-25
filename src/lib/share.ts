export function buildShareUrl(origin: string, roomName: string): string {
  return `${origin}/call?room=${encodeURIComponent(roomName)}`;
}
