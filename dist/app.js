"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const routes_1 = __importDefault(require("./routes"));
const errorHandler_1 = require("./middleware/errorHandler");
const config_1 = require("./config");
const createApp = () => {
    const app = (0, express_1.default)();
    // Security Headers
    app.use((0, helmet_1.default)());
    // CORS with 24-hour preflight caching
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            // Allow all in dev or check against whitelist
            if (!origin || config_1.config.cors.origins.includes(origin) || config_1.config.env === 'development') {
                callback(null, true);
            }
            else {
                callback(new Error('CORS blocked origin'));
            }
        },
        credentials: true,
        maxAge: 86400
    }));
    // Rate Limiter
    if (config_1.config.env !== 'test') {
        const limiter = (0, express_rate_limit_1.default)({
            windowMs: 15 * 60 * 1000, // 15 mins
            max: 2000, // Reasonable limit for multi-agent heartbeats
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, message: 'Too many requests, please try again later.' }
        });
        app.use('/api', limiter);
    }
    // Request Parsers
    app.use(express_1.default.json({ limit: '5mb' }));
    app.use(express_1.default.urlencoded({ extended: true, limit: '5mb' }));
    // Logging
    if (config_1.config.env !== 'test') {
        app.use((0, morgan_1.default)('dev'));
    }
    // API Routes
    app.use('/api', routes_1.default);
    // 404 Handler
    app.use((req, res) => {
        res.status(404).json({ success: false, message: `Cannot ${req.method} ${req.url}` });
    });
    // Centralized Error Handling
    app.use(errorHandler_1.errorHandler);
    return app;
};
exports.createApp = createApp;
