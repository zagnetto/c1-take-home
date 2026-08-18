/** Maximum characters stored for a message body (after trim and sanitization). */
export const MAX_MESSAGE_BODY_LENGTH = 10_000;

/** Reject values that would become NaN in SQL parameters (e.g. "12abc", 0, floats). */
export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    return n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
  }
  return null;
}

/** Strip HTML tags and control characters before persisting message text. */
export function sanitizeMessageBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_MESSAGE_BODY_LENGTH) return null;

  const withoutControls = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  let withoutTags = withoutControls
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '');
  withoutTags = withoutTags.trim();
  if (withoutTags.length === 0) return null;
  if (withoutTags.length > MAX_MESSAGE_BODY_LENGTH) return null;

  return withoutTags;
}

export function parseClientId(value: unknown): string | null | 'invalid' {
  if (value == null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return 'invalid';
  return trimmed;
}
