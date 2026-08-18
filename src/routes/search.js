import express from 'express';

export const searchRouter = express.Router();

// GET /api/search?q=... — the UI (web/app.js `renderResults`) expects
// [{ conversationId, conversationTitle, body }]. Stubbed to return nothing —
// implement the actual search. See tasks/search.md.
searchRouter.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json([]);
});
