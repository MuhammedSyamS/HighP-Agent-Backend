import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/highp_activity_monitor',
  jwt: {
    secret: process.env.JWT_SECRET || 'highp_dev_jwt_secret_key_at_least_32_characters_long_for_security',
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'highp_dev_jwt_refresh_secret_key_at_least_32_characters',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },
  cors: {
    origins: (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5000').split(',')
  },
  agent: {
    defaultIdleThresholdMinutes: parseInt(process.env.DEFAULT_IDLE_THRESHOLD_MINUTES || '5', 10),
    defaultHeartbeatIntervalSeconds: parseInt(process.env.DEFAULT_HEARTBEAT_INTERVAL_SECONDS || '30', 10),
    staleSessionMultiplier: 3 // Heartbeats missed before marking offline
  }
};
