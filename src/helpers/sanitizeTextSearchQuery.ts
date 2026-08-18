/** Strip characters that break MongoDB `$text` `$search` syntax. Returns empty when nothing searchable remains. */
export function sanitizeTextSearchQuery(raw: string): string {
  return raw
    .replace(/["\\]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[+-]+/, ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}
