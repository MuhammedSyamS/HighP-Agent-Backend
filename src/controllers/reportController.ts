import { Request, Response, NextFunction } from 'express';
import { getDailyReport, getWeeklyMonthlyReport, exportReportToCsv } from '../services/reportService';
import { AppError } from '../middleware/errorHandler';

export const getDaily = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { date, employeeId, exportCsv } = req.query;
    const dateStr = (date as string) || new Date().toISOString().slice(0, 10);

    const report = await getDailyReport(
      req.companyId!,
      dateStr,
      employeeId as string | undefined
    );

    if (exportCsv === 'true') {
      const csv = exportReportToCsv(report, 'daily');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=daily-report-${dateStr}.csv`);
      res.status(200).send(csv);
      return;
    }

    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    next(error);
  }
};

export const getWeekly = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { startDate, endDate, period, employeeId, exportCsv } = req.query;

    const end = endDate ? (endDate as string) : new Date().toISOString().slice(0, 10);
    const start = startDate
      ? (startDate as string)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const periodLabel = (period as string) || `${start} to ${end}`;

    const report = await getWeeklyMonthlyReport(
      req.companyId!,
      start,
      end,
      periodLabel,
      employeeId as string | undefined
    );

    if (exportCsv === 'true') {
      const csv = exportReportToCsv(report, 'weekly');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=weekly-report-${start}-${end}.csv`);
      res.status(200).send(csv);
      return;
    }

    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    next(error);
  }
};

export const getMonthly = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { year, month, employeeId, exportCsv } = req.query;

    const currentYear = year ? parseInt(year as string, 10) : new Date().getFullYear();
    const currentMonth = month ? parseInt(month as string, 10) : new Date().getMonth() + 1;

    const monthStr = String(currentMonth).padStart(2, '0');
    const start = `${currentYear}-${monthStr}-01`;
    const lastDay = new Date(currentYear, currentMonth, 0).getDate();
    const end = `${currentYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
    const periodLabel = `${currentYear}-${monthStr}`;

    const report = await getWeeklyMonthlyReport(
      req.companyId!,
      start,
      end,
      periodLabel,
      employeeId as string | undefined
    );

    if (exportCsv === 'true') {
      const csv = exportReportToCsv(report, 'monthly');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=monthly-report-${periodLabel}.csv`);
      res.status(200).send(csv);
      return;
    }

    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    next(error);
  }
};

export const exportReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { type = 'daily', date, startDate, endDate, employeeId } = req.query;
    const dateStr = (date as string) || new Date().toISOString().slice(0, 10);

    if (type === 'daily') {
      const report = await getDailyReport(req.companyId!, dateStr, employeeId as string | undefined);
      const csv = exportReportToCsv(report, 'daily');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=daily-report-${dateStr}.csv`);
      res.status(200).send(csv);
      return;
    }

    const end = endDate ? (endDate as string) : dateStr;
    const start = startDate ? (startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const report = await getWeeklyMonthlyReport(req.companyId!, start, end, `${start} to ${end}`, employeeId as string | undefined);
    const csv = exportReportToCsv(report, type === 'monthly' ? 'monthly' : 'weekly');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-report-${start}-${end}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};

