import express from 'express';
import {
  createConversation,
  findConversationIdByTitle,
  listConversations,
} from '../services/conversations.ts';
import { requireSession } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../constants/conversations.ts';
import { isDuplicateTitleError } from '../helpers/mysqlErrors.ts';
import { parsePositiveInt, sanitizeConversationTitle } from '../helpers/validation/messageInput.ts';

export const conversationsRouter = express.Router();

conversationsRouter.get('/', requireSession, asyncHandler(async (req, res) => {
  const userId = req.sessionUser.userId;
  res.json(await listConversations(userId));
}));

conversationsRouter.post('/', requireSession, asyncHandler(async (req, res) => {
  const { participantIds } = req.body || {};
  const rawTitle = req.body?.title;
  const title = sanitizeConversationTitle(rawTitle);

  if (title == null) {
    if (typeof rawTitle === 'string' && rawTitle.trim().length > MAX_CONVERSATION_TITLE_LENGTH) {
      return res.status(400).json({
        error: `title must be at most ${MAX_CONVERSATION_TITLE_LENGTH} characters`,
      });
    }
    return res.status(400).json({ error: 'title is required and must be non-empty text' });
  }

  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return res.status(400).json({ error: 'a non-empty participantIds[] is required' });
  }

  const selfId = req.sessionUser.userId;
  const parsedIds = participantIds.map(parsePositiveInt);
  if (parsedIds.some((id) => id == null)) {
    return res.status(400).json({ error: 'participantIds must contain positive integers only' });
  }

  const ids = [...new Set([selfId, ...parsedIds])];

  if (await findConversationIdByTitle(title)) {
    return res.status(409).json({ error: 'a conversation with this title already exists' });
  }

  try {
    const created = await createConversation(title, ids);
    res.status(201).json(created);
  } catch (err) {
    if (isDuplicateTitleError(err)) {
      return res.status(409).json({ error: 'a conversation with this title already exists' });
    }
    throw err;
  }
}));
