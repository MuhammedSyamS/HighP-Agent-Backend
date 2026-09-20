"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportReport = exports.getMonthly = exports.getWeekly = exports.getDaily = void 0;
const reportService_1 = require("../services/reportService");
const getDaily = async (req, res, next) => {
    try {
        const { date, employeeId, exportCsv } = req.query;
        const dateStr = date || new Date().toISOString().slice(0, 10);
        const report = await (0, reportService_1.getDailyReport)(req.companyId, dateStr, employeeId);
        if (exportCsv === 'true') {
            const csv = (0, reportService_1.exportReportToCsv)(report, 'daily');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=daily-report-${dateStr}.csv`);
            res.status(200).send(csv);
            return;
        }
        res.status(200).json({
            success: true,
            data: report
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getDaily = getDaily;
const getWeekly = async (req, res, next) => {
    try {
        const { startDate, endDate, period, employeeId, exportCsv } = req.query;
        const end = endDate ? endDate : new Date().toISOString().slice(0, 10);
        const start = startDate
            ? startDate
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const periodLabel = period || `${start} to ${end}`;
        const report = await (0, reportService_1.getWeeklyMonthlyReport)(req.companyId, start, end, periodLabel, employeeId);
        if (exportCsv === 'true') {
            const csv = (0, reportService_1.exportReportToCsv)(report, 'weekly');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=weekly-report-${start}-${end}.csv`);
            res.status(200).send(csv);
            return;
        }
        res.status(200).json({
            success: true,
            data: report
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getWeekly = getWeekly;
const getMonthly = async (req, res, next) => {
    try {
        const { year, month, employeeId, exportCsv } = req.query;
        const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();
        const currentMonth = month ? parseInt(month, 10) : new Date().getMonth() + 1;
        const monthStr = String(currentMonth).padStart(2, '0');
        const start = `${currentYear}-${monthStr}-01`;
        const lastDay = new Date(currentYear, currentMonth, 0).getDate();
        const end = `${currentYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
        const periodLabel = `${currentYear}-${monthStr}`;
        const report = await (0, reportService_1.getWeeklyMonthlyReport)(req.companyId, start, end, periodLabel, employeeId);
        if (exportCsv === 'true') {
            const csv = (0, reportService_1.exportReportToCsv)(report, 'monthly');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=monthly-report-${periodLabel}.csv`);
            res.status(200).send(csv);
            return;
        }
        res.status(200).json({
            success: true,
            data: report
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getMonthly = getMonthly;
const exportReport = async (req, res, next) => {
    try {
        const { type = 'daily', date, startDate, endDate, employeeId } = req.query;
        const dateStr = date || new Date().toISOString().slice(0, 10);
        if (type === 'daily') {
            const report = await (0, reportService_1.getDailyReport)(req.companyId, dateStr, employeeId);
            const csv = (0, reportService_1.exportReportToCsv)(report, 'daily');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=daily-report-${dateStr}.csv`);
            res.status(200).send(csv);
            return;
        }
        const end = endDate ? endDate : dateStr;
        const start = startDate ? startDate : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const report = await (0, reportService_1.getWeeklyMonthlyReport)(req.companyId, start, end, `${start} to ${end}`, employeeId);
        const csv = (0, reportService_1.exportReportToCsv)(report, type === 'monthly' ? 'monthly' : 'weekly');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${type}-report-${start}-${end}.csv`);
        res.status(200).send(csv);
    }
    catch (error) {
        next(error);
    }
};
exports.exportReport = exportReport;
