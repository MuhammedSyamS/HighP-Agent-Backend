"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Company = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const shared_1 = require("@highp/shared");
const CompanySchema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    config: {
        idleThresholdMinutes: { type: Number, default: shared_1.DEFAULT_IDLE_THRESHOLD_MINUTES },
        heartbeatIntervalSeconds: { type: Number, default: shared_1.DEFAULT_HEARTBEAT_INTERVAL_SECONDS },
        offlineSyncBatchLimit: { type: Number, default: 100 },
        retentionDays: { type: Number, default: shared_1.DEFAULT_RETENTION_DAYS },
        allowManualBreaks: { type: Boolean, default: true },
        appCategories: {
            type: [
                {
                    name: { type: String, required: true },
                    color: { type: String, required: true },
                    apps: [{ type: String }]
                }
            ],
            default: shared_1.DEFAULT_APP_CATEGORIES
        },
        allowedTrackingHours: {
            enabled: { type: Boolean, default: false },
            startTime: { type: String, default: '09:00' },
            endTime: { type: String, default: '18:00' },
            timezone: { type: String, default: 'UTC' }
        }
    }
}, { timestamps: true });
exports.Company = mongoose_1.default.model('Company', CompanySchema);
