import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { getEmployeeTimeline } from '../services/activityService';
import { ActivityEvent } from '../models/ActivityEvent';
import { AppError } from '../middleware/errorHandler';
import { UserRole, ActivityState } from '../shared';

export const getTimeline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const { date } = req.query;

    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== employeeId) {
        throw new AppError('Forbidden: Employees can only view their own activity timeline', 403);
      }
    }

    const dateStr = (date as string) || new Date().toISOString().slice(0, 10);
    const events = await getEmployeeTimeline(req.companyId!, employeeId, dateStr);

    res.status(200).json({
      success: true,
      data: {
        employeeId,
        date: dateStr,
        events
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getRecentActivity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId, limit = '20' } = req.query;
    const query: any = {
      companyId: new mongoose.Types.ObjectId(req.companyId),
      applicationName: { $not: /highp|internal workforce|highphaus|electron/i }
    };

    if (req.user?.role === UserRole.EMPLOYEE) {
      query.employeeId = new mongoose.Types.ObjectId(req.user.employeeProfileId);
    } else if (employeeId) {
      query.employeeId = new mongoose.Types.ObjectId(employeeId as string);
    }

    const events = await ActivityEvent.find(query)
      .populate({
        path: 'employeeId',
        select: 'employeeCode userId currentApplication currentStatus',
        populate: {
          path: 'userId',
          select: 'firstName lastName email'
        }
      })
      .sort({ startedAt: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();

    // Include currently working employees if not already represented at the top
    const activeEmployees = await mongoose.model('EmployeeProfile').find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      currentStatus: ActivityState.ACTIVE,
      currentApplication: { $exists: true, $nin: ['', null] },
      ...(req.user?.role === UserRole.EMPLOYEE
        ? { _id: new mongoose.Types.ObjectId(req.user.employeeProfileId) }
        : employeeId
        ? { _id: new mongoose.Types.ObjectId(employeeId as string) }
        : {})
    })
      .populate('userId', 'firstName lastName email')
      .lean();

    const liveItems: any[] = [];
    for (const emp of activeEmployees as any[]) {
      const cleanApp = (emp.currentApplication || '').trim();
      const hasRecentMatch = events.some(
        (e: any) =>
          e.employeeId?._id?.toString() === emp._id.toString() &&
          e.applicationName?.toLowerCase() === cleanApp.toLowerCase() &&
          Date.now() - new Date(e.endedAt || e.startedAt).getTime() < 60000
      );

      if (!hasRecentMatch && cleanApp) {
        liveItems.push({
          _id: `live-${emp._id}`,
          eventId: `live-${emp._id}`,
          type: 'APPLICATION_FOCUS',
          applicationName: cleanApp,
          startedAt: emp.lastActiveAt || new Date(),
          endedAt: new Date(),
          durationSeconds: 15,
          isLiveNow: true,
          employeeId: {
            _id: emp._id,
            employeeCode: emp.employeeCode,
            currentStatus: emp.currentStatus,
            currentApplication: cleanApp,
            userId: emp.userId
          }
        });
      }
    }

    const combined = [...liveItems, ...events].slice(0, parseInt(limit as string, 10));

    res.status(200).json({
      success: true,
      data: combined
    });
  } catch (error) {
    next(error);
  }
};
