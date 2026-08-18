# Rate limiting

Nothing stops someone hammering the send button, and I've already had one runaway script flood a
conversation. I'd like some basic protection on sending.

Roughly what I'm after:

- cap each user to about **5 messages per 10 seconds, per conversation**;
- when they go over, reject the send with **HTTP 429** and a **`Retry-After`** so the client knows
  how long to back off;
- it's **per user** — one noisy person shouldn't throttle everyone else in the room;
- it needs to still hold if the app is running as **more than one instance** (a counter that only
  lives in one process's memory won't cut it).

Those numbers aren't sacred — sensible defaults are fine, they're just the ballpark I have in mind.
