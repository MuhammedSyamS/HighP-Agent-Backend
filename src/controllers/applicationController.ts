import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { Company } from '../models/Company';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '../shared';

export const getCompanyApplicationUsage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { startDate, endDate, date } = req.query;
    const companyId = new mongoose.Types.ObjectId(req.companyId);

    const matchQuery: any = { companyId };
    if (date) {
      matchQuery.date = date;
    } else if (startDate || endDate) {
      matchQuery.date = {};
      if (startDate) matchQuery.date.$gte = startDate;
      if (endDate) matchQuery.date.$lte = endDate;
    }

    const aggregated = await ApplicationUsage.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$applicationName',
          category: { $first: '$category' },
          totalSeconds: { $sum: '$totalSeconds' },
          lastUsedAt: { $max: '$lastUsedAt' },
          employeeCount: { $addToSet: '$employeeId' }
        }
      },
      {
        $project: {
          applicationName: '$_id',
          category: 1,
          totalSeconds: 1,
          lastUsedAt: 1,
          employeeCount: { $size: '$employeeCount' }
        }
      },
      { $sort: { totalSeconds: -1 } }
    ]);

    const totalTimeOverall = aggregated.reduce((acc, curr) => acc + curr.totalSeconds, 0);

    const results = aggregated.map((app) => ({
      ...app,
      percentage: totalTimeOverall > 0 ? Math.round((app.totalSeconds / totalTimeOverall) * 100) : 0
    }));

    res.status(200).json({
      success: true,
      data: {
        totalTimeOverall,
        applications: results
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeApplicationUsage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId } = req.params;

    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== employeeId) {
        throw new AppError('Forbidden: Employees can only view their own application usage', 403);
      }
    }

    const { startDate, endDate, date } = req.query;
    const companyId = new mongoose.Types.ObjectId(req.companyId);

    const matchQuery: any = {
      companyId,
      employeeId: new mongoose.Types.ObjectId(employeeId)
    };

    if (date) {
      matchQuery.date = date;
    } else if (startDate || endDate) {
      matchQuery.date = {};
      if (startDate) matchQuery.date.$gte = startDate;
      if (endDate) matchQuery.date.$lte = endDate;
    }

    const aggregated = await ApplicationUsage.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$applicationName',
          category: { $first: '$category' },
          totalSeconds: { $sum: '$totalSeconds' },
          lastUsedAt: { $max: '$lastUsedAt' }
        }
      },
      {
        $project: {
          applicationName: '$_id',
          category: 1,
          totalSeconds: 1,
          lastUsedAt: 1
        }
      },
      { $sort: { totalSeconds: -1 } }
    ]);

    const totalTime = aggregated.reduce((acc, curr) => acc + curr.totalSeconds, 0);

    const results = aggregated.map((app) => ({
      ...app,
      percentage: totalTime > 0 ? Math.round((app.totalSeconds / totalTime) * 100) : 0
    }));

    res.status(200).json({
      success: true,
      data: {
        totalTime,
        applications: results
      }
    });
  } catch (error) {
    next(error);
  }
};
