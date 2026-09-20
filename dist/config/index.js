"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../../.env') });
dotenv_1.default.config();
exports.config = {
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
