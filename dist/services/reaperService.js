"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopReaperService = exports.startReaperService = exports.checkStaleSessions = void 0;
const shared_1 = require("@highp/shared");
const EmployeeProfile_1 = require("../models/EmployeeProfile");
const Company_1 = require("../models/Company");
const socketManager_1 = require("../realtime/socketManager");
let reaperInterval = null;
const checkStaleSessions = async () => {
    try {
        const companies = await Company_1.Company.find().select('_id config').lean();
        for (const company of companies) {
            const heartbeatSec = company.config?.heartbeatIntervalSeconds || 30;
            const timeoutThresholdMs = heartbeatSec * 3 * 1000; // 3 missed heartbeats
            const cutoff = new Date(Date.now() - timeoutThresholdMs);
            // Find active/idle employees whose heartbeat timed out
            const staleEmployees = await EmployeeProfile_1.EmployeeProfile.find({
                companyId: company._id,
                currentStatus: { $in: [shared_1.ActivityState.ACTIVE, shared_1.ActivityState.IDLE] },
                lastHeartbeatAt: { $lt: cutoff }
            });
            for (const employee of staleEmployees) {
                employee.currentStatus = shared_1.ActivityState.OFFLINE;
                await employee.save();
                (0, socketManager_1.emitToCompany)(company._id.toString(), 'employee:status_changed', {
                    companyId: company._id.toString(),
                    employeeId: employee._id.toString(),
                    status: shared_1.ActivityState.OFFLINE,
                    currentApplication: employee.currentApplication,
                    lastActiveAt: employee.lastActiveAt?.toISOString()
                });
            }
        }
    }
    catch (error) {
        console.error('[ReaperService] Error checking stale sessions:', error);
    }
};
exports.checkStaleSessions = checkStaleSessions;
const startReaperService = (intervalSeconds = 30) => {
    if (reaperInterval)
        clearInterval(reaperInterval);
    reaperInterval = setInterval(exports.checkStaleSessions, intervalSeconds * 1000);
    console.log(`[ReaperService] Stale session monitoring started (${intervalSeconds}s interval).`);
};
exports.startReaperService = startReaperService;
const stopReaperService = () => {
    if (reaperInterval) {
        clearInterval(reaperInterval);
        reaperInterval = null;
    }
};
exports.stopReaperService = stopReaperService;
