"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportReportToCsv = exports.getWeeklyMonthlyReport = exports.getDailyReport = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const AttendanceSession_1 = require("../models/AttendanceSession");
const ApplicationUsage_1 = require("../models/ApplicationUsage");
const EmployeeProfile_1 = require("../models/EmployeeProfile");
const getDailyReport = async (companyId, dateStr, // "YYYY-MM-DD"
employeeId) => {
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
    const companyObjId = new mongoose_1.default.Types.ObjectId(companyId);
    const employeeQuery = { companyId: companyObjId };
    if (employeeId) {
        employeeQuery._id = new mongoose_1.default.Types.ObjectId(employeeId);
    }
    const profiles = await EmployeeProfile_1.EmployeeProfile.find(employeeQuery)
        .populate({ path: 'userId', select: 'firstName lastName email' })
        .lean();
    if (profiles.length === 0)
        return [];
    const profileIds = profiles.map((p) => p._id);
    // Batch fetch all sessions and application usages for all profiles in 1 roundtrip
    const [allSessions, allAppUsages] = await Promise.all([
        AttendanceSession_1.AttendanceSession.find({
            companyId: companyObjId,
            employeeId: { $in: profileIds },
            startedAt: { $gte: startOfDay, $lte: endOfDay }
        }).sort({ startedAt: 1 }).lean(),
        ApplicationUsage_1.ApplicationUsage.find({
            companyId: companyObjId,
            employeeId: { $in: profileIds },
            date: dateStr
        }).sort({ totalSeconds: -1 }).lean()
    ]);
    // Group by employeeId
    const sessionsByEmp = new Map();
    for (const s of allSessions) {
        const k = s.employeeId.toString();
        if (!sessionsByEmp.has(k))
            sessionsByEmp.set(k, []);
        sessionsByEmp.get(k).push(s);
    }
    const appsByEmp = new Map();
    for (const a of allAppUsages) {
        const k = a.employeeId.toString();
        if (!appsByEmp.has(k))
            appsByEmp.set(k, []);
        appsByEmp.get(k).push(a);
    }
    const results = [];
    for (const profile of profiles) {
        const empIdStr = profile._id.toString();
        const user = profile.userId;
        const empName = user ? `${user.firstName} ${user.lastName}` : 'Unknown Employee';
        const sessions = sessionsByEmp.get(empIdStr) || [];
        let activeSec = 0;
        let idleSec = 0;
        let breakSec = 0;
        let firstStart;
        let lastEnd;
        if (sessions.length > 0) {
            firstStart = sessions[0].startedAt.toISOString();
            const lastSession = sessions[sessions.length - 1];
            lastEnd = lastSession.endedAt ? lastSession.endedAt.toISOString() : undefined;
            for (const s of sessions) {
                activeSec += s.activeSeconds || 0;
                idleSec += s.idleSeconds || 0;
                breakSec += s.breakSeconds || 0;
            }
        }
        const appUsages = (appsByEmp.get(empIdStr) || []).slice(0, 5);
        const topApps = appUsages.map((a) => ({
            applicationName: a.applicationName,
            seconds: a.totalSeconds
        }));
        results.push({
            employeeId: empIdStr,
            employeeName: empName,
            employeeCode: profile.employeeCode,
            department: profile.department,
            date: dateStr,
            sessionStartedAt: firstStart,
            sessionEndedAt: lastEnd,
            activeSeconds: activeSec,
            idleSeconds: idleSec,
            breakSeconds: breakSec,
            totalSessionSeconds: activeSec + idleSec + breakSec,
            topApplications: topApps
        });
    }
    return results;
};
exports.getDailyReport = getDailyReport;
const getWeeklyMonthlyReport = async (companyId, startDateStr, // "YYYY-MM-DD"
endDateStr, // "YYYY-MM-DD"
periodLabel, // e.g. "2026-W38" or "2026-09"
employeeId) => {
    const start = new Date(`${startDateStr}T00:00:00.000Z`);
    const end = new Date(`${endDateStr}T23:59:59.999Z`);
    const companyObjId = new mongoose_1.default.Types.ObjectId(companyId);
    const employeeQuery = { companyId: companyObjId };
    if (employeeId) {
        employeeQuery._id = new mongoose_1.default.Types.ObjectId(employeeId);
    }
    const profiles = await EmployeeProfile_1.EmployeeProfile.find(employeeQuery)
        .populate({ path: 'userId', select: 'firstName lastName email' })
        .lean();
    if (profiles.length === 0)
        return [];
    const profileIds = profiles.map((p) => p._id);
    // Batch fetch all sessions in 1 query
    const allSessions = await AttendanceSession_1.AttendanceSession.find({
        companyId: companyObjId,
        employeeId: { $in: profileIds },
        startedAt: { $gte: start, $lte: end }
    }).lean();
    const sessionsByEmp = new Map();
    for (const s of allSessions) {
        const k = s.employeeId.toString();
        if (!sessionsByEmp.has(k))
            sessionsByEmp.set(k, []);
        sessionsByEmp.get(k).push(s);
    }
    const results = [];
    for (const profile of profiles) {
        const empIdStr = profile._id.toString();
        const user = profile.userId;
        const empName = user ? `${user.firstName} ${user.lastName}` : 'Unknown Employee';
        const sessions = sessionsByEmp.get(empIdStr) || [];
        const distinctDays = new Set();
        let activeSec = 0;
        let idleSec = 0;
        let breakSec = 0;
        for (const s of sessions) {
            distinctDays.add(s.startedAt.toISOString().slice(0, 10));
            activeSec += s.activeSeconds || 0;
            idleSec += s.idleSeconds || 0;
            breakSec += s.breakSeconds || 0;
        }
        const workingDaysCount = distinctDays.size;
        const totalSessionSec = activeSec + idleSec + breakSec;
        const avgDailyActive = workingDaysCount > 0 ? Math.round(activeSec / workingDaysCount) : 0;
        results.push({
            employeeId: empIdStr,
            employeeName: empName,
            employeeCode: profile.employeeCode,
            department: profile.department,
            period: periodLabel,
            workingDaysCount,
            totalActiveSeconds: activeSec,
            totalIdleSeconds: idleSec,
            totalBreakSeconds: breakSec,
            totalSessionSeconds: totalSessionSec,
            averageDailyActiveSeconds: avgDailyActive
        });
    }
    return results;
};
exports.getWeeklyMonthlyReport = getWeeklyMonthlyReport;
const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
};
const exportReportToCsv = (reportData, type) => {
    if (!reportData || reportData.length === 0) {
        return 'No data available for the selected period';
    }
    if (type === 'daily') {
        const headers = [
            'Employee Code',
            'Employee Name',
            'Department',
            'Date',
            'Session Start',
            'Session End',
            'Active Time',
            'Idle Time',
            'Break Time',
            'Total Session Time',
            'Top Applications'
        ];
        const rows = reportData.map((row) => {
            const topAppsStr = (row.topApplications || [])
                .map((a) => `${a.applicationName} (${formatDuration(a.seconds)})`)
                .join('; ');
            return [
                `"${row.employeeCode || ''}"`,
                `"${row.employeeName || ''}"`,
                `"${row.department || ''}"`,
                `"${row.date || ''}"`,
                `"${row.sessionStartedAt ? new Date(row.sessionStartedAt).toLocaleTimeString() : 'N/A'}"`,
                `"${row.sessionEndedAt ? new Date(row.sessionEndedAt).toLocaleTimeString() : 'In Progress'}"`,
                `"${formatDuration(row.activeSeconds)}"`,
                `"${formatDuration(row.idleSeconds)}"`,
                `"${formatDuration(row.breakSeconds)}"`,
                `"${formatDuration(row.totalSessionSeconds)}"`,
                `"${topAppsStr.replace(/"/g, '""')}"`
            ].join(',');
        });
        return [headers.join(','), ...rows].join('\n');
    }
    else {
        const headers = [
            'Employee Code',
            'Employee Name',
            'Department',
            'Period',
            'Working Days',
            'Total Active Time',
            'Total Idle Time',
            'Total Break Time',
            'Total Session Time',
            'Avg Daily Active Time'
        ];
        const rows = reportData.map((row) => [
            `"${row.employeeCode || ''}"`,
            `"${row.employeeName || ''}"`,
            `"${row.department || ''}"`,
            `"${row.period || ''}"`,
            row.workingDaysCount,
            `"${formatDuration(row.totalActiveSeconds)}"`,
            `"${formatDuration(row.totalIdleSeconds)}"`,
            `"${formatDuration(row.totalBreakSeconds)}"`,
            `"${formatDuration(row.totalSessionSeconds)}"`,
            `"${formatDuration(row.averageDailyActiveSeconds)}"`
        ].join(','));
        return [headers.join(','), ...rows].join('\n');
    }
};
exports.exportReportToCsv = exportReportToCsv;
