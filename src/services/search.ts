export type SearchResult = {
  conversationId: number;
  conversationTitle: string;
  body: string;
};

/** Stub — see tasks/search.md. Returns empty until full-text search is implemented. */
export async function searchMessages(_q: string): Promise<SearchResult[]> {
  return [];
}
