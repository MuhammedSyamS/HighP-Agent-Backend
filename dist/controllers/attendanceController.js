"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmployeeAttendance = exports.getAttendanceSessions = exports.endSession = exports.startSession = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const sessionService_1 = require("../services/sessionService");
const AttendanceSession_1 = require("../models/AttendanceSession");
const errorHandler_1 = require("../middleware/errorHandler");
const startSession = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile associated with this user account', 400);
        }
        const { deviceId } = req.body;
        const session = await (0, sessionService_1.startWorkSession)(req.companyId, employeeId, deviceId);
        res.status(200).json({
            success: true,
            message: 'Work session started successfully.',
            data: session
        });
    }
    catch (error) {
        next(error);
    }
};
exports.startSession = startSession;
const endSession = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile associated with this user account', 400);
        }
        const { sessionId, endReason } = req.body;
        const session = await (0, sessionService_1.endWorkSession)(req.companyId, employeeId, sessionId, endReason);
        res.status(200).json({
            success: true,
            message: 'Work session ended successfully.',
            data: session
        });
    }
    catch (error) {
        next(error);
    }
};
exports.endSession = endSession;
const getAttendanceSessions = async (req, res, next) => {
    try {
        const { employeeId, startDate, endDate, limit = '50' } = req.query;
        const query = { companyId: new mongoose_1.default.Types.ObjectId(req.companyId) };
        if (employeeId) {
            query.employeeId = new mongoose_1.default.Types.ObjectId(employeeId);
        }
        if (startDate || endDate) {
            query.startedAt = {};
            if (startDate)
                query.startedAt.$gte = new Date(startDate);
            if (endDate)
                query.startedAt.$lte = new Date(endDate);
        }
        const sessions = await AttendanceSession_1.AttendanceSession.find(query)
            .populate('employeeId', 'employeeCode department')
            .sort({ startedAt: -1 })
            .limit(parseInt(limit, 10))
            .lean();
        res.status(200).json({
            success: true,
            data: sessions
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getAttendanceSessions = getAttendanceSessions;
const getEmployeeAttendance = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        const sessions = await AttendanceSession_1.AttendanceSession.find({
            companyId: new mongoose_1.default.Types.ObjectId(req.companyId),
            employeeId: new mongoose_1.default.Types.ObjectId(employeeId)
        })
            .sort({ startedAt: -1 })
            .limit(30)
            .lean();
        res.status(200).json({
            success: true,
            data: sessions
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getEmployeeAttendance = getEmployeeAttendance;
