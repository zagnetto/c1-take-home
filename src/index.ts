import http from 'node:http';
import express from 'express';
import { config } from './config.ts';
import { waitForMysql } from './db/mysql.ts';
import { connectMongo } from './db/mongo.ts';
import { ensureIndexes } from './db/ensureIndexes.ts';
import { waitForRedis } from './db/redis.ts';
import { conversationsRouter } from './routes/conversations.js';
import { messagesRouter } from './routes/messages.ts';
import { searchRouter } from './routes/search.js';
import { sessionRouter } from './routes/session.ts';
import { attachWs, initRedisFanout } from './ws/hub.ts';
import { errorHandler } from './middleware/errorHandler.ts';

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static('web'));
app.use('/api/session', sessionRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/search', searchRouter);
app.use(errorHandler);

const server = http.createServer(app);
attachWs(server);

await waitForMysql();
const db = await connectMongo();
await ensureIndexes(db);
await waitForRedis();
await initRedisFanout();

server.listen(config.port, () => {
  console.log(`relay listening on :${config.port}`);
});
