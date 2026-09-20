"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    isOperational;
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
const errorHandler = (err, req, res, next) => {
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
exports.errorHandler = errorHandler;
