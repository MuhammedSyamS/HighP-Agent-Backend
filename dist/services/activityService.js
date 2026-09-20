"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmployeeTimeline = exports.ingestActivityEvents = exports.determineCategory = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const shared_1 = require("@highp/shared");
const ActivityEvent_1 = require("../models/ActivityEvent");
const ApplicationUsage_1 = require("../models/ApplicationUsage");
const Company_1 = require("../models/Company");
const EmployeeProfile_1 = require("../models/EmployeeProfile");
const socketManager_1 = require("../realtime/socketManager");
const determineCategory = (appName, companyCategories) => {
    const lowerApp = appName.toLowerCase();
    for (const category of companyCategories) {
        if (category.apps.some((keyword) => lowerApp.includes(keyword.toLowerCase()))) {
            return category.name;
        }
    }
    return 'Other';
};
exports.determineCategory = determineCategory;
const ingestActivityEvents = async (companyId, employeeId, sessionId, deviceId, events) => {
    if (!events || events.length === 0) {
        return { ingestedCount: 0, duplicatesCount: 0 };
    }
    const company = await Company_1.Company.findById(companyId);
    const categories = company?.config?.appCategories || [];
    let ingestedCount = 0;
    let duplicatesCount = 0;
    for (const event of events) {
        const started = new Date(event.startedAt);
        const ended = new Date(event.endedAt);
        const dateStr = started.toISOString().slice(0, 10);
        const duration = Math.max(0, event.durationSeconds || Math.round((ended.getTime() - started.getTime()) / 1000));
        const cleanAppName = event.applicationName.trim() || 'Unknown Application';
        const category = (0, exports.determineCategory)(cleanAppName, categories);
        try {
            // 1. Insert Raw Activity Event (Idempotent by eventId + companyId)
            await ActivityEvent_1.ActivityEvent.create({
                eventId: event.eventId,
                companyId: new mongoose_1.default.Types.ObjectId(companyId),
                employeeId: new mongoose_1.default.Types.ObjectId(employeeId),
                sessionId: new mongoose_1.default.Types.ObjectId(sessionId),
                ...(deviceId && mongoose_1.default.Types.ObjectId.isValid(deviceId) ? { deviceId: new mongoose_1.default.Types.ObjectId(deviceId) } : {}),
                type: event.type,
                applicationName: cleanAppName,
                processName: event.processName,
                windowTitleSanitized: event.windowTitleSanitized,
                startedAt: started,
                endedAt: ended,
                durationSeconds: duration
            });
            // 2. Aggregate into Daily Application Usage
            if (event.type === shared_1.ActivityEventType.APPLICATION_FOCUS && duration > 0) {
                await ApplicationUsage_1.ApplicationUsage.findOneAndUpdate({
                    companyId: new mongoose_1.default.Types.ObjectId(companyId),
                    employeeId: new mongoose_1.default.Types.ObjectId(employeeId),
                    date: dateStr,
                    applicationName: cleanAppName
                }, {
                    $inc: { totalSeconds: duration },
                    $set: { category, lastUsedAt: ended }
                }, { upsert: true, new: true });
            }
            ingestedCount++;
        }
        catch (err) {
            if (err.code === 11000) {
                // Duplicate eventId already processed
                duplicatesCount++;
            }
            else {
                console.error('[ActivityService] Error ingesting event:', err);
            }
        }
    }
    // Update employee profile's current app if recent event
    if (events.length > 0) {
        const latestEvent = events[events.length - 1];
        if (latestEvent.applicationName) {
            await EmployeeProfile_1.EmployeeProfile.updateOne({ _id: employeeId, companyId }, { $set: { currentApplication: latestEvent.applicationName } });
            (0, socketManager_1.emitToCompany)(companyId, 'employee:activity_changed', {
                companyId,
                employeeId,
                currentApplication: latestEvent.applicationName,
                timestamp: latestEvent.endedAt
            });
        }
    }
    return { ingestedCount, duplicatesCount };
};
exports.ingestActivityEvents = ingestActivityEvents;
const getEmployeeTimeline = async (companyId, employeeId, dateStr // "YYYY-MM-DD"
) => {
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
    const events = await ActivityEvent_1.ActivityEvent.find({
        companyId: new mongoose_1.default.Types.ObjectId(companyId),
        employeeId: new mongoose_1.default.Types.ObjectId(employeeId),
        startedAt: { $gte: startOfDay, $lte: endOfDay }
    })
        .sort({ startedAt: 1 })
        .lean();
    return events;
};
exports.getEmployeeTimeline = getEmployeeTimeline;
