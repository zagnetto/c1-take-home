import type { Collection } from 'mongodb';

const DEMO_BODIES = [
  { _id: 1 as never, conversationId: 1, senderId: 2, body: 'Hi, any update on order #1042?', createdAt: new Date() },
  { _id: 2 as never, conversationId: 1, senderId: 1, body: 'Checking now — give me a minute.', createdAt: new Date() },
  { _id: 3 as never, conversationId: 2, senderId: 3, body: 'Notes from the design sync are in the doc.', createdAt: new Date() },
] as const;

export type SeedMessageBodiesResult =
  | { action: 'inserted'; count: number }
  | { action: 'skipped'; existingCount: number };

/** Inserts demo message bodies only when the collection is empty. */
export async function seedMessageBodies(
  bodies: Pick<Collection, 'countDocuments' | 'insertMany'>,
): Promise<SeedMessageBodiesResult> {
  const existingCount = await bodies.countDocuments();
  if (existingCount > 0) {
    return { action: 'skipped', existingCount };
  }

  await bodies.insertMany([...DEMO_BODIES]);
  return { action: 'inserted', count: DEMO_BODIES.length };
}
