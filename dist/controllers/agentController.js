"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.endAgentSession = exports.startAgentSession = exports.getAgentConfig = exports.syncOfflineEvents = exports.recordActivity = exports.heartbeat = exports.registerDevice = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Device_1 = require("../models/Device");
const Company_1 = require("../models/Company");
const shared_1 = require("@highp/shared");
const heartbeatService_1 = require("../services/heartbeatService");
const activityService_1 = require("../services/activityService");
const sessionService_1 = require("../services/sessionService");
const errorHandler_1 = require("../middleware/errorHandler");
const registerDevice = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile associated with this account.', 400);
        }
        const { deviceIdentifier, deviceName, osInfo, agentVersion } = req.body;
        let device = await Device_1.Device.findOne({
            companyId: req.companyId,
            deviceId: deviceIdentifier
        });
        if (device) {
            if (device.status === shared_1.DeviceStatus.REVOKED) {
                throw new errorHandler_1.AppError('This device has been revoked by your administrator. Contact support.', 403);
            }
            device.deviceName = deviceName;
            device.osInfo = osInfo;
            device.agentVersion = agentVersion;
            device.lastHeartbeatAt = new Date();
            device.lastIpAddress = req.ip;
            await device.save();
        }
        else {
            device = await Device_1.Device.create({
                companyId: new mongoose_1.default.Types.ObjectId(req.companyId),
                employeeId: new mongoose_1.default.Types.ObjectId(employeeId),
                deviceId: deviceIdentifier,
                deviceName,
                osInfo,
                agentVersion,
                status: shared_1.DeviceStatus.ACTIVE,
                lastHeartbeatAt: new Date(),
                lastIpAddress: req.ip
            });
        }
        const company = await Company_1.Company.findById(req.companyId);
        res.status(200).json({
            success: true,
            message: 'Device registered successfully.',
            data: {
                device: {
                    id: device._id,
                    deviceId: device.deviceId,
                    status: device.status
                },
                config: company?.config
            }
        });
    }
    catch (error) {
        next(error);
    }
};
exports.registerDevice = registerDevice;
const heartbeat = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('Unauthorized agent heartbeat: no employee profile', 400);
        }
        const { deviceId, sessionId, timestamp, status, currentApplication, idleSeconds, recentDurationSeconds } = req.body;
        // Verify device status is not revoked
        if (deviceId) {
            const device = await Device_1.Device.findOne({ companyId: req.companyId, deviceId });
            if (device && device.status === shared_1.DeviceStatus.REVOKED) {
                throw new errorHandler_1.AppError('Device has been revoked. Re-authentication required.', 403);
            }
        }
        const result = await (0, heartbeatService_1.processHeartbeat)({
            companyId: req.companyId,
            employeeId,
            deviceId,
            sessionId,
            timestamp,
            status,
            currentApplication,
            idleSeconds,
            recentDurationSeconds,
            ipAddress: req.ip
        });
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
};
exports.heartbeat = heartbeat;
const recordActivity = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile found', 400);
        }
        const { deviceId, sessionId, events } = req.body;
        const result = await (0, activityService_1.ingestActivityEvents)(req.companyId, employeeId, sessionId, deviceId, events);
        res.status(200).json({
            success: true,
            data: result
        });
    }
    catch (error) {
        next(error);
    }
};
exports.recordActivity = recordActivity;
const syncOfflineEvents = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile found', 400);
        }
        const { deviceId, sessionId, events } = req.body;
        const result = await (0, activityService_1.ingestActivityEvents)(req.companyId, employeeId, sessionId, deviceId, events);
        res.status(200).json({
            success: true,
            message: 'Offline events synchronized successfully.',
            data: result
        });
    }
    catch (error) {
        next(error);
    }
};
exports.syncOfflineEvents = syncOfflineEvents;
const getAgentConfig = async (req, res, next) => {
    try {
        const company = await Company_1.Company.findById(req.companyId);
        if (!company) {
            throw new errorHandler_1.AppError('Company not found', 404);
        }
        res.status(200).json({
            success: true,
            data: company.config
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getAgentConfig = getAgentConfig;
const startAgentSession = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile found', 400);
        }
        const { deviceId } = req.body;
        const session = await (0, sessionService_1.startWorkSession)(req.companyId, employeeId, deviceId);
        res.status(200).json({
            success: true,
            data: session
        });
    }
    catch (error) {
        next(error);
    }
};
exports.startAgentSession = startAgentSession;
const endAgentSession = async (req, res, next) => {
    try {
        const employeeId = req.user?.employeeProfileId;
        if (!employeeId) {
            throw new errorHandler_1.AppError('No employee profile found', 400);
        }
        const { sessionId, endReason = 'Agent Session End' } = req.body;
        const session = await (0, sessionService_1.endWorkSession)(req.companyId, employeeId, sessionId, endReason);
        res.status(200).json({
            success: true,
            data: session
        });
    }
    catch (error) {
        next(error);
    }
};
exports.endAgentSession = endAgentSession;
