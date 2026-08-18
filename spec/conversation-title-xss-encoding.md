# PR 3: contextual encoding for conversation titles in the browser

**Status:** implemented — see `docs/020-conversation-title-xss-encoding.md`.  
**Source:** `docs/017-critical-high-review.md` — PR 3.

## Goal

Close the stored/reflected XSS sink in the sidebar: conversation titles from the API must render as
plain text even when the stored value contains HTML, unclosed tags, or event-handler attributes.
Server-side regex sanitization remains a format normalizer, not the XSS boundary.

## Problem (verified)

1. **`web/app.js` `renderSidebar()`** (lines 161–162) builds list items with `innerHTML` and
   interpolates `c.title` from `GET /api/conversations`.
2. **`sanitizeStoredText`** in `src/validation/messageInput.ts` strips tags only when a closing `>`
   is present (`/<[^>]*>/g`). Unclosed markup survives persistence, e.g.:

   ```
   Support <img src=x onerror=alert(1) ticket
   → stored verbatim (verified in Node)
   ```

3. Closed-tag payloads are stripped on write (docs/012), but the frontend sink still executes any
   markup that reaches the client — legacy rows, bypassed sanitization, or future API consumers.

Other frontend sinks were audited: message bodies (`createMessageElement`), search hits
(`renderResults`), header title (`openConversation`), and user badge already use `textContent` /
safe `append()`. Remaining `innerHTML` uses only clear containers (`innerHTML = ''`).

## Design

### Frontend (`web/app.js`)

Replace the `li.innerHTML = …` template in `renderSidebar()` with DOM construction:

- `document.createElement('span')` for the label; set
  `textContent = \`${c.title} (${c.messageCount})\``.
- If `c.unread`, append a second `<span class="dot">` with `textContent = '●'`.
- Keep `list.innerHTML = ''` for clearing the list (no user data).

No change to API contracts or server sanitization rules in this PR.

### Server (`src/validation/messageInput.ts`)

**No change** for XSS purposes. Existing `sanitizeConversationTitle` stays as write-time format
normalization (length, controls, well-formed tag stripping). Do not expand the regex blacklist —
017 explicitly rejected that approach.

Optional follow-up (out of scope): document in a comment on `sanitizeStoredText` that it is not an
XSS defense for HTML contexts.

### Tests (Phase 1 — red)

The repo has no browser test runner. Two lightweight checks without new dependencies:

1. **`src/validation/messageInput.test.ts`** — assert an **unclosed** tag in a title is **not**
   stripped today (documents the server gap the frontend must cover).
2. **`src/web-xss-sinks.test.ts`** (new) — read `web/app.js` and fail if `renderSidebar` assigns
   `innerHTML` using a template/interpolation that references `c.title` (static contract test; goes
   green when DOM/`textContent` fix lands).

Manual verification after Phase 3:

```bash
# Create conversation with unclosed tag (passes server sanitizer today)
curl -X POST http://localhost:3000/api/conversations \
  -H 'Content-Type: application/json' -H 'Cookie: relay_session=…' \
  -d '{"title":"XSS <img src=x onerror=alert(1)","participantIds":[2]}'
# Sidebar must show literal text; no alert / no injected <img> node
```

## Contracts

- Titles containing `<`, unclosed tags, or `onerror=` appear literally in the sidebar and chat
  header; no script runs and no extra DOM elements are created from the title string.
- Unread dot styling unchanged (`.dot` span still present when `c.unread`).
- `GET /api/conversations` response shape unchanged.

## Contributions

**User proposed**

- Fix PR 3 from `docs/017-critical-high-review.md` — contextual encoding for conversation titles.

**Agent proposed**

- Frontend-only fix in `renderSidebar()` via `textContent` / `createElement` — **adopted**
- Static `web/app.js` contract test instead of adding a browser runner — **adopted**
- Unit test documenting unclosed-tag bypass in `sanitizeStoredText` — **adopted**
- Leave server regex sanitizer unchanged (format only) — **adopted**

## Alternatives considered

| Option | Why rejected |
|---|---|
| Strengthen server regex (strip unclosed `<…`) | Blacklist remains incomplete (`javascript:`, SVG, mutation XSS); 017 defers XSS boundary to contextual encoding |
| HTML-entity escape on server | Displays entities literally; does not help if a consumer decodes or uses `innerHTML` |
| Frontend-only without contract test | Easy to regress; one-line `innerHTML` mistake reopens SEC1 |
| Add Playwright/jsdom | New dependency; disproportionate for a single sink in a no-build frontend |

## Out of scope

- Re-sanitizing existing MySQL rows
- CSP headers or DOMPurify
- Message-body XSS (already `textContent` in `createMessageElement`)
