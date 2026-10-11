import { Request, Response, NextFunction } from 'express';
import {
  calculatePayrollSummary,
  getEmployeePayrollDetail,
  updateEmployeeHourlyRate
} from '../services/payrollService';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '../shared';

export const getPayrollSummary = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { startDate, endDate, department, payIdleTime } = req.query;

    const summary = await calculatePayrollSummary({
      companyId: req.companyId!,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      department: department as string | undefined,
      payIdleTime: payIdleTime === undefined ? true : payIdleTime === 'true'
    });

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeePayroll = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const { startDate, endDate, payIdleTime } = req.query;

    // Authorization: Employee can only view their own payroll details
    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== employeeId) {
        throw new AppError('Forbidden: Employees can only view their own payroll records', 403);
      }
    }

    const detail = await getEmployeePayrollDetail(
      req.companyId!,
      employeeId,
      startDate as string | undefined,
      endDate as string | undefined,
      payIdleTime === undefined ? true : payIdleTime === 'true'
    );

    res.status(200).json({
      success: true,
      data: detail
    });
  } catch (error) {
    next(error);
  }
};

export const updateEmployeeRate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Only HR, Owner, Admin can adjust rates
    if (
      req.user?.role !== UserRole.OWNER &&
      req.user?.role !== UserRole.ADMIN &&
      req.user?.role !== UserRole.HR
    ) {
      throw new AppError('Forbidden: Only HR / Admin can modify employee pay rates', 403);
    }

    const { employeeId } = req.params;
    const { hourlyRate, currency, overtimeMultiplier, standardDailyHours } = req.body;

    const updated = await updateEmployeeHourlyRate(req.companyId!, employeeId, {
      hourlyRate,
      currency,
      overtimeMultiplier,
      standardDailyHours
    });

    res.status(200).json({
      success: true,
      message: 'Employee hourly compensation updated successfully.',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

export const exportPayrollCsv = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { startDate, endDate, department, payIdleTime } = req.query;

    const summary = await calculatePayrollSummary({
      companyId: req.companyId!,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      department: department as string | undefined,
      payIdleTime: payIdleTime === undefined ? true : payIdleTime === 'true'
    });

    const headers = [
      'Employee Code',
      'Name',
      'Email',
      'Department',
      'Designation',
      'Hourly Rate',
      'Currency',
      'Days Worked',
      'Active Hours',
      'Idle Hours',
      'Billable Hours',
      'Regular Hours',
      'Overtime Hours',
      'Regular Pay',
      'Overtime Pay',
      'Gross Salary'
    ];

    const rows = summary.items.map((item) => {
      const activeHrs = (item.activeSeconds / 3600).toFixed(2);
      const idleHrs = (item.idleSeconds / 3600).toFixed(2);
      return [
        `"${item.employeeCode}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        `"${item.email}"`,
        `"${item.department}"`,
        `"${item.designation}"`,
        item.hourlyRate.toFixed(2),
        item.currency,
        item.daysWorked,
        activeHrs,
        idleHrs,
        item.totalHours.toFixed(2),
        item.regularHours.toFixed(2),
        item.overtimeHours.toFixed(2),
        item.regularPay.toFixed(2),
        item.overtimePay.toFixed(2),
        item.grossPay.toFixed(2)
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\r\n');

    const filename = `payroll_${summary.periodStart}_to_${summary.periodEnd}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
};
