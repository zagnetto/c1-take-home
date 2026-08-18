import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedMessageBodies } from '../../../docker/db/seedMessageBodies.ts';

function mockCollection(existingCount: number) {
  let insertCalled = false;
  return {
    collection: {
      async countDocuments() {
        return existingCount;
      },
      async insertMany(docs: unknown[]) {
        insertCalled = true;
        assert.equal(docs.length, 3);
      },
    },
    wasInsertCalled: () => insertCalled,
  };
}

test('seedMessageBodies inserts demo bodies when collection is empty', async () => {
  const { collection, wasInsertCalled } = mockCollection(0);
  const result = await seedMessageBodies(collection);
  assert.equal(result.action, 'inserted');
  assert.equal(result.count, 3);
  assert.ok(wasInsertCalled());
});

test('seedMessageBodies skips when collection already has documents', async () => {
  const { collection, wasInsertCalled } = mockCollection(7);
  const result = await seedMessageBodies(collection);
  assert.equal(result.action, 'skipped');
  assert.equal(result.existingCount, 7);
  assert.equal(wasInsertCalled(), false);
});
