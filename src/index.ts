import http from 'node:http';
import express from 'express';
import { config } from './config.ts';
import { waitForMysql } from './db/mysql.ts';
import { connectMongo } from './db/mongo.ts';
import { conversationsRouter } from './routes/conversations.js';
import { messagesRouter } from './routes/messages.js';
import { searchRouter } from './routes/search.js';
import { attachWs } from './ws/hub.ts';

const app = express();
app.use(express.json());
app.use(express.static('web'));
app.use('/api/conversations', conversationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/search', searchRouter);

const server = http.createServer(app);
attachWs(server);

await waitForMysql();
await connectMongo();

server.listen(config.port, () => {
  console.log(`relay listening on :${config.port}`);
});
