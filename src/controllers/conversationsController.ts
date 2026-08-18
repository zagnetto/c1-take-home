import type { Request, Response } from 'express';
import {
  createConversation,
  findConversationIdByTitle,
  listConversations,
} from '../services/conversations.ts';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../constants/conversations.ts';
import { isDuplicateTitleError } from '../helpers/mysqlErrors.ts';
import { parsePositiveInt, sanitizeConversationTitle } from '../helpers/validation/messageInput.ts';

export async function list(req: Request, res: Response) {
  const userId = req.sessionUser!.userId;
  res.json(await listConversations(userId));
}

export async function create(req: Request, res: Response) {
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

  const selfId = req.sessionUser!.userId;
  const parsedIds = participantIds.map(parsePositiveInt);
  if (parsedIds.some((id) => id == null)) {
    return res.status(400).json({ error: 'participantIds must contain positive integers only' });
  }

  const validIds = parsedIds.filter((id): id is number => id != null);
  const ids = [...new Set([selfId, ...validIds])];

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
}
