"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.endBreak = exports.startBreak = exports.endWorkSession = exports.startWorkSession = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const shared_1 = require("@highp/shared");
const AttendanceSession_1 = require("../models/AttendanceSession");
const Break_1 = require("../models/Break");
const EmployeeProfile_1 = require("../models/EmployeeProfile");
const errorHandler_1 = require("../middleware/errorHandler");
const socketManager_1 = require("../realtime/socketManager");
const startWorkSession = async (companyId, employeeId, deviceId) => {
    const profile = await EmployeeProfile_1.EmployeeProfile.findOne({ _id: employeeId, companyId });
    if (!profile) {
        throw new errorHandler_1.AppError('Employee profile not found.', 404);
    }
    // If already in an active session, return current session
    if (profile.currentSessionId) {
        const existing = await AttendanceSession_1.AttendanceSession.findOne({
            _id: profile.currentSessionId,
            companyId,
            status: shared_1.SessionStatus.ACTIVE
        });
        if (existing) {
            return existing;
        }
    }
    const now = new Date();
    const session = await AttendanceSession_1.AttendanceSession.create({
        companyId: new mongoose_1.default.Types.ObjectId(companyId),
        employeeId: new mongoose_1.default.Types.ObjectId(employeeId),
        ...(deviceId && { deviceId: new mongoose_1.default.Types.ObjectId(deviceId) }),
        startedAt: now,
        status: shared_1.SessionStatus.ACTIVE
    });
    profile.currentSessionId = session._id;
    if (deviceId)
        profile.currentDeviceId = new mongoose_1.default.Types.ObjectId(deviceId);
    profile.currentStatus = shared_1.ActivityState.ACTIVE;
    profile.lastActiveAt = now;
    await profile.save();
    (0, socketManager_1.emitToCompany)(companyId, 'employee:session_started', {
        companyId,
        employeeId: profile._id.toString(),
        sessionId: session._id.toString(),
        startedAt: now.toISOString()
    });
    (0, socketManager_1.emitToCompany)(companyId, 'employee:status_changed', {
        companyId,
        employeeId: profile._id.toString(),
        status: shared_1.ActivityState.ACTIVE,
        currentApplication: profile.currentApplication,
        lastActiveAt: now.toISOString()
    });
    return session;
};
exports.startWorkSession = startWorkSession;
const endWorkSession = async (companyId, employeeId, sessionId, endReason = 'User Manual End') => {
    const profile = await EmployeeProfile_1.EmployeeProfile.findOne({ _id: employeeId, companyId });
    if (!profile) {
        throw new errorHandler_1.AppError('Employee profile not found.', 404);
    }
    const targetSessionId = sessionId || profile.currentSessionId;
    if (!targetSessionId) {
        throw new errorHandler_1.AppError('No active work session found to end.', 400);
    }
    const session = await AttendanceSession_1.AttendanceSession.findOne({
        _id: targetSessionId,
        companyId
    });
    if (!session) {
        throw new errorHandler_1.AppError('Session not found.', 404);
    }
    const now = new Date();
    // Close any ongoing break in this session
    const ongoingBreak = await Break_1.Break.findOne({
        sessionId: session._id,
        companyId,
        endedAt: { $exists: false }
    });
    if (ongoingBreak) {
        ongoingBreak.endedAt = now;
        ongoingBreak.durationSeconds = Math.max(0, Math.round((now.getTime() - ongoingBreak.startedAt.getTime()) / 1000));
        await ongoingBreak.save();
        session.breakSeconds += ongoingBreak.durationSeconds;
    }
    session.endedAt = now;
    session.status = shared_1.SessionStatus.COMPLETED;
    session.endReason = endReason;
    await session.save();
    profile.currentSessionId = undefined;
    profile.currentStatus = shared_1.ActivityState.OFFLINE;
    profile.currentApplication = '';
    await profile.save();
    (0, socketManager_1.emitToCompany)(companyId, 'employee:session_ended', {
        companyId,
        employeeId: profile._id.toString(),
        sessionId: session._id.toString(),
        endedAt: now.toISOString(),
        totalActiveSeconds: session.activeSeconds,
        totalIdleSeconds: session.idleSeconds
    });
    (0, socketManager_1.emitToCompany)(companyId, 'employee:status_changed', {
        companyId,
        employeeId: profile._id.toString(),
        status: shared_1.ActivityState.OFFLINE,
        currentApplication: ''
    });
    return session;
};
exports.endWorkSession = endWorkSession;
const startBreak = async (companyId, employeeId, reason = shared_1.BreakReason.OTHER, note) => {
    const profile = await EmployeeProfile_1.EmployeeProfile.findOne({ _id: employeeId, companyId });
    if (!profile) {
        throw new errorHandler_1.AppError('Employee profile not found.', 404);
    }
    if (!profile.currentSessionId) {
        throw new errorHandler_1.AppError('Cannot start break without an active work session.', 400);
    }
    // Check if already on break
    const existingBreak = await Break_1.Break.findOne({
        companyId,
        employeeId,
        sessionId: profile.currentSessionId,
        endedAt: { $exists: false }
    });
    if (existingBreak) {
        throw new errorHandler_1.AppError('A break is already in progress.', 400);
    }
    const now = new Date();
    const breakRecord = await Break_1.Break.create({
        companyId: new mongoose_1.default.Types.ObjectId(companyId),
        employeeId: new mongoose_1.default.Types.ObjectId(employeeId),
        sessionId: profile.currentSessionId,
        startedAt: now,
        reason,
        note
    });
    profile.currentStatus = shared_1.ActivityState.BREAK;
    await profile.save();
    (0, socketManager_1.emitToCompany)(companyId, 'employee:break_started', {
        companyId,
        employeeId: profile._id.toString(),
        breakId: breakRecord._id.toString(),
        reason: breakRecord.reason,
        startedAt: now.toISOString()
    });
    (0, socketManager_1.emitToCompany)(companyId, 'employee:status_changed', {
        companyId,
        employeeId: profile._id.toString(),
        status: shared_1.ActivityState.BREAK,
        currentApplication: 'On Break'
    });
    return breakRecord;
};
exports.startBreak = startBreak;
const endBreak = async (companyId, employeeId, breakId) => {
    const profile = await EmployeeProfile_1.EmployeeProfile.findOne({ _id: employeeId, companyId });
    if (!profile) {
        throw new errorHandler_1.AppError('Employee profile not found.', 404);
    }
    const query = {
        companyId,
        employeeId,
        endedAt: { $exists: false }
    };
    if (breakId)
        query._id = breakId;
    const breakRecord = await Break_1.Break.findOne(query);
    if (!breakRecord) {
        throw new errorHandler_1.AppError('No ongoing break found to end.', 400);
    }
    const now = new Date();
    breakRecord.endedAt = now;
    breakRecord.durationSeconds = Math.max(0, Math.round((now.getTime() - breakRecord.startedAt.getTime()) / 1000));
    await breakRecord.save();
    // Accumulate to today's break total and session break total
    profile.todayBreakSeconds += breakRecord.durationSeconds;
    profile.currentStatus = shared_1.ActivityState.ACTIVE;
    profile.lastActiveAt = now;
    await profile.save();
    if (profile.currentSessionId) {
        await AttendanceSession_1.AttendanceSession.updateOne({ _id: profile.currentSessionId, companyId }, { $inc: { breakSeconds: breakRecord.durationSeconds } });
    }
    (0, socketManager_1.emitToCompany)(companyId, 'employee:break_ended', {
        companyId,
        employeeId: profile._id.toString(),
        breakId: breakRecord._id.toString(),
        durationSeconds: breakRecord.durationSeconds,
        endedAt: now.toISOString()
    });
    (0, socketManager_1.emitToCompany)(companyId, 'employee:status_changed', {
        companyId,
        employeeId: profile._id.toString(),
        status: shared_1.ActivityState.ACTIVE,
        currentApplication: profile.currentApplication
    });
    return breakRecord;
};
exports.endBreak = endBreak;
