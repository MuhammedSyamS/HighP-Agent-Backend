"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const app_1 = require("./app");
const config_1 = require("./config");
const database_1 = require("./config/database");
const socketManager_1 = require("./realtime/socketManager");
const reaperService_1 = require("./services/reaperService");
const startServer = async () => {
    try {
        // 1. Connect Database
        await (0, database_1.connectDatabase)();
        // 2. Create Express App & HTTP Server
        const app = (0, app_1.createApp)();
        const server = http_1.default.createServer(app);
        // 3. Initialize Socket.IO
        const io = (0, socketManager_1.initializeSocket)(server);
        // 4. Start Background Stale Session Reaper
        (0, reaperService_1.startReaperService)(15); // Run every 15 seconds
        // 5. Listen
        server.listen(config_1.config.port, '0.0.0.0', () => {
            console.log(`====================================================`);
            console.log(`🚀 HighP Activity Monitor API Server Started`);
            console.log(`📡 Port: ${config_1.config.port} (0.0.0.0)`);
            console.log(`🌍 Environment: ${config_1.config.env}`);
            console.log(`⚡ Socket.IO initialized`);
            console.log(`====================================================`);
        });
        // Graceful Shutdown
        const shutdown = async (signal) => {
            console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
            (0, reaperService_1.stopReaperService)();
            server.close(() => {
                console.log('[Server] HTTP server closed.');
            });
            await (0, database_1.disconnectDatabase)();
            console.log('[Server] MongoDB disconnected.');
            process.exit(0);
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }
    catch (error) {
        console.error('[Server] Fatal startup error:', error);
        process.exit(1);
    }
};
startServer();
