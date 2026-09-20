import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { initializeSocket } from './realtime/socketManager';
import { startReaperService, stopReaperService } from './services/reaperService';

// HighP Enterprise Backend Server
const startServer = async () => {
  try {
    // 1. Connect Database
    await connectDatabase();

    // 2. Create Express App & HTTP Server
    const app = createApp();
    const server = http.createServer(app);

    // 3. Initialize Socket.IO
    const io = initializeSocket(server);

    // 4. Start Background Stale Session Reaper
    startReaperService(15); // Run every 15 seconds

    // 5. Listen
    server.listen(config.port, '0.0.0.0', () => {
      console.log(`====================================================`);
      console.log(`🚀 HighP Activity Monitor API Server Started`);
      console.log(`📡 Port: ${config.port} (0.0.0.0)`);
      console.log(`🌍 Environment: ${config.env}`);
      console.log(`⚡ Socket.IO initialized`);
      console.log(`====================================================`);
    });


    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
      stopReaperService();
      server.close(() => {
        console.log('[Server] HTTP server closed.');
      });
      await disconnectDatabase();
      console.log('[Server] MongoDB disconnected.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('[Server] Fatal startup error:', error);
    process.exit(1);
  }
};

startServer();
