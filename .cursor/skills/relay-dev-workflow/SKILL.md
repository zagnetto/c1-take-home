---
name: relay-dev-workflow
description: Commands for running, restarting, and scaling the Relay docker stack, inspecting MySQL/Mongo/Redis, smoke-testing the API, generating bursts of traffic, and adding tests. Use when starting or rebuilding the app, reproducing a bug, verifying a change, querying the databases, or running it on multiple instances.
---

# Relay Dev Workflow

## First run

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:3000>. Only Envoy publishes a port; the API is reachable through it.

## Day-to-day

```bash
docker compose up -d              # start in background
docker compose logs -f api        # follow API logs (all replicas)
docker compose restart api        # pick up source changes
docker compose ps                 # what is running
docker compose down              # stop, keep data
docker compose down -v            # stop and wipe data, forces re-seed on next up
```

Two things that bite:

- `npm start` runs `tsx` **without** watch mode and the repo is bind-mounted, so edited source is
  present in the container but not loaded until `docker compose restart api`.
- `node_modules` lives in an anonymous volume baked at image build time. **After changing
  `package.json` you must `docker compose up --build`**, otherwise the new dependency is missing.

## Multiple instances

```bash
docker compose up -d --scale api=3
docker compose logs -f api        # interleaved output from all three
```

Envoy round-robins with no affinity. Use this whenever you touch realtime, rate limiting, or any
in-process state — a change that works on one instance frequently breaks on three.

## Inspecting state

```bash
docker compose exec mysql mysql -uroot -proot relay -e "SELECT * FROM messages ORDER BY id DESC LIMIT 10"
docker compose exec mysql mysql -uroot -proot relay -e "SHOW INDEX FROM messages"
docker compose exec mysql mysql -uroot -proot relay -e "EXPLAIN SELECT * FROM messages WHERE conversation_id = 1"

docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.find().sort({_id:-1}).limit(5).toArray()'
docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.countDocuments()'
docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.getIndexes()'

docker compose exec redis redis-cli KEYS 'relay:*'      # debugging only, never in app code
docker compose exec redis redis-cli MONITOR
```

MySQL is also published on `localhost:3306` (`root`/`root`) and Mongo on `localhost:27017` if you
prefer a GUI. Redis is only reachable inside the compose network.

Row count versus body count is the quickest consistency check:

```bash
docker compose exec mysql mysql -uroot -proot relay -N -e "SELECT COUNT(*) FROM messages"
docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.countDocuments()'
```

## Smoke-testing the API

```bash
curl -s 'localhost:3000/api/conversations?userId=1'
curl -s 'localhost:3000/api/messages?conversationId=1'
curl -s 'localhost:3000/api/search?q=order'
curl -si -X POST localhost:3000/api/messages \
  -H 'content-type: application/json' \
  -d '{"conversationId":1,"senderId":1,"body":"hello","clientId":"'"$(uuidgen)"'"}'
```

Use `-i` when the status code or a header (`Retry-After`) is part of what you are checking.

## Generating load

Burst of sends, sequential timing:

```bash
for i in $(seq 1 10); do
  curl -s -o /dev/null -w '%{http_code} %{time_total}\n' -X POST localhost:3000/api/messages \
    -H 'content-type: application/json' \
    -d "{\"conversationId\":1,\"senderId\":1,\"body\":\"burst $i\"}"
done
```

Concurrent sends (reveals event-loop blocking and rate-limit races):

```bash
seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST localhost:3000/api/messages -H 'content-type: application/json' \
  -d '{"conversationId":1,"senderId":1,"body":"concurrent {}"}'
```

While a burst is running, time an unrelated read in another shell. If a plain `GET` slows to seconds,
the event loop is blocked rather than the database being slow:

```bash
while true; do curl -s -o /dev/null -w '%{time_total}\n' 'localhost:3000/api/conversations?userId=1'; done
```

## Inspecting WebSocket traffic

Two browser tabs is the fastest check. For a scriptable client:

```bash
npx -y wscat -c ws://localhost:3000/ -x '{"type":"subscribe","conversationIds":[1,2]}'
```

Then POST a message from another shell and confirm the frame arrives — with `--scale api=3` too.

## Tests

Workflow: `.cursor/rules/tdd-workflow.mdc` — write a failing test first (Phase 1), diagnose and
propose in a separate turn (Phase 2), implement only after agreement (Phase 3).

There is no test runner yet. When adding one, stay with the zero-config stack: Node's built-in test
runner through `tsx`, no new framework.

```json
"test": "node --import tsx --test \"src/**/*.test.ts\""
```

- Name files `*.test.ts` next to the code under test.
- Prefer integration tests that drive the real HTTP API against a running `docker compose` stack via
  `fetch('http://localhost:3000/...')` — the interesting bugs here live in the interaction between
  Express, MySQL, Mongo, Redis, and Envoy, not inside pure functions.
- Unit-test pure logic directly (rate-limit window maths, query builders) without a running stack.
- Tests must clean up the rows and keys they create, or run against a stack you can `down -v`.
