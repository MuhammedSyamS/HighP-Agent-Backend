import mongoose from 'mongoose';
import { config } from './index';

let cachedPromise: Promise<typeof mongoose> | null = null;

export const connectDatabase = async (): Promise<typeof mongoose> => {
  if (mongoose.connection.readyState >= 1) {
    return mongoose;
  }

  if (cachedPromise) {
    return cachedPromise;
  }

  const primaryUri = config.mongoUri;
  const localFallbackUri = 'mongodb://127.0.0.1:27017/highphaus_workforce';
  const isServerless = !!process.env.VERCEL || process.env.NODE_ENV === 'production';

  if (isServerless && !process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined in Vercel. Please add MONGODB_URI in Vercel Project Settings -> Environment Variables.');
  }

  const connectOptions: mongoose.ConnectOptions = {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: isServerless ? 10 : 25,
    minPoolSize: isServerless ? 0 : 5,
    maxIdleTimeMS: 30000,
    autoIndex: true,
    ...(process.platform === 'win32' ? { family: 4 } : {})
  };

  cachedPromise = mongoose.connect(primaryUri, connectOptions).then(
    conn => {
      console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
      return conn;
    },
    async (error: any) => {
      cachedPromise = null;
      console.warn(`[Database] Primary MongoDB connection failed (${error.message}).`);

      if (primaryUri.includes('mongodb.net')) {
        console.warn(`[Database] ⚠️ MongoDB Atlas Notice: If you see "SSL alert number 80" or "ServerSelectionError", please ensure your current IP address is whitelisted in MongoDB Atlas under "Network Access" (or add 0.0.0.0/0 for anywhere access).`);
      }

      if (isServerless) {
        throw error;
      }

      console.log(`[Database] Attempting connection to local MongoDB fallback (${localFallbackUri})...`);
      try {
        const fallbackConn = await mongoose.connect(localFallbackUri, {
          ...connectOptions,
          serverSelectionTimeoutMS: 3000
        });
        console.log(`[Database] Connected to Local MongoDB Fallback: ${fallbackConn.connection.host}`);
        return fallbackConn;
      } catch (fallbackError) {
        console.error('[Database] Both primary and fallback MongoDB connections failed.');
        throw error;
      }
    }
  );

  return cachedPromise;
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
};
