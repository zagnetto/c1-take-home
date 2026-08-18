export const DEFAULT_MESSAGE_LIMIT = 50;
export const MAX_MESSAGE_LIMIT = 200;

export function parseLimit(raw: unknown): number | null {
  if (raw == null || raw === '') return DEFAULT_MESSAGE_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0) return null;
  return Math.min(limit, MAX_MESSAGE_LIMIT);
}

export type MessageListItem = {
  id: number;
  conversationId: number;
  senderId: number;
  createdAt: unknown;
  body: string;
};

export type MessagesPageResponse = {
  messages: MessageListItem[];
  hasMore: boolean;
  nextBefore: number | null;
};

/** Rows are newest-first (SQL DESC). Returns ascending page + pagination cursors. */
export function buildMessagesPage<T extends { id: number }>(
  rowsNewestFirst: T[],
  limit: number,
): { messages: T[]; hasMore: boolean; nextBefore: number | null } {
  const hasMore = rowsNewestFirst.length > limit;
  const pageDesc = hasMore ? rowsNewestFirst.slice(0, limit) : rowsNewestFirst;
  const messages = [...pageDesc].reverse();
  const nextBefore = messages.length > 0 ? messages[0]!.id : null;
  return { messages, hasMore, nextBefore };
}
