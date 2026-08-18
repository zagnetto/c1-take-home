import express from 'express';
import * as searchController from '../controllers/searchController.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';

export const searchRouter = express.Router();

// GET /api/search?q=... — the UI (web/app.js `renderResults`) expects
// [{ conversationId, conversationTitle, body }]. Stubbed to return nothing —
// implement the actual search. See tasks/search.md.
searchRouter.get('/', asyncHandler(searchController.search));
