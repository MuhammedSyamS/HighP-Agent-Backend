import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { config } from './config';

export const createApp = (): Express => {
  const app = express();

  // Security Headers
  app.use(helmet());

  // CORS with 24-hour preflight caching
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow all in dev or check against whitelist
        if (!origin || config.cors.origins.includes(origin) || config.env === 'development') {
          callback(null, true);
        } else {
          callback(new Error('CORS blocked origin'));
        }
      },
      credentials: true,
      maxAge: 86400
    })
  );

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
