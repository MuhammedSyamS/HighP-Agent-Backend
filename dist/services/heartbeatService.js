"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processHeartbeat = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const shared_1 = require("@highp/shared");
const EmployeeProfile_1 = require("../models/EmployeeProfile");
const AttendanceSession_1 = require("../models/AttendanceSession");
const Device_1 = require("../models/Device");
const socketManager_1 = require("../realtime/socketManager");
const processHeartbeat = async (params) => {
    const { companyId, employeeId, deviceId, sessionId, timestamp, status, currentApplication, idleSeconds, recentDurationSeconds = 0, ipAddress } = params;
    const now = new Date(timestamp || Date.now());
    const todayStr = now.toISOString().slice(0, 10);
    const profile = await EmployeeProfile_1.EmployeeProfile.findOne({
        _id: employeeId,
        companyId
    });
    if (!profile) {
        return { success: false, message: 'Employee profile not found' };
    }
    // Handle midnight date reset for daily live counters
    if (profile.lastDateReset !== todayStr) {
        profile.todayActiveSeconds = 0;
        profile.todayIdleSeconds = 0;
        profile.todayBreakSeconds = 0;
        profile.lastDateReset = todayStr;
    }
    const previousStatus = profile.currentStatus;
    const previousApp = profile.currentApplication;
    profile.currentStatus = status;
    profile.currentApplication = currentApplication || profile.currentApplication;
    profile.lastHeartbeatAt = now;
    if (status === shared_1.ActivityState.ACTIVE) {
        profile.lastActiveAt = now;
        profile.todayActiveSeconds += recentDurationSeconds;
    }
    else if (status === shared_1.ActivityState.IDLE) {
        profile.todayIdleSeconds += recentDurationSeconds;
    }
    else if (status === shared_1.ActivityState.BREAK) {
        profile.todayBreakSeconds += recentDurationSeconds;
    }
    if (sessionId && mongoose_1.default.Types.ObjectId.isValid(sessionId)) {
        profile.currentSessionId = new mongoose_1.default.Types.ObjectId(sessionId);
        // Update active attendance session counters
        if (recentDurationSeconds > 0) {
            const updateFields = {};
            if (status === shared_1.ActivityState.ACTIVE)
                updateFields.activeSeconds = recentDurationSeconds;
            if (status === shared_1.ActivityState.IDLE)
                updateFields.idleSeconds = recentDurationSeconds;
            if (status === shared_1.ActivityState.BREAK)
                updateFields.breakSeconds = recentDurationSeconds;
            await AttendanceSession_1.AttendanceSession.updateOne({ _id: sessionId, companyId }, { $inc: updateFields });
        }
    }
    await profile.save();
    // Update Device heartbeat timestamp
    if (deviceId) {
        await Device_1.Device.updateOne({ companyId, deviceId }, {
            $set: {
                lastHeartbeatAt: now,
                ...(ipAddress && { lastIpAddress: ipAddress })
            }
        });
    }
    // Real-time broadcast if status or application changed
    if (previousStatus !== status || previousApp !== currentApplication) {
        (0, socketManager_1.emitToCompany)(companyId, 'employee:status_changed', {
            companyId,
            employeeId: profile._id.toString(),
            status: profile.currentStatus,
            currentApplication: profile.currentApplication,
            lastActiveAt: profile.lastActiveAt?.toISOString(),
            todayActiveSeconds: profile.todayActiveSeconds,
            todayIdleSeconds: profile.todayIdleSeconds,
            todayBreakSeconds: profile.todayBreakSeconds
        });
    }
    return {
        success: true,
        serverTime: now.toISOString(),
        status: profile.currentStatus
    };
};
exports.processHeartbeat = processHeartbeat;
