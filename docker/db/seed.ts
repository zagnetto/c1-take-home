import { connectMongo, mongo } from '../../src/db/mongo.ts';
import { seedMessageBodies } from './seedMessageBodies.ts';

await connectMongo();
const result = await seedMessageBodies(mongo().collection('message_bodies'));

if (result.action === 'inserted') {
  console.log(`seeded ${result.count} message bodies`);
} else {
  console.log(`message bodies already present (${result.existingCount}), skipping seed`);
}
process.exit(0);
