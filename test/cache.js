import test from 'node:test';
import assert from 'node:assert/strict';
import { cached, clearMemoryCache, setDynamoClientForTests } from '../lib/common/cache.js';

const HOUR = 3600000;

// In-memory stand-in for the DynamoDB table, recording each command
function fakeDynamo() {
  const items = new Map();
  const commands = [];
  return {
    items,
    commands,
    async send(command) {
      const name = command.constructor.name;
      commands.push(name);
      if (name === 'GetItemCommand') return { Item: items.get(command.input.Key.pk.S) };
      if (name === 'PutItemCommand') {
        items.set(command.input.Item.pk.S, command.input.Item);
        return {};
      }
      throw new Error(`Unexpected command ${name}`);
    },
  };
}

function sharedItem(key, value, fetchedAt) {
  return { pk: { S: key }, value: { S: JSON.stringify(value) }, fetchedAt: { N: String(fetchedAt) }, expiresAt: { N: '0' } };
}

test.describe('Two-level cache', () => {
  let dynamo;

  test.beforeEach(async () => {
    clearMemoryCache();
    dynamo = fakeDynamo();
    await setDynamoClientForTests(dynamo);
    process.env.CACHE_TABLE_NAME = 'TestCache';
  });

  test.afterEach(async () => {
    delete process.env.CACHE_TABLE_NAME;
    await setDynamoClientForTests(null);
  });

  test.it('should load once, then serve from memory', async () => {
    let loads = 0;
    const load = async () => ({ n: ++loads });

    assert.deepStrictEqual(await cached('k', { freshMs: HOUR }, load), { n: 1 });
    assert.deepStrictEqual(await cached('k', { freshMs: HOUR }, load), { n: 1 });
    assert.strictEqual(loads, 1);
    assert.deepStrictEqual(dynamo.commands, ['GetItemCommand', 'PutItemCommand']);
  });

  test.it('should write the shared item with fetchedAt and a TTL of maxStaleMs', async () => {
    const before = Date.now();
    await cached('k', { freshMs: HOUR, maxStaleMs: 6 * HOUR }, async () => ['x']);

    const item = dynamo.items.get('k');
    assert.strictEqual(item.value.S, '["x"]');
    const fetchedAt = Number(item.fetchedAt.N);
    assert.ok(fetchedAt >= before && fetchedAt <= Date.now());
    assert.strictEqual(Number(item.expiresAt.N), Math.ceil((fetchedAt + 6 * HOUR) / 1000));
  });

  test.it('should use a fresh shared item without loading (another container fetched it)', async () => {
    dynamo.items.set('k', sharedItem('k', { from: 'shared' }, Date.now() - 10 * 60000));

    const value = await cached('k', { freshMs: HOUR }, async () => assert.fail('should not load'));
    assert.deepStrictEqual(value, { from: 'shared' });

    // Now in memory: no further shared reads
    await cached('k', { freshMs: HOUR }, async () => assert.fail('should not load'));
    assert.deepStrictEqual(dynamo.commands, ['GetItemCommand']);
  });

  test.it('should reload when the shared item is older than freshMs', async () => {
    dynamo.items.set('k', sharedItem('k', 'old', Date.now() - 2 * HOUR));

    assert.strictEqual(await cached('k', { freshMs: HOUR, maxStaleMs: 6 * HOUR }, async () => 'new'), 'new');
    assert.strictEqual(dynamo.items.get('k').value.S, '"new"');
  });

  test.it('should serve a stale value when the load fails', async () => {
    dynamo.items.set('k', sharedItem('k', 'stale', Date.now() - 2 * HOUR));

    const value = await cached('k', { freshMs: HOUR, maxStaleMs: 6 * HOUR }, async () => { throw new Error('provider down'); });
    assert.strictEqual(value, 'stale');
  });

  test.it('should rethrow when the load fails and the cached value is too old', async () => {
    dynamo.items.set('k', sharedItem('k', 'ancient', Date.now() - 7 * HOUR));

    await assert.rejects(
      cached('k', { freshMs: HOUR, maxStaleMs: 6 * HOUR }, async () => { throw new Error('provider down'); }),
      /provider down/,
    );
  });

  test.it('should treat DynamoDB errors as a miss and still return the loaded value', async () => {
    await setDynamoClientForTests({ send: async () => { throw new Error('AccessDenied'); } });

    assert.strictEqual(await cached('k', { freshMs: HOUR }, async () => 'loaded'), 'loaded');
  });

  test.it('should use memory only when CACHE_TABLE_NAME is unset', async () => {
    delete process.env.CACHE_TABLE_NAME;

    assert.strictEqual(await cached('k', { freshMs: HOUR }, async () => 'v'), 'v');
    assert.strictEqual(await cached('k', { freshMs: HOUR }, async () => assert.fail('should not load')), 'v');
    assert.deepStrictEqual(dynamo.commands, []);
  });
});
