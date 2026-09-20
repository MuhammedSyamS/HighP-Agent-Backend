import mongoose from 'mongoose';
import { config } from './index';

export const connectDatabase = async (): Promise<typeof mongoose> => {
  if (mongoose.connection.readyState >= 1) {
    return mongoose;
  }

  const primaryUri = config.mongoUri;
  const localFallbackUri = 'mongodb://127.0.0.1:27017/highphaus_workforce';

  const connectOptions: mongoose.ConnectOptions = {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 25,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
    family: 4, // Force IPv4 to prevent Windows OpenSSL dual-stack TLS alert 80
    autoIndex: true
  };

  try {
    const conn = await mongoose.connect(primaryUri, connectOptions);
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error: any) {
    console.warn(`[Database] Primary MongoDB connection failed (${error.message}).`);
    
    // Check if it's an Atlas IP whitelist / TLS error
    if (primaryUri.includes('mongodb.net')) {
      console.warn(`[Database] ⚠️ MongoDB Atlas Notice: If you see "SSL alert number 80" or "ServerSelectionError", please ensure your current IP address is whitelisted in MongoDB Atlas under "Network Access" (or add 0.0.0.0/0 for anywhere access).`);
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
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
};
