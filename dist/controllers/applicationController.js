"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmployeeApplicationUsage = exports.getCompanyApplicationUsage = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const ApplicationUsage_1 = require("../models/ApplicationUsage");
const getCompanyApplicationUsage = async (req, res, next) => {
    try {
        const { startDate, endDate, date } = req.query;
        const companyId = new mongoose_1.default.Types.ObjectId(req.companyId);
        const matchQuery = { companyId };
        if (date) {
            matchQuery.date = date;
        }
        else if (startDate || endDate) {
            matchQuery.date = {};
            if (startDate)
                matchQuery.date.$gte = startDate;
            if (endDate)
                matchQuery.date.$lte = endDate;
        }
        const aggregated = await ApplicationUsage_1.ApplicationUsage.aggregate([
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
    }
    catch (error) {
        next(error);
    }
};
exports.getCompanyApplicationUsage = getCompanyApplicationUsage;
const getEmployeeApplicationUsage = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        const { startDate, endDate, date } = req.query;
        const companyId = new mongoose_1.default.Types.ObjectId(req.companyId);
        const matchQuery = {
            companyId,
            employeeId: new mongoose_1.default.Types.ObjectId(employeeId)
        };
        if (date) {
            matchQuery.date = date;
        }
        else if (startDate || endDate) {
            matchQuery.date = {};
            if (startDate)
                matchQuery.date.$gte = startDate;
            if (endDate)
                matchQuery.date.$lte = endDate;
        }
        const aggregated = await ApplicationUsage_1.ApplicationUsage.aggregate([
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
    }
    catch (error) {
        next(error);
    }
};
exports.getEmployeeApplicationUsage = getEmployeeApplicationUsage;
