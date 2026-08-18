import type { Document } from 'mongodb';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/mysql.ts';
import { mongo } from '../db/mongo.ts';
import {
  decodeSearchCursor,
  encodeSearchCursor,
  type SearchCursorPayload,
} from '../helpers/searchCursor.ts';
import { sanitizeTextSearchQuery } from '../helpers/sanitizeTextSearchQuery.ts';
import { listUserConversationIds } from './conversationAccess.ts';

export type SearchResultItem = {
  messageId: number;
  conversationId: number;
  conversationTitle: string;
  body: string;
};

export type SearchPageResponse = {
  results: SearchResultItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

const EMPTY_PAGE: SearchPageResponse = { results: [], hasMore: false, nextCursor: null };

export class SearchCursorMismatchError extends Error {
  constructor() {
    super('cursor does not match query');
    this.name = 'SearchCursorMismatchError';
  }
}

type MessageBodyHit = {
  _id: number;
  conversationId: number;
  body: string;
  score: number;
};

type SearchMessagesInput = {
  q: string;
  userId: number;
  limit: number;
  cursor: SearchCursorPayload | null;
};

async function loadConversationTitles(ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(', ');
  interface TitleRow extends RowDataPacket {
    id: number;
    title: string;
  }
  const [rows] = await pool.query<TitleRow[]>(
    `SELECT id, title FROM conversations WHERE id IN (${placeholders})`,
    unique,
  );
  return new Map(rows.map((r) => [r.id, r.title]));
}

function buildSearchPipeline(
  sanitized: string,
  allowedConversationIds: number[],
  cursor: SearchCursorPayload | null,
  limit: number,
): Document[] {
  const pipeline: Document[] = [
    {
      $match: {
        $text: { $search: sanitized },
        conversationId: { $in: allowedConversationIds },
      },
    },
    {
      $addFields: {
        score: { $meta: 'textScore' },
      },
    },
  ];

  if (cursor) {
    pipeline.push({
      $match: {
        $or: [
          { score: { $lt: cursor.score } },
          { $and: [{ score: cursor.score }, { _id: { $lt: cursor.id } }] },
        ],
      },
    });
  }

  pipeline.push({ $sort: { score: -1, _id: -1 } }, { $limit: limit + 1 });

  return pipeline;
}

export async function searchMessages(input: SearchMessagesInput): Promise<SearchPageResponse> {
  const sanitized = sanitizeTextSearchQuery(input.q);
  if (!sanitized) return EMPTY_PAGE;

  if (input.cursor && input.cursor.q !== sanitized) {
    throw new SearchCursorMismatchError();
  }

  const allowedConversationIds = await listUserConversationIds(input.userId);
  if (allowedConversationIds.length === 0) return EMPTY_PAGE;

  const hits = (await mongo()
    .collection('message_bodies')
    .aggregate(buildSearchPipeline(sanitized, allowedConversationIds, input.cursor, input.limit))
    .toArray()) as MessageBodyHit[];

  if (hits.length === 0) return EMPTY_PAGE;

  const hasMore = hits.length > input.limit;
  const pageHits = hasMore ? hits.slice(0, input.limit) : hits;
  const titles = await loadConversationTitles(pageHits.map((h) => h.conversationId));

  const last = pageHits[pageHits.length - 1];
  const nextCursor =
    hasMore && last != null
      ? encodeSearchCursor({ score: last.score, id: last._id, q: sanitized })
      : null;

  return {
    results: pageHits.map((hit) => ({
      messageId: hit._id,
      conversationId: hit.conversationId,
      conversationTitle: titles.get(hit.conversationId) ?? `#${hit.conversationId}`,
      body: hit.body,
    })),
    hasMore,
    nextCursor,
  };
}

export { decodeSearchCursor };
