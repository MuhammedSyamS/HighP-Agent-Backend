import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { getEmployeeTimeline } from '../services/activityService';
import { ActivityEvent } from '../models/ActivityEvent';
import { AppError } from '../middleware/errorHandler';
import { UserRole, ActivityState } from '../shared';

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    const { employeeId, application, category, status, date, limit = '50' } = req.query;
    const query: any = {
      companyId: new mongoose.Types.ObjectId(req.companyId),
      applicationName: { $not: /highp|internal workforce|highphaus|electron/i }
    };

    if (req.user?.role === UserRole.EMPLOYEE) {
      query.employeeId = new mongoose.Types.ObjectId(req.user.employeeProfileId);
    } else if (employeeId && employeeId !== 'ALL') {
      query.employeeId = new mongoose.Types.ObjectId(employeeId as string);
    }

    if (category && category !== 'ALL') {
      query.category = category as string;
    }

    if (application && application !== 'ALL') {
      query.applicationName = new RegExp(escapeRegex(application as string), 'i');
    }

    if (status && status !== 'ALL') {
      query.status = status as string;
    }

    if (date) {
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      query.startedAt = { $gte: startOfDay, $lte: endOfDay };
    }

    const events: any[] = await ActivityEvent.find(query)
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

    const todayStr = new Date().toISOString().slice(0, 10);
    const liveItems: any[] = [];
    for (const emp of activeEmployees as any[]) {
      const cleanApp = (emp.currentApplication || '').trim();
      if (!cleanApp) continue;

      const existingMatch = events.find(
        (e: any) =>
          e.employeeId?._id?.toString() === emp._id.toString() &&
          e.applicationName?.toLowerCase() === cleanApp.toLowerCase() &&
          (e.status === 'ACTIVE' || Date.now() - new Date(e.endedAt || e.startedAt).getTime() < 300000)
      );

      const usageDoc = await mongoose.model('ApplicationUsage').findOne({
        companyId: new mongoose.Types.ObjectId(req.companyId),
        employeeId: emp._id,
        date: todayStr,
        applicationName: cleanApp
      }).lean() as any;

      if (existingMatch) {
        existingMatch.isLiveNow = true;
        if (usageDoc?.totalSeconds && usageDoc.totalSeconds > (existingMatch.durationSeconds || 0)) {
          existingMatch.todayTotalSeconds = usageDoc.totalSeconds;
        }
      } else {
        const elapsedSec = emp.lastActiveAt
          ? Math.max(5, Math.round((Date.now() - new Date(emp.lastActiveAt).getTime()) / 1000))
          : 15;
        const appStart = emp.currentAppStartedAt ? new Date(emp.currentAppStartedAt) : null;
        const liveDuration = appStart && !isNaN(appStart.getTime())
          ? Math.max(1, Math.round((Date.now() - appStart.getTime()) / 1000))
          : elapsedSec;

        liveItems.push({
          _id: `live-${emp._id}`,
          eventId: `live-${emp._id}`,
          type: 'APPLICATION_FOCUS',
          applicationName: cleanApp,
          startedAt: appStart || (emp.lastActiveAt ? new Date(emp.lastActiveAt) : new Date(Date.now() - elapsedSec * 1000)),
          endedAt: new Date(),
          durationSeconds: liveDuration,
          todayTotalSeconds: usageDoc?.totalSeconds || liveDuration,
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

    // Also mark any ACTIVE event directly from ActivityEvent as live
    for (const evt of events) {
      if (evt.status === 'ACTIVE') {
        evt.isLiveNow = true;
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
