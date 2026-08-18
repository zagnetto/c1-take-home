import express from 'express';
import * as messagesController from '../controllers/messagesController.ts';
import { requireConversationAccess } from '../middleware/conversationAccess.ts';
import { requireSession } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';

export const messagesRouter = express.Router();

messagesRouter.post(
  '/',
  requireSession,
  requireConversationAccess({ source: 'body' }),
  asyncHandler(messagesController.create),
);

messagesRouter.get(
  '/',
  requireSession,
  requireConversationAccess({ source: 'query' }),
  asyncHandler(messagesController.list),
);
