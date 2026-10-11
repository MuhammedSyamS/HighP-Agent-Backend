import { Request, Response, NextFunction } from 'express';
import {
  calculatePayrollSummary,
  getEmployeePayrollDetail,
  updateEmployeeHourlyRate,
  updateEmployeePayoutStatus,
  bulkUpdateEmployeePayoutStatus,
  applyBulkCompanyPayrollPolicy
} from '../services/payrollService';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '../shared';
import { emitToCompany } from '../realtime/socketManager';

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
    const {
      hourlyRate,
      currency,
      overtimeMultiplier,
      standardDailyHours,
      overtimeRateMode,
      overtimeFixedRate,
      overtimeEnabled,
      customOvertimePayment,
      bonus,
      deductions,
      payrollNotes,
      paymentStatus,
      paymentMethod,
      paymentReference,
      paymentDate
    } = req.body;

    const updated = await updateEmployeeHourlyRate(req.companyId!, employeeId, {
      hourlyRate,
      currency,
      overtimeMultiplier,
      standardDailyHours,
      overtimeRateMode,
      overtimeFixedRate,
      overtimeEnabled,
      customOvertimePayment,
      bonus,
      deductions,
      payrollNotes,
      paymentStatus,
      paymentMethod,
      paymentReference,
      paymentDate
    });

    emitToCompany(req.companyId!, 'payroll:updated', {
      employeeId,
      updatedAt: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: 'Employee payroll compensation and overtime settings updated successfully.',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

export const updatePayoutStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (
      req.user?.role !== UserRole.OWNER &&
      req.user?.role !== UserRole.ADMIN &&
      req.user?.role !== UserRole.HR
    ) {
      throw new AppError('Forbidden: Only HR / Admin can update payment settlement status', 403);
    }

    const { employeeId } = req.params;
    const { paymentStatus, paymentMethod, paymentReference, paymentDate } = req.body;

    if (!paymentStatus || !['PENDING', 'APPROVED', 'PAID'].includes(paymentStatus)) {
      throw new AppError('Valid paymentStatus (PENDING, APPROVED, PAID) is required', 400);
    }

    const updated = await updateEmployeePayoutStatus(req.companyId!, employeeId, {
      paymentStatus,
      paymentMethod,
      paymentReference,
      paymentDate
    });

    emitToCompany(req.companyId!, 'payroll:updated', {
      employeeId,
      paymentStatus,
      updatedAt: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: `Payout status marked as ${paymentStatus}.`,
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

export const bulkUpdatePayoutStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (
      req.user?.role !== UserRole.OWNER &&
      req.user?.role !== UserRole.ADMIN &&
      req.user?.role !== UserRole.HR
    ) {
      throw new AppError('Forbidden: Only HR / Admin can update payment settlement status', 403);
    }

    const { employeeIds, paymentStatus, paymentMethod, paymentReference, paymentDate } = req.body;

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      throw new AppError('employeeIds must be a non-empty array', 400);
    }

    if (!paymentStatus || !['PENDING', 'APPROVED', 'PAID'].includes(paymentStatus)) {
      throw new AppError('Valid paymentStatus (PENDING, APPROVED, PAID) is required', 400);
    }

    const result = await bulkUpdateEmployeePayoutStatus(req.companyId!, employeeIds, {
      paymentStatus,
      paymentMethod,
      paymentReference,
      paymentDate
    });

    emitToCompany(req.companyId!, 'payroll:updated', {
      employeeIds,
      paymentStatus,
      updatedAt: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: `Bulk settlement updated: ${result.modifiedCount} employees marked as ${paymentStatus}.`,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const bulkUpdateCompanyPolicy = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user?.role !== UserRole.OWNER && req.user?.role !== UserRole.ADMIN) {
      throw new AppError('Forbidden: Only Admin / Owner can configure company-wide payroll policy', 403);
    }

    const result = await applyBulkCompanyPayrollPolicy(req.companyId!, req.body);

    emitToCompany(req.companyId!, 'payroll:policy-updated', {
      appliedPolicy: result.appliedPolicy,
      updatedAt: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: `Company-wide payroll policy applied to ${result.modifiedCount} employee profiles.`,
      data: result
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
      'Base Hourly Rate',
      'Currency',
      'Standard Daily Hours',
      'Days Worked',
      'Active Hours',
      'Idle Hours',
      'Billable Hours',
      'Regular Hours',
      'Regular Pay',
      'Overtime Mode',
      'Effective OT Rate',
      'Overtime Hours',
      'Calculated OT Pay',
      'Manual OT Adjustment',
      'Total Overtime Pay',
      'Performance Bonus',
      'Deductions',
      'Gross Salary',
      'Net Payout',
      'Payment Status',
      'Payment Method',
      'Payment Reference',
      'Payment Date',
      'Payroll Notes'
    ];

    const rows = summary.items.map((item) => {
      const activeHrs = (item.activeSeconds / 3600).toFixed(2);
      const idleHrs = (item.idleSeconds / 3600).toFixed(2);
      const effectiveOtRate = item.effectiveOtRate != null ? item.effectiveOtRate.toFixed(2) : (item.hourlyRate * item.overtimeMultiplier).toFixed(2);
      const manualOt = (item.customOvertimePayment || 0).toFixed(2);
      const bonus = (item.bonus || 0).toFixed(2);
      const deductions = (item.deductions || 0).toFixed(2);
      const netPay = (item.netPay != null ? item.netPay : item.grossPay).toFixed(2);
      const notes = (item.payrollNotes || '').replace(/"/g, '""');
      const pStatus = item.paymentStatus || 'PENDING';
      const pMethod = item.paymentMethod || 'BANK_TRANSFER';
      const pRef = (item.paymentReference || '').replace(/"/g, '""');
      const pDate = item.paymentDate || '';

      return [
        `"${item.employeeCode}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        `"${item.email}"`,
        `"${item.department}"`,
        `"${item.designation}"`,
        item.hourlyRate.toFixed(2),
        item.currency,
        item.standardDailyHours,
        item.daysWorked,
        activeHrs,
        idleHrs,
        item.totalHours.toFixed(2),
        item.regularHours.toFixed(2),
        item.regularPay.toFixed(2),
        item.overtimeRateMode || 'MULTIPLIER',
        effectiveOtRate,
        item.overtimeHours.toFixed(2),
        (item.overtimePay - (item.customOvertimePayment || 0)).toFixed(2),
        manualOt,
        item.overtimePay.toFixed(2),
        bonus,
        deductions,
        item.grossPay.toFixed(2),
        netPay,
        pStatus,
        pMethod,
        `"${pRef}"`,
        `"${pDate}"`,
        `"${notes}"`
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
