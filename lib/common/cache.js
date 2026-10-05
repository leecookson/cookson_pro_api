import loggers from 'namespaced-console-logger';

const logger = loggers(process.env.LOG_LEVEL || 'info').get('common:cache');

// Per-container memory cache, bounded so a long-lived container can't grow without limit
const MAX_MEMORY_ENTRIES = 500;
const memory = new Map(); // key -> { value, fetchedAt }

let dynamo = null; // { client, GetItemCommand, PutItemCommand }, created on first use

// Shared cache table across Lambda containers. Unset (local dev, tests) means memory only.
const tableName = () => process.env.CACHE_TABLE_NAME;

async function getDynamo() {
  if (!dynamo) {
    // Provided by the Lambda runtime; a devDependency locally
    const { DynamoDBClient, GetItemCommand, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
    dynamo = { client: new DynamoDBClient({ region: 'us-east-1' }), GetItemCommand, PutItemCommand };
  }
  return dynamo;
}

function remember(key, entry) {
  memory.delete(key);
  memory.set(key, entry);
  if (memory.size > MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
}

// Cache failures are logged and treated as a miss; they never fail the request
async function readShared(key) {
  if (!tableName()) return null;
  try {
    const { client, GetItemCommand } = await getDynamo();
    const { Item } = await client.send(new GetItemCommand({ TableName: tableName(), Key: { pk: { S: key } } }));
    if (!Item) return null;
    return { value: JSON.parse(Item.value.S), fetchedAt: Number(Item.fetchedAt.N) };
  } catch (error) {
    logger.warn(`Cache read failed for ${key}: ${error.message}`);
    return null;
  }
}

async function writeShared(key, entry, maxStaleMs) {
  if (!tableName()) return;
  try {
    const { client, PutItemCommand } = await getDynamo();
    await client.send(new PutItemCommand({
      TableName: tableName(),
      Item: {
        pk: { S: key },
        value: { S: JSON.stringify(entry.value) },
        fetchedAt: { N: String(entry.fetchedAt) },
        // DynamoDB TTL (epoch seconds) only garbage-collects; freshness is decided from fetchedAt
        expiresAt: { N: String(Math.ceil((entry.fetchedAt + maxStaleMs) / 1000)) },
      },
    }));
  } catch (error) {
    logger.warn(`Cache write failed for ${key}: ${error.message}`);
  }
}

/**
 * Two-level cache for upstream data: per-container memory, then the shared DynamoDB table
 * (when CACHE_TABLE_NAME is set), then `load()`.
 *
 * A value younger than `freshMs` is returned without calling `load`. If `load` throws, a stale
 * value younger than `maxStaleMs` is returned instead, so a provider outage doesn't take the
 * data away. `load` must return JSON-serializable data.
 */
export async function cached(key, { freshMs, maxStaleMs = freshMs }, load) {
  const now = Date.now();
  const isFresh = (entry) => entry && now - entry.fetchedAt < freshMs;

  let entry = memory.get(key);
  if (isFresh(entry)) return entry.value;

  const shared = await readShared(key);
  if (shared && (!entry || shared.fetchedAt > entry.fetchedAt)) {
    entry = shared;
    remember(key, entry);
  }
  if (isFresh(entry)) return entry.value;

  try {
    const value = await load();
    const loaded = { value, fetchedAt: Date.now() };
    remember(key, loaded);
    await writeShared(key, loaded, maxStaleMs);
    return value;
  } catch (error) {
    if (entry && now - entry.fetchedAt < maxStaleMs) {
      logger.warn(`Using stale cache for ${key} after load failed: ${error.message}`);
      return entry.value;
    }
    throw error;
  }
}

// For tests
export function clearMemoryCache() {
  memory.clear();
}

// For tests: replace the DynamoDB client ({ send }) used for the shared cache
export async function setDynamoClientForTests(client) {
  const { GetItemCommand, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
  dynamo = client ? { client, GetItemCommand, PutItemCommand } : null;
}
