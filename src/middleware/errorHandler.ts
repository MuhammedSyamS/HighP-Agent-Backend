import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (err.name === 'CastError') {
    res.status(404).json({
      success: false,
      message: 'Resource not found'
    });
    return;
  }

  const statusCode = err.statusCode || (err.status ? err.status : 500);
  const message = err.message || 'An unexpected internal server error occurred';

  if (statusCode >= 500) {
    console.error(`[Error] [${req.method} ${req.url}]`, err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

