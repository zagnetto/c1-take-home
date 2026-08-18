/** Redis pub/sub channel for cross-instance realtime fan-out. */
export const REALTIME_EVENTS_CHANNEL = 'relay:events';

export function sessionTokenKey(token: string): string {
  return `relay:session:${token}`;
}

export function sessionUserSlotKey(userId: number): string {
  return `relay:session:user:${userId}`;
}
