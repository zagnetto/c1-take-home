import type { Request, Response } from 'express';
import { searchMessages } from '../services/search.ts';

export async function search(req: Request, res: Response) {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(await searchMessages(q));
}
