import { connectMongo, mongo } from '../../src/db/mongo.ts';

await connectMongo();
const bodies = mongo().collection('message_bodies');
await bodies.deleteMany({});
await bodies.insertMany([
  { _id: 1 as never, conversationId: 1, senderId: 2, body: 'Hi, any update on order #1042?', createdAt: new Date() },
  { _id: 2 as never, conversationId: 1, senderId: 1, body: 'Checking now — give me a minute.', createdAt: new Date() },
  { _id: 3 as never, conversationId: 2, senderId: 3, body: 'Notes from the design sync are in the doc.', createdAt: new Date() },
]);
console.log('seeded message bodies');
process.exit(0);
