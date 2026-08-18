import express from 'express';
import * as conversationsController from '../controllers/conversationsController.ts';
import { requireSession } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';

export const conversationsRouter = express.Router();

conversationsRouter.get('/', requireSession, asyncHandler(conversationsController.list));
conversationsRouter.post('/', requireSession, asyncHandler(conversationsController.create));
