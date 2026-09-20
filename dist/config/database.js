"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectDatabase = exports.connectDatabase = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const index_1 = require("./index");
const connectDatabase = async () => {
    const primaryUri = index_1.config.mongoUri;
    const localFallbackUri = 'mongodb://127.0.0.1:27017/highphaus_workforce';
    const connectOptions = {
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
        const conn = await mongoose_1.default.connect(primaryUri, connectOptions);
        console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
        return conn;
    }
    catch (error) {
        console.warn(`[Database] Primary MongoDB connection failed (${error.message}).`);
        // Check if it's an Atlas IP whitelist / TLS error
        if (primaryUri.includes('mongodb.net')) {
            console.warn(`[Database] ⚠️ MongoDB Atlas Notice: If you see "SSL alert number 80" or "ServerSelectionError", please ensure your current IP address is whitelisted in MongoDB Atlas under "Network Access" (or add 0.0.0.0/0 for anywhere access).`);
        }
        console.log(`[Database] Attempting connection to local MongoDB fallback (${localFallbackUri})...`);
        try {
            const fallbackConn = await mongoose_1.default.connect(localFallbackUri, {
                ...connectOptions,
                serverSelectionTimeoutMS: 3000
            });
            console.log(`[Database] Connected to Local MongoDB Fallback: ${fallbackConn.connection.host}`);
            return fallbackConn;
        }
        catch (fallbackError) {
            console.error('[Database] Both primary and fallback MongoDB connections failed.');
            throw error;
        }
    }
};
exports.connectDatabase = connectDatabase;
const disconnectDatabase = async () => {
    await mongoose_1.default.disconnect();
};
exports.disconnectDatabase = disconnectDatabase;
