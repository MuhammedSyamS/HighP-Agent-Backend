"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeDevice = exports.getDevices = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Device_1 = require("../models/Device");
const shared_1 = require("@highp/shared");
const errorHandler_1 = require("../middleware/errorHandler");
const auditService_1 = require("../services/auditService");
const getDevices = async (req, res, next) => {
    try {
        const { employeeId, status } = req.query;
        const query = { companyId: new mongoose_1.default.Types.ObjectId(req.companyId) };
        if (employeeId) {
            query.employeeId = new mongoose_1.default.Types.ObjectId(employeeId);
        }
        if (status) {
            query.status = status;
        }
        const devices = await Device_1.Device.find(query)
            .populate({
            path: 'employeeId',
            select: 'employeeCode department userId',
            populate: {
                path: 'userId',
                select: 'firstName lastName email'
            }
        })
            .sort({ lastHeartbeatAt: -1 })
            .lean();
        res.status(200).json({
            success: true,
            data: devices
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getDevices = getDevices;
const revokeDevice = async (req, res, next) => {
    try {
        const { id } = req.params;
        const device = await Device_1.Device.findOne({ _id: id, companyId: req.companyId });
        if (!device) {
            throw new errorHandler_1.AppError('Device not found', 404);
        }
        device.status = shared_1.DeviceStatus.REVOKED;
        await device.save();
        await (0, auditService_1.logAudit)({
            companyId: req.companyId,
            userId: req.user?.userId,
            action: shared_1.AuditAction.DEVICE_REVOKED,
            resource: 'Device',
            details: { deviceId: device.deviceId, deviceName: device.deviceName },
            ipAddress: req.ip
        });
        res.status(200).json({
            success: true,
            message: 'Device revoked successfully.',
            data: device
        });
    }
    catch (error) {
        next(error);
    }
};
exports.revokeDevice = revokeDevice;
