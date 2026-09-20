import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { getEmployeeTimeline } from '../services/activityService';
import { ActivityEvent } from '../models/ActivityEvent';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '../shared';

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
    const { employeeId, limit = '100' } = req.query;
    const query: any = { companyId: new mongoose.Types.ObjectId(req.companyId) };

    if (req.user?.role === UserRole.EMPLOYEE) {
      query.employeeId = new mongoose.Types.ObjectId(req.user.employeeProfileId);
    } else if (employeeId) {
      query.employeeId = new mongoose.Types.ObjectId(employeeId as string);
    }

    const events = await ActivityEvent.find(query)
      .sort({ startedAt: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();

    res.status(200).json({
      success: true,
      data: events
    });
  } catch (error) {
    next(error);
  }
};
