import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { startBreak, endBreak } from '../services/sessionService';
import { Break } from '../models/Break';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '../shared';

export const start = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this user account', 400);
    }

    const { reason, note } = req.body;
    const breakRecord = await startBreak(req.companyId!, employeeId, reason, note);

    res.status(200).json({
      success: true,
      message: 'Break started.',
      data: breakRecord
    });
  } catch (error) {
    next(error);
  }
};

export const end = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this user account', 400);
    }

    const { breakId } = req.body;
    const breakRecord = await endBreak(req.companyId!, employeeId, breakId);

    res.status(200).json({
      success: true,
      message: 'Break ended.',
      data: breakRecord
    });
  } catch (error) {
    next(error);
  }
};

export const getBreaks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId, sessionId } = req.query;
    const query: any = { companyId: new mongoose.Types.ObjectId(req.companyId) };

    if (req.user?.role === UserRole.EMPLOYEE) {
      query.employeeId = new mongoose.Types.ObjectId(req.user.employeeProfileId);
    } else if (employeeId) {
      query.employeeId = new mongoose.Types.ObjectId(employeeId as string);
    }

    if (sessionId) query.sessionId = new mongoose.Types.ObjectId(sessionId as string);

    const breaks = await Break.find(query).sort({ startedAt: -1 }).limit(50).lean();

    res.status(200).json({
      success: true,
      data: breaks
    });
  } catch (error) {
    next(error);
  }
};
