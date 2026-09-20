import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Device } from '../models/Device';
import { DeviceStatus, AuditAction } from '../shared';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditService';

export const getDevices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId, status } = req.query;
    const query: any = { companyId: new mongoose.Types.ObjectId(req.companyId) };

    if (employeeId) {
      query.employeeId = new mongoose.Types.ObjectId(employeeId as string);
    }
    if (status) {
      query.status = status;
    }

    const devices = await Device.find(query)
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
  } catch (error) {
    next(error);
  }
};

export const revokeDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const device = await Device.findOne({ _id: id, companyId: req.companyId });
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    device.status = DeviceStatus.REVOKED;
    await device.save();

    await logAudit({
      companyId: req.companyId!,
      userId: req.user?.userId,
      action: AuditAction.DEVICE_REVOKED,
      resource: 'Device',
      details: { deviceId: device.deviceId, deviceName: device.deviceName },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Device revoked successfully.',
      data: device
    });
  } catch (error) {
    next(error);
  }
};
