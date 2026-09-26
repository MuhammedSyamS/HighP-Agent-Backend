import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Device } from '../models/Device';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { Company } from '../models/Company';
import { ActivityEvent } from '../models/ActivityEvent';
import { DeviceStatus, ActivityState } from '../shared';
import { processHeartbeat } from '../services/heartbeatService';
import { ingestActivityEvents } from '../services/activityService';
import { startWorkSession, endWorkSession } from '../services/sessionService';
import { AppError } from '../middleware/errorHandler';

export const registerDevice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this account.', 400);
    }

    const { deviceIdentifier, deviceName, osInfo, agentVersion } = req.body;

    let device = await Device.findOne({
      companyId: req.companyId,
      deviceId: deviceIdentifier
    });

    if (device) {
      if (device.status === DeviceStatus.REVOKED) {
        throw new AppError('This device has been revoked by your administrator. Contact support.', 403);
      }
      device.deviceName = deviceName;
      device.osInfo = osInfo;
      device.agentVersion = agentVersion;
      device.lastHeartbeatAt = new Date();
      device.lastIpAddress = req.ip;
      await device.save();
    } else {
      device = await Device.create({
        companyId: new mongoose.Types.ObjectId(req.companyId),
        employeeId: new mongoose.Types.ObjectId(employeeId),
        deviceId: deviceIdentifier,
        deviceName,
        osInfo,
        agentVersion,
        status: DeviceStatus.ACTIVE,
        lastHeartbeatAt: new Date(),
        lastIpAddress: req.ip
      });
    }

    const company = await Company.findById(req.companyId);

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
  } catch (error) {
    next(error);
  }
};

export const heartbeat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('Unauthorized agent heartbeat: no employee profile', 400);
    }

    const { deviceId, sessionId, timestamp, status, currentApplication, idleSeconds, recentDurationSeconds } = req.body;

    // Verify device status is not revoked
    if (deviceId) {
      const device = await Device.findOne({ companyId: req.companyId, deviceId });
      if (device && device.status === DeviceStatus.REVOKED) {
        throw new AppError('Device has been revoked. Re-authentication required.', 403);
      }
    }

    const result = await processHeartbeat({
      companyId: req.companyId!,
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
  } catch (error) {
    next(error);
  }
};

export const recordActivity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile found', 400);
    }

    const { deviceId, sessionId, events } = req.body;
    const result = await ingestActivityEvents(
      req.companyId!,
      employeeId,
      sessionId,
      deviceId,
      events
    );

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const syncOfflineEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile found', 400);
    }

    const { deviceId, sessionId, events } = req.body;
    const result = await ingestActivityEvents(
      req.companyId!,
      employeeId,
      sessionId,
      deviceId,
      events
    );

    res.status(200).json({
      success: true,
      message: 'Offline events synchronized successfully.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const getAgentConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const company = await Company.findById(req.companyId);
    if (!company) {
      throw new AppError('Company not found', 404);
    }

    res.status(200).json({
      success: true,
      data: company.config
    });
  } catch (error) {
    next(error);
  }
};

export const startAgentSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile found', 400);
    }

    const { deviceId } = req.body;
    const session = await startWorkSession(req.companyId!, employeeId, deviceId);

    res.status(200).json({
      success: true,
      data: session
    });
  } catch (error) {
    next(error);
  }
};

export const endAgentSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile found', 400);
    }

    const { sessionId, endReason = 'Agent Session End' } = req.body;
    const session = await endWorkSession(req.companyId!, employeeId, sessionId, endReason);

    res.status(200).json({
      success: true,
      data: session
    });
  } catch (error) {
    next(error);
  }
};

export const getAgentHealth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile found', 400);
    }

    const profile = await EmployeeProfile.findOne({
      _id: new mongoose.Types.ObjectId(employeeId),
      companyId: new mongoose.Types.ObjectId(req.companyId)
    }).lean();

    if (!profile) {
      throw new AppError('Employee profile not found', 404);
    }

    const device = profile.currentDeviceId
      ? await Device.findById(profile.currentDeviceId).lean()
      : null;

    const lastEvent = await ActivityEvent.findOne({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      employeeId: new mongoose.Types.ObjectId(employeeId)
    })
      .sort({ startedAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        serverConnectivity: 'HEALTHY',
        serverTimestamp: new Date().toISOString(),
        agent: {
          employeeId: profile._id,
          employeeCode: profile.employeeCode,
          currentStatus: profile.currentStatus,
          currentApplication: profile.currentApplication,
          lastHeartbeat: profile.lastHeartbeatAt,
          currentSession: profile.currentSessionId
        },
        device: device
          ? {
              id: device._id,
              deviceId: device.deviceId,
              deviceName: device.deviceName,
              status: device.status,
              lastHeartbeat: device.lastHeartbeatAt,
              platform: device.osInfo?.platform
            }
          : null,
        lastEvent: lastEvent
          ? {
              eventId: lastEvent.eventId,
              type: lastEvent.type,
              applicationName: lastEvent.applicationName,
              durationSeconds: lastEvent.durationSeconds,
              startedAt: lastEvent.startedAt,
              endedAt: lastEvent.endedAt
            }
          : null
      }
    });
  } catch (error) {
    next(error);
  }
};
