# Contextual encoding for conversation titles (PR 3)

## Symptom

A conversation title containing HTML or an unclosed tag (e.g. `<img src=x onerror=alert(1)`) could
execute script in the browser when the sidebar rendered titles via `innerHTML`.

## Reproduction

```bash
# Unclosed tag bypasses server sanitizer and reaches the client
curl -X POST http://localhost:3000/api/conversations \
  -H 'Content-Type: application/json' -H 'Cookie: relay_session=…' \
  -d '{"title":"XSS <img src=x onerror=alert(1)","participantIds":[2]}'
# pre-fix: alert in browser sidebar; post-fix: literal text only
```

Closed tags were already stripped on write (`docs/012`); the frontend sink remained for unclosed
markup, legacy rows, and any payload that survived persistence.

## Root cause

`web/app.js` `renderSidebar()` (lines 161–162) interpolated `c.title` into `li.innerHTML`. The
browser parsed the string as HTML. Server `sanitizeStoredText` only removes tags with a closing `>`
(`src/validation/messageInput.ts:31`), so unclosed markup was stored and reflected.

## Fix

1. **`web/app.js`** — build sidebar list items with `createElement` / `textContent`; unread dot
   remains a `<span class="dot">` created safely.
2. **`src/validation/messageInput.ts`** — comment clarifying sanitizer is format normalization, not
   HTML-context XSS defense.
3. **Tests** — unclosed-tag unit test; static contract test on `web/app.js` sinks.

Server sanitization rules unchanged.

## Verification

```bash
npm test -- src/validation/messageInput.test.ts src/web-xss-sinks.test.ts
```

Before: `web-xss-sinks.test.ts` would fail (template `innerHTML` with `c.title`).  
After: both files pass (5 + 2 tests in those modules).

## Contributions

**User proposed**

- Fix PR 3 from `docs/017-critical-high-review.md` — contextual encoding for conversation titles.

**Agent proposed**

- Frontend-only fix in `renderSidebar()` via `textContent` / `createElement` — **adopted**
- Static `web/app.js` contract test instead of a browser runner — **adopted**
- Unit test documenting unclosed-tag bypass in `sanitizeStoredText` — **adopted**
- Leave server regex sanitizer unchanged (format only) — **adopted**

## Alternatives considered

See `spec/conversation-title-xss-encoding.md` — regex hardening and DOMPurify rejected.

## Dead ends

None — fix matched the agreed Phase 2 design on first implementation.
