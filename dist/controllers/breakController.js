"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBreaks = exports.end = exports.start = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const sessionService_1 = require("../services/sessionService");
const Break_1 = require("../models/Break");
const errorHandler_1 = require("../middleware/errorHandler");
const start = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile associated with this user account', 400);
        }
        const { reason, note } = req.body;
        const breakRecord = await (0, sessionService_1.startBreak)(req.companyId, employeeId, reason, note);
        res.status(200).json({
            success: true,
            message: 'Break started.',
            data: breakRecord
        });
    }
    catch (error) {
        next(error);
    }
};
exports.start = start;
const end = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile associated with this user account', 400);
        }
        const { breakId } = req.body;
        const breakRecord = await (0, sessionService_1.endBreak)(req.companyId, employeeId, breakId);
        res.status(200).json({
            success: true,
            message: 'Break ended.',
            data: breakRecord
        });
    }
    catch (error) {
        next(error);
    }
};
exports.end = end;
const getBreaks = async (req, res, next) => {
    try {
        const { employeeId, sessionId } = req.query;
        const query = { companyId: new mongoose_1.default.Types.ObjectId(req.companyId) };
        if (employeeId)
            query.employeeId = new mongoose_1.default.Types.ObjectId(employeeId);
        if (sessionId)
            query.sessionId = new mongoose_1.default.Types.ObjectId(sessionId);
        const breaks = await Break_1.Break.find(query).sort({ startedAt: -1 }).limit(50).lean();
        res.status(200).json({
            success: true,
            data: breaks
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getBreaks = getBreaks;
