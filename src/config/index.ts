import dotenv from 'dotenv';
import path from 'path';

// Priority: explicit NODE_ENV file (.env.production / .env.development) -> local .env -> root .env
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = nodeEnv === 'production' ? '.env.production' : '.env';

dotenv.config({ path: path.resolve(process.cwd(), envFile) });
dotenv.config({ path: path.resolve(__dirname, `../../${envFile}`) });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/highp_activity_monitor',
  jwt: {
    secret: process.env.JWT_SECRET || 'highp_dev_jwt_secret_key_at_least_32_characters_long_for_security',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'highp_dev_jwt_refresh_secret_key_at_least_32_characters',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  },
  cors: {
    origins: (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5000').split(',').map((s) => s.trim())
  },
  agent: {
    defaultIdleThresholdMinutes: parseInt(process.env.DEFAULT_IDLE_THRESHOLD_MINUTES || '5', 10),
    defaultHeartbeatIntervalSeconds: parseInt(process.env.DEFAULT_HEARTBEAT_INTERVAL_SECONDS || '30', 10),
    staleSessionMultiplier: 3 // Heartbeats missed before marking offline
  },
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  redisUrl: process.env.REDIS_URL || undefined
};
