"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecentActivity = exports.getTimeline = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const activityService_1 = require("../services/activityService");
const ActivityEvent_1 = require("../models/ActivityEvent");
const getTimeline = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().slice(0, 10);
        const events = await (0, activityService_1.getEmployeeTimeline)(req.companyId, employeeId, dateStr);
        res.status(200).json({
            success: true,
            data: {
                employeeId,
                date: dateStr,
                events
            }
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getTimeline = getTimeline;
const getRecentActivity = async (req, res, next) => {
    try {
        const { employeeId, limit = '100' } = req.query;
        const query = { companyId: new mongoose_1.default.Types.ObjectId(req.companyId) };
        if (employeeId) {
            query.employeeId = new mongoose_1.default.Types.ObjectId(employeeId);
        }
        const events = await ActivityEvent_1.ActivityEvent.find(query)
            .sort({ startedAt: -1 })
            .limit(parseInt(limit, 10))
            .lean();
        res.status(200).json({
            success: true,
            data: events
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getRecentActivity = getRecentActivity;
