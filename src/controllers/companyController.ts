import { Request, Response, NextFunction } from 'express';
import { Company } from '../models/Company';
import { logAudit } from '../services/auditService';
import { AuditAction } from '@highp/shared';
import { AppError } from '../middleware/errorHandler';

export const getCompany = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const company = await Company.findById(req.companyId);
    if (!company) {
      throw new AppError('Company not found', 404);
    }

    res.status(200).json({
      success: true,
      data: company
    });
  } catch (error) {
    next(error);
  }
};

export const updateCompanyConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const company = await Company.findById(req.companyId);
    if (!company) {
      throw new AppError('Company not found', 404);
    }

    if (req.body.idleThresholdMinutes !== undefined) {
      company.config.idleThresholdMinutes = req.body.idleThresholdMinutes;
    }
    if (req.body.heartbeatIntervalSeconds !== undefined) {
      company.config.heartbeatIntervalSeconds = req.body.heartbeatIntervalSeconds;
    }
    if (req.body.retentionDays !== undefined) {
      company.config.retentionDays = req.body.retentionDays;
    }
    if (req.body.allowManualBreaks !== undefined) {
      company.config.allowManualBreaks = req.body.allowManualBreaks;
    }
    if (req.body.appCategories !== undefined) {
      company.config.appCategories = req.body.appCategories;
    }

    await company.save();

    await logAudit({
      companyId: req.companyId!,
      userId: req.user?.userId,
      action: AuditAction.CONFIG_UPDATED,
      resource: 'CompanyConfig',
      details: req.body,
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Company configuration updated successfully.',
      data: company.config
    });
  } catch (error) {
    next(error);
  }
};
