# Search Load more button stuck or missing

## Symptom

After search pagination shipped, **Load more** either never appeared despite `hasMore: true` in the
API response, or stayed visible (often mid-list) after loading the last page.

## Root cause

`web/app.js` `renderSearchLoadMore()` only created the button when none existed; it never moved it
to the bottom. On **Load more**, new hits were `appendChild`ed **after** the existing button, so
the control sat in the middle of the list (easy to miss below the fold). When `hasMore` became
false, the stale button node could remain while the `finally` block re-enabled it.

## Fix

- `appendSearchResults()` — insert new rows **before** the button.
- `renderSearchLoadMore()` — always remove and recreate the button at the pane bottom; show only when
  `hasMore && nextCursor`.
- Drop re-enable in `loadMoreSearchResults` `finally` (button is recreated each render).
- Add `.search-load-more` styles in `web/index.html` for visibility.

## Verification

Manual: search `test` with >50 Mongo bodies → button at bottom → click → more rows append below
previous, button stays at bottom → last page removes button.

## Contributions

**User proposed**
- Reported Load more visibility bug after testing with mass-updated Mongo bodies.

**Agent proposed**
- Recreate button each render + insert results before button — **adopted**
