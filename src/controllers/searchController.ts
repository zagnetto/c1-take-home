import type { Request, Response } from 'express';
import { decodeSearchCursor, parseSearchLimit } from '../helpers/searchCursor.ts';
import { searchMessages, SearchCursorMismatchError } from '../services/search.ts';

const EMPTY_PAGE = { results: [], hasMore: false, nextCursor: null };

export async function search(req: Request, res: Response) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json(EMPTY_PAGE);

  const limit = parseSearchLimit(req.query.limit);
  if (limit == null) {
    return res.status(400).json({ error: 'limit must be a positive integer' });
  }

  const rawCursor = req.query.cursor;
  let cursor = null;
  if (rawCursor != null && String(rawCursor) !== '') {
    cursor = decodeSearchCursor(String(rawCursor));
    if (!cursor) {
      return res.status(400).json({ error: 'cursor is invalid' });
    }
  }

  const userId = req.sessionUser!.userId;

  try {
    res.json(await searchMessages({ q, userId, limit, cursor }));
  } catch (err) {
    if (err instanceof SearchCursorMismatchError) {
      return res.status(400).json({ error: 'cursor does not match query' });
    }
    throw err;
  }
}
