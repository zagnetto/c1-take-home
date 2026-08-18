export function sessionTokenKey(token: string): string {
  return `relay:session:${token}`;
}

export function sessionUserSlotKey(userId: number): string {
  return `relay:session:user:${userId}`;
}
