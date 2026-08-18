# Relay — підсумок роботи

> Цей документ згенеровано AI-асистентом (Cursor) за побажанням автора репозиторію. Зміст, акценти
> та trade-offs узгоджені з ним; технічні факти перевірені по комітах і нотатках у `docs/` / `spec/`.

## Що зроблено

**Стабілізація під навантаженням.** Прибрано блокування event loop (`pbkdf2` → async), додано
ідемпотентність надсилання, rollback при збої Mongo після запису в MySQL, rate limiting через Redis
Lua, graceful shutdown, обробку помилок на межі HTTP.

**Realtime на кількох інстансах.** WebSocket fan-out винесено в Redis pub/sub; кімнати за
`conversationId`, heartbeat і backpressure на сервері, auto-reconnect і resync на клієнті.

**Безпека та доступ.** Сесії в Redis (cookie, seeded users), перевірка участі в розмові на HTTP і WS,
scope idempotency на відправника, санітизація та XSS-кодування назв розмов.

**Масштабування читання.** Індекси, згортання N+1 у списку розмов, пагінація повідомлень.

**Фічі з `tasks/`.** Пошук (`GET /api/search`, Mongo `$text`), rate limiting, typing indicator.

**Структура коду.** Рефакторинг у шари routes → controllers → services, TypeScript, co-located тести,
`package-lock.json` + `npm ci` у Docker.

Деталі по кожному пункту — у [`docs/`](docs/) та [`spec/`](spec/).

## Trade-offs (свідомі компроміси)

| Рішення | Чому так | Ціна |
|---|---|---|
| Redis pub/sub для fan-out | Працює без sticky sessions при `--scale api=3` | Немає гарантії доставки; pub/sub не персистить події |
| Envoy `ROUND_ROBIN` | Простий балансер «з коробки» compose | HTTP і WebSocket потрапляють на різні інстанси; для WS це поганий LB — краще affinity або окремий WS-шар |
| Mongo `$text` для пошуку | Індекс уже був у схемі; швидко для демо | Немає повноцінного FTS (fuzzy, синоніми, ранжування на рівні продукту) — потрібен Elasticsearch / OpenSearch |
| Rollback DELETE при збої Mongo | Мінімальний fix без нової інфраструктури | Не атомарно: crash між INSERT і DELETE лишає orphan; для продукту — outbox + брокер або Temporal на великих workflow |
| Сесії з seeded users у Redis | Швидко закриває «хто я» для take-home | Авторизація прикручена базово; у продукті це окрема задача з OIDC/JWT, refresh, RBAC — не mix з бізнес-логікою чату |
| Dual-write MySQL + Mongo | Успадкована архітектура | Два джерела правди; навіть з rollback залишається клас ризиків розсинхрону |

## Якби це був продукт

1. **Auth — окремий сервіс і roadmap.** Винести identity (OIDC, JWT, refresh tokens, ролі) з
   application layer; seeded-user pool лишити лише для dev/staging.

2. **Observability з першого дня.** Структуровані логи, метрики (latency, pool, Redis, WS
   connections), distributed tracing на шляху HTTP → MySQL/Mongo → Redis → WS; CI на кожен PR, не
   лише pre-push hook.

3. **WebSocket-шар.** Замість round-robin перед API — sticky sessions на upgrade або виділений
   realtime gateway; Redis pub/sub лишити як транспорт між gateway і worker-ами.

4. **Пошук.** Elasticsearch/OpenSearch (або Atlas Search) замість Mongo `$text` — relevance,
   highlight, pagination, аналітика запитів.

5. **Цілісність записів.** Для пар MySQL↔Mongo — transactional outbox і async consumer; Temporal
   (або інший orchestrator) — коли workflow складніший за один INSERT.

---

*Повний журнал рішень: [`docs/`](docs/) (33 нотатки), контракти: [`spec/`](spec/).*
