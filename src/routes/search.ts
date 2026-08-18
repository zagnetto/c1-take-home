import express from 'express';
import * as searchController from '../controllers/searchController.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';
import { requireSession } from '../middleware/session.ts';

export const searchRouter = express.Router();

searchRouter.get('/', requireSession, asyncHandler(searchController.search));
