import http from 'node:http';
import express from 'express';
import { config } from './config.ts';
import { waitForMysql } from './db/mysql.ts';
import { connectMongo } from './db/mongo.ts';
import { ensureIndexes } from './db/ensureIndexes.ts';
import { waitForRedis } from './db/redis.ts';
import { conversationsRouter } from './routes/conversations.ts';
import { messagesRouter } from './routes/messages.ts';
import { searchRouter } from './routes/search.ts';
import { sessionRouter } from './routes/session.ts';
import { attachWs, closeWsServer, initRedisFanout, releaseWsServer } from './ws/hub.ts';
import { closeMysql } from './db/mysql.ts';
import { closeMongo } from './db/mongo.ts';
import { closeRedis } from './db/redis.ts';
import { installGracefulShutdown, shutdownTimeoutMs } from './shutdown.ts';
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

installGracefulShutdown({
  server,
  closeWebSockets: closeWsServer,
  releaseWebSockets: releaseWsServer,
  closeMysql,
  closeMongo,
  closeRedis,
  timeoutMs: shutdownTimeoutMs(),
  exit: (code) => process.exit(code),
});

await waitForMysql();
const db = await connectMongo();
await ensureIndexes(db);
await waitForRedis();
await initRedisFanout();

server.listen(config.port, () => {
  console.log(`relay listening on :${config.port}`);
});
