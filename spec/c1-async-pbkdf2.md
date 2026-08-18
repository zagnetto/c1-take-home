# C1 — розблокувати event loop, зберігши `signature`

## Goal

При надсиланні повідомлення поле `signature` у Mongo (`message_bodies.signature`) лишається.
Замість синхронного `crypto.pbkdf2Sync` використовуємо асинхронний `crypto.pbkdf2`, щоб
обчислення йшло в пулі потоків libuv, а event loop Node продовжував обробляти інші запити
(`GET`, WebSocket, health).

## Design

**Файл:** `src/services/messages.ts`

1. Замінити:

   ```ts
   crypto.pbkdf2Sync(body, 'relay-signing', 200000, 32, 'sha256').toString('hex')
   ```

   на promisified `crypto.pbkdf2` з **тими самими** параметрами (password, salt, iterations,
   keylen, digest). Вихідний hex-рядок ідентичний — змінюється лише спосіб виконання.

2. Реалізація без нових залежностей: `util.promisify(crypto.pbkdf2)`.

3. Порядок у `createMessage` не змінюється: спочатку `signature`, потім MySQL INSERT, потім
   Mongo `insertOne`. Поле `signature` у документі Mongo лишається обовʼязковим.

4. Опційно (не обовʼязково для C1): винести в `computeMessageSignature(body: string): Promise<string>`
   для читабельності та майбутніх тестів.

## Contracts

| Aspect | Before | After |
|---|---|---|
| Mongo `message_bodies.signature` | hex PBKDF2, 200k iter | те саме |
| Алгоритм | `pbkdf2Sync` | `pbkdf2` (async) |
| Event loop під burst POST | блокується | вільний — паралельні `GET` лишаються в мілісекундах |
| API response shape | без змін | без змін |
| Latency одного POST | ~17 ms CPU (локально) | ~17 ms CPU + thread-pool queue; загальний час може зрости під піком, але **інші** запити не страждають |

## Verification

1. **Регресія підпису:** для фіксованого `body` hex після зміни = hex до зміни.

2. **Розблокування event loop** (з `docs/architecture-audit.md`):

   ```bash
   # термінал 1
   while true; do curl -s -o /dev/null -w '%{time_total}\n' 'localhost:3000/api/conversations?userId=1'; done

   # термінал 2
   seq 1 50 | xargs -P 50 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
     -X POST localhost:3000/api/messages -H 'content-type: application/json' \
     -d '{"conversationId":1,"senderId":1,"body":"concurrent {}"}'
   ```

   Очікування: час `GET` не стрибає до секунд під час burst.

## Alternatives considered

| Option | Why not (for this task) |
|---|---|
| **Видалити `signature`** | Користувач явно відхилив: обробка CPU-heavy роботи без блокування loop — частина завдання. |
| **Worker threads** | `crypto.pbkdf2` уже делегує в thread pool libuv; окремий worker — дублювання, більше коду (файл worker, серіалізація), без виграшу для вбудованого crypto. |
| **HMAC замість PBKDF2** | Інший алгоритм і інший hex — змінює контракт поля; швидше, але це не «той самий хеш». |
| **Фонова черга / outbox** | Розвʼязує latency POST, але ускладнює C2 (подвійний запис) і виходить за рамки C1. |
| **Semaphore на concurrent pbkdf2** | Може захистити CPU від 50 одночасних jobs, але не потрібно для демонстрації unblock loop; можна додати пізніше. |

## Contributions

**User proposed**
- Не видаляти поле `signature` — задача саме в тому, щоб не блокувати event loop.
- Використати асинхронний метод генерації того самого хеша.
- Розглянути worker threads, але сумнівається, що це не overkill для take-home.

**Agent proposed**
- **Видалити `signature` повністю** (з рекомендації `docs/architecture-audit.md` C1) — поле
  записується в Mongo, але ніде не читається; найпростіше production-рішення. **Відхилено
  користувачем** — обробка CPU-heavy роботи без блокування loop є частиною завдання.
- **`crypto.pbkdf2` через `util.promisify`** — **рекомендовано, adopted** (stdlib, мінімальний diff,
  той самий hex).
- **Worker threads** — **відхилено для C1:** redundant поверх libuv thread pool.

**Agreed in Phase 2**
- Зберегти `signature`; замінити `pbkdf2Sync` на async `pbkdf2`; без worker threads.
- У `docs/` зафіксувати: agent пропонував видалення поля; user пропонував async pbkdf2 і worker
  threads; обґрунтування вибору async pbkdf2.
