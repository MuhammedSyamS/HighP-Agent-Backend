import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { startWorkSession, endWorkSession } from '../services/sessionService';
import { processHeartbeat } from '../services/heartbeatService';
import { ingestActivityEvents } from '../services/activityService';
import { AttendanceSession } from '../models/AttendanceSession';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AppError } from '../middleware/errorHandler';
import { UserRole, ActivityState, ActivityEventType } from '../shared';

export const startSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this user account', 400);
    }

    const { deviceId } = req.body;
    const session = await startWorkSession(req.companyId!, employeeId, deviceId);

    res.status(200).json({
      success: true,
      message: 'Work session started successfully.',
      data: session
    });
  } catch (error) {
    next(error);
  }
};

export const endSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this user account', 400);
    }

    const { sessionId, endReason } = req.body;
    const session = await endWorkSession(req.companyId!, employeeId, sessionId, endReason);

    res.status(200).json({
      success: true,
      message: 'Work session ended successfully.',
      data: session
    });
  } catch (error) {
    next(error);
  }
};

export const getAttendanceSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId, startDate, endDate, limit = '50' } = req.query;
    const query: any = { companyId: new mongoose.Types.ObjectId(req.companyId) };

    if (req.user?.role === UserRole.EMPLOYEE) {
      query.employeeId = new mongoose.Types.ObjectId(req.user.employeeProfileId);
    } else if (employeeId) {
      query.employeeId = new mongoose.Types.ObjectId(employeeId as string);
    }

    if (startDate || endDate) {
      query.startedAt = {};
      if (startDate) query.startedAt.$gte = new Date(startDate as string);
      if (endDate) query.startedAt.$lte = new Date(endDate as string);
    }

    const sessions = await AttendanceSession.find(query)
      .populate('employeeId', 'employeeCode department')
      .sort({ startedAt: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();

    res.status(200).json({
      success: true,
      data: sessions
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeAttendance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId } = req.params;

    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== employeeId) {
        throw new AppError('Forbidden: Employees can only view their own attendance', 403);
      }
    }

    const sessions = await AttendanceSession.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      employeeId: new mongoose.Types.ObjectId(employeeId)
    })
      .sort({ startedAt: -1 })
      .limit(30)
      .lean();

    res.status(200).json({
      success: true,
      data: sessions
    });
  } catch (error) {
    next(error);
  }
};

export const attendanceHeartbeat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this user account', 400);
    }

    const { status, currentApplication, recentDurationSeconds = 15, idleSeconds = 0 } = req.body;
    const profile = await EmployeeProfile.findOne({
      _id: new mongoose.Types.ObjectId(employeeId),
      companyId: new mongoose.Types.ObjectId(req.companyId)
    });

    if (!profile) {
      throw new AppError('Employee profile not found', 404);
    }

    const sessionId = profile.currentSessionId ? profile.currentSessionId.toString() : undefined;
    const now = new Date();
    let effectiveApp = (currentApplication || profile.currentApplication || 'HighP Web Workspace').trim();
    if (effectiveApp.includes('•') || effectiveApp.includes('Internal Workforce') || effectiveApp.length > 30) {
      effectiveApp = 'HighP Web Workspace';
    }

    const result = await processHeartbeat({
      companyId: req.companyId!,
      employeeId,
      sessionId,
      timestamp: now.toISOString(),
      status: effectiveStatus,
      currentApplication: effectiveApp,
      idleSeconds: Number(idleSeconds) || 0,
      recentDurationSeconds: Number(recentDurationSeconds) || 0,
      ipAddress: req.ip
    });

    // Ingest activity event so timeline visualizer and app usage get updated
    if (effectiveStatus === ActivityState.ACTIVE && Number(recentDurationSeconds) > 0 && sessionId) {
      const dur = Number(recentDurationSeconds);
      const eventStart = new Date(now.getTime() - dur * 1000);
      try {
        await ingestActivityEvents(
          req.companyId!,
          employeeId,
          sessionId,
          undefined,
          [
            {
              eventId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: ActivityEventType.APPLICATION_FOCUS,
              applicationName: effectiveApp,
              processName: 'browser',
              windowTitleSanitized: effectiveApp,
              startedAt: eventStart.toISOString(),
              endedAt: now.toISOString(),
              durationSeconds: dur
            }
          ]
        );
      } catch (err) {
        console.error('[Web Heartbeat] Event ingestion warning:', err);
      }
    }

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

