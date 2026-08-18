export const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_SEARCH_LIMIT = 50;

export type SearchCursorPayload = {
  score: number;
  id: number;
  q: string;
};

export function encodeSearchCursor(payload: SearchCursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeSearchCursor(raw: string): SearchCursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { score, id, q } = parsed as SearchCursorPayload;
    if (!Number.isFinite(score)) return null;
    if (!Number.isInteger(id) || id <= 0) return null;
    if (typeof q !== 'string' || !q) return null;

    return { score, id, q };
  } catch {
    return null;
  }
}

export function parseSearchLimit(raw: unknown): number | null {
  if (raw == null || raw === '') return DEFAULT_SEARCH_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0) return null;
  return Math.min(limit, MAX_SEARCH_LIMIT);
}
