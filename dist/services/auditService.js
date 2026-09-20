"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAudit = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const AuditLog_1 = require("../models/AuditLog");
const logAudit = async (params) => {
    try {
        await AuditLog_1.AuditLog.create({
            companyId: new mongoose_1.default.Types.ObjectId(params.companyId),
            ...(params.userId && { userId: new mongoose_1.default.Types.ObjectId(params.userId) }),
            action: params.action,
            resource: params.resource,
            details: params.details,
            ipAddress: params.ipAddress,
            timestamp: new Date()
        });
    }
    catch (err) {
        console.error('[AuditService] Error logging audit action:', err);
    }
};
exports.logAudit = logAudit;
