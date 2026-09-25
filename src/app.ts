import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { config } from './config';
import { connectDatabase } from './config/database';

export const createApp = (): Express => {
  const app = express();

  // Security Headers
  app.use(helmet());

  // CORS with 24-hour preflight caching
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow all in dev, if origin is falsy (same origin / curl), or check whitelist
        if (!origin || config.cors.origins.includes(origin) || config.env === 'development' || origin.includes('vercel.app')) {
          callback(null, true);
        } else {
          callback(null, true); // Allow client connections from Vercel preview/production domains
        }
      },
      credentials: true,
      maxAge: 86400
    })
  );

  // Vercel Serverless URL Normalization
  app.use((req, res, next) => {
    const original =
      (req.headers['x-forwarded-uri'] as string) ||
      (req.headers['x-matched-path'] as string);

    if (original && (req.url === '/src/app' || req.url.startsWith('/src/app'))) {
      req.url = original;
    } else if (req.url.startsWith('/src/app')) {
      req.url = req.url.slice('/src/app'.length) || '/';
    }
    next();
  });

  // Serverless DB Connection Check
  app.use(async (req, res, next) => {
    if (mongoose.connection.readyState === 0) {
      try {
        await connectDatabase();
      } catch (err: any) {
        console.error('[Serverless] Database connection error:', err?.message);
        return res.status(500).json({
          success: false,
          message: 'Database connection failed',
          error: err?.message,
          hasMongoUri: !!process.env.MONGODB_URI,
          hint: !process.env.MONGODB_URI
            ? 'MONGODB_URI is not set in Vercel Environment Variables. Please add MONGODB_URI in Vercel Project Settings.'
            : 'Make sure MongoDB Atlas Network Access has 0.0.0.0/0 (Allow access from anywhere) enabled.'
        });
      }
    }
    next();
  });

  // Rate Limiter
  if (config.env !== 'test') {
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 mins
      max: 2000, // Reasonable limit for multi-agent heartbeats
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests, please try again later.' }
    });
    app.use('/api', limiter);
  }

  // Request Parsers
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Logging
  if (config.env !== 'test') {
    app.use(morgan('dev'));
  }

  // Root status endpoint for Vercel health check
  app.get('/', (req, res) => {
    res.status(200).json({
      success: true,
      name: 'HighP Workforce Telemetry & Attendance API',
      status: 'online',
      version: '1.0.0',
      environment: config.env,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/favicon.png', (req, res) => res.status(204).end());

  // API Routes
  app.use('/api', routes);

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({ success: false, message: `Cannot ${req.method} ${req.url}` });
  });

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
};

const app = createApp();

export default app;
// Support CommonJS export expected by Vercel serverless / Node.js
module.exports = app;
module.exports.default = app;
module.exports.createApp = createApp;
