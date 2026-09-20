import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoMemoryServer: MongoMemoryServer | null = null;
let isUsingLocalMongo = false;

/**
 * Setup test database connection.
 * Prioritizes local running MongoDB instance for instant execution (<1s),
 * and falls back to MongoMemoryServer only when local MongoDB is unavailable.
 */
export async function setupTestDatabase(): Promise<string> {
  const localUri = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017';
  const testDbName = `highp_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    // Attempt fast connection to local MongoDB
    await mongoose.connect(`${localUri}/${testDbName}`, {
      serverSelectionTimeoutMS: 2000
    });
    isUsingLocalMongo = true;
    return `${localUri}/${testDbName}`;
  } catch (localErr) {
    // Fall back to in-memory server
    mongoMemoryServer = await MongoMemoryServer.create();
    const memoryUri = mongoMemoryServer.getUri();
    await mongoose.connect(memoryUri);
    isUsingLocalMongo = false;
    return memoryUri;
  }
}

/**
 * Teardown test database and clean up collections.
 */
export async function teardownTestDatabase(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) {
      if (mongoose.connection.db) {
        await mongoose.connection.db.dropDatabase();
      }
      await mongoose.disconnect();
    }
  } catch (err) {
    // Suppress teardown errors
  }

  if (mongoMemoryServer) {
    try {
      await mongoMemoryServer.stop();
    } catch {}
  }
}
