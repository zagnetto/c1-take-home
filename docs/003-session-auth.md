# Session auth — seeded user assignment via Redis

## What shipped

- `POST /api/session` creates or resumes a session; sets `relay_session` HttpOnly cookie.
- Redis stores `relay:session:<token>` → `userId` and `relay:session:user:<userId>` → token (24h TTL,
  `SET NX` slot claim).
- `GET /api/conversations` accepts session cookie (preferred) or legacy `?userId=`.
- `POST /api/conversations` and `POST /api/messages` require session; `senderId` comes from session.
- `web/app.js` calls `/api/session` on load, shows user name in `#userBadge`, sends cookies on fetches.

## Verification

```bash
docker compose restart api
docker compose exec -T api npm test   # session + ws tests
```

Manual: open three browser profiles → each gets Alice/Bob/Carol; fourth tab shows “All users busy”.
Reload keeps the same user (cookie resume).

## Contributions

**User proposed**
- Redis sessions, cookie token, free seeded user on load, client shows current user.

**Agent proposed**
- Dual-key occupancy tracking with `SET NX` — **adopted**.
- Legacy `?userId=` on conversation list — **adopted**.
- Sidebar `#userBadge` — **adopted**.

**Agreed in Phase 2**
- As in `spec/session-auth.md`.

## Dead ends

- None.
