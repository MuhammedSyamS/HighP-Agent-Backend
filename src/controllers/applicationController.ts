import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { WebsiteActivity } from '../models/WebsiteActivity';
import { Company } from '../models/Company';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '../shared';
import { applicationRegistryService } from '../services/applicationRegistryService';

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

export const getCompanyWebsiteUsage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    const aggregated = await WebsiteActivity.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$domain',
          browser: { $first: '$browser' },
          totalSeconds: { $sum: '$totalSeconds' },
          lastUsedAt: { $max: '$lastUsedAt' },
          employeeCount: { $addToSet: '$employeeId' }
        }
      },
      {
        $project: {
          domain: '$_id',
          browser: 1,
          totalSeconds: 1,
          lastUsedAt: 1,
          employeeCount: { $size: '$employeeCount' }
        }
      },
      { $sort: { totalSeconds: -1 } }
    ]);

    const totalTimeOverall = aggregated.reduce((acc, curr) => acc + curr.totalSeconds, 0);

    const results = aggregated.map((web) => ({
      ...web,
      percentage: totalTimeOverall > 0 ? Math.round((web.totalSeconds / totalTimeOverall) * 100) : 0
    }));

    res.status(200).json({
      success: true,
      data: {
        totalTimeOverall,
        websites: results
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

export const getEmployeeWebsiteUsage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId } = req.params;

    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== employeeId) {
        throw new AppError('Forbidden: Employees can only view their own website usage', 403);
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

    const aggregated = await WebsiteActivity.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$domain',
          browser: { $first: '$browser' },
          totalSeconds: { $sum: '$totalSeconds' },
          lastUsedAt: { $max: '$lastUsedAt' }
        }
      },
      {
        $project: {
          domain: '$_id',
          browser: 1,
          totalSeconds: 1,
          lastUsedAt: 1
        }
      },
      { $sort: { totalSeconds: -1 } }
    ]);

    const totalTime = aggregated.reduce((acc, curr) => acc + curr.totalSeconds, 0);

    const results = aggregated.map((site) => ({
      ...site,
      percentage: totalTime > 0 ? Math.round((site.totalSeconds / totalTime) * 100) : 0
    }));

    res.status(200).json({
      success: true,
      data: {
        totalTime,
        websites: results
      }
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// Application Registry Controllers
// ==========================================

export const getRegistryApplications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { category, search, tracked } = req.query;
    const trackedBool = tracked !== undefined ? tracked === 'true' : undefined;

    const apps = await applicationRegistryService.getApplications(req.companyId!, {
      category: category as string,
      search: search as string,
      tracked: trackedBool
    });

    res.status(200).json({
      success: true,
      data: apps
    });
  } catch (error) {
    next(error);
  }
};

export const createRegistryApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, category, executableNames, executablePaths, tracked, ignored, isSystemApp } = req.body;
    const created = await applicationRegistryService.addApplication(req.companyId!, {
      name,
      category,
      executableNames,
      executablePaths,
      tracked,
      ignored,
      isSystemApp
    });

    res.status(201).json({
      success: true,
      message: 'Application added to registry successfully',
      data: created
    });
  } catch (error) {
    next(error);
  }
};

export const updateRegistryApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const updated = await applicationRegistryService.updateApplication(req.companyId!, id, req.body);

    res.status(200).json({
      success: true,
      message: 'Application updated successfully',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

export const deleteRegistryApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await applicationRegistryService.deleteApplication(req.companyId!, id);

    res.status(200).json({
      success: true,
      message: 'Application removed from registry'
    });
  } catch (error) {
    next(error);
  }
};

export const toggleRegistryApplicationTracking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { tracked } = req.body;

    const updated = await applicationRegistryService.toggleTracking(req.companyId!, id, Boolean(tracked));

    res.status(200).json({
      success: true,
      message: `Application tracking set to ${tracked ? 'ENABLED' : 'DISABLED'}`,
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

export const getDiscoveredApplications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const apps = await applicationRegistryService.getDiscoveredApplications(req.companyId!);

    res.status(200).json({
      success: true,
      data: apps
    });
  } catch (error) {
    next(error);
  }
};

export const convertDiscoveredApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, category, tracked, ignored } = req.body;

    const converted = await applicationRegistryService.convertDiscovered(req.companyId!, id, {
      name,
      category,
      tracked: tracked !== undefined ? Boolean(tracked) : true,
      ignored: ignored !== undefined ? Boolean(ignored) : false
    });

    res.status(200).json({
      success: true,
      message: 'Discovered application configured successfully',
      data: converted
    });
  } catch (error) {
    next(error);
  }
};

export const dismissDiscoveredApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    await applicationRegistryService.dismissDiscovered(req.companyId!, id);

    res.status(200).json({
      success: true,
      message: 'Discovered application dismissed'
    });
  } catch (error) {
    next(error);
  }
};
