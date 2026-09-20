"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuditLogs = void 0;
const AuditLog_1 = require("../models/AuditLog");
const getAuditLogs = async (req, res, next) => {
    try {
        const { limit = 50, page = 1 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const logs = await AuditLog_1.AuditLog.find({ companyId: req.companyId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .populate('userId', 'firstName lastName email')
            .lean();
        const total = await AuditLog_1.AuditLog.countDocuments({ companyId: req.companyId });
        res.status(200).json({
            success: true,
            data: {
                logs,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    pages: Math.ceil(total / Number(limit))
                }
            }
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getAuditLogs = getAuditLogs;
