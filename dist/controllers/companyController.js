"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCompanyConfig = exports.getCompany = void 0;
const Company_1 = require("../models/Company");
const auditService_1 = require("../services/auditService");
const shared_1 = require("@highp/shared");
const errorHandler_1 = require("../middleware/errorHandler");
const getCompany = async (req, res, next) => {
    try {
        const company = await Company_1.Company.findById(req.companyId);
        if (!company) {
            throw new errorHandler_1.AppError('Company not found', 404);
        }
        res.status(200).json({
            success: true,
            data: company
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getCompany = getCompany;
const updateCompanyConfig = async (req, res, next) => {
    try {
        const company = await Company_1.Company.findById(req.companyId);
        if (!company) {
            throw new errorHandler_1.AppError('Company not found', 404);
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
        await (0, auditService_1.logAudit)({
            companyId: req.companyId,
            userId: req.user?.userId,
            action: shared_1.AuditAction.CONFIG_UPDATED,
            resource: 'CompanyConfig',
            details: req.body,
            ipAddress: req.ip
        });
        res.status(200).json({
            success: true,
            message: 'Company configuration updated successfully.',
            data: company.config
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateCompanyConfig = updateCompanyConfig;
