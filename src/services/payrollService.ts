import mongoose from 'mongoose';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { DailySummary } from '../models/DailySummary';
import { AttendanceSession } from '../models/AttendanceSession';
import { Company } from '../models/Company';
import { AppError } from '../middleware/errorHandler';
import { getDateStringInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';
import {
  PayrollSummary,
  PayrollEmployeeItem,
  PayrollDailyEntry
} from '../shared';

interface PayrollQueryParams {
  companyId: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  department?: string;
  payIdleTime?: boolean;
}

export const calculatePayrollSummary = async (
  params: PayrollQueryParams
): Promise<PayrollSummary> => {
  const { companyId, department, payIdleTime = true } = params;
  const companyObjId = new mongoose.Types.ObjectId(companyId);

  const company = await Company.findById(companyObjId);
  const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
  const todayStr = getDateStringInTimezone(new Date(), companyTz);

  // Default date range: current month to date if not provided
  let startStr = params.startDate;
  let endStr = params.endDate;
  if (!startStr || !endStr) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    if (!startStr) startStr = `${year}-${month}-01`;
    if (!endStr) endStr = todayStr;
  }

  const employeeQuery: any = { companyId: companyObjId };
  if (department && department !== 'ALL') {
    employeeQuery.department = department;
  }

  const profiles = await EmployeeProfile.find(employeeQuery)
    .populate({
      path: 'userId',
      select: 'firstName lastName email role status'
    })
    .sort({ employeeCode: 1 })
    .lean();

  // Fetch all DailySummaries within the date range for the company
  const summaries = await DailySummary.find({
    companyId: companyObjId,
    date: { $gte: startStr, $lte: endStr }
  }).lean();

  const summaryMapByEmp = new Map<string, any[]>();
  for (const s of summaries) {
    if (!s.employeeId) continue;
    const k = s.employeeId.toString();
    if (!summaryMapByEmp.has(k)) summaryMapByEmp.set(k, []);
    summaryMapByEmp.get(k)!.push(s);
  }

  let totalGrossPay = 0;
  let totalBillableSec = 0;
  let totalActiveSec = 0;
  let totalIdleSec = 0;
  let totalOtHours = 0;
  let totalOtPay = 0;
  let totalRateSum = 0;

  const items: PayrollEmployeeItem[] = profiles.map((p: any) => {
    const empId = p._id.toString();
    const user = p.userId;
    const firstName = user?.firstName || '';
    const lastName = user?.lastName || '';
    const name = `${firstName} ${lastName}`.trim() || p.employeeCode;

    const hourlyRate = p.hourlyRate != null && p.hourlyRate >= 0 ? p.hourlyRate : 25;
    const currency = p.currency || 'USD';
    const overtimeMultiplier = p.overtimeMultiplier != null && p.overtimeMultiplier >= 1 ? p.overtimeMultiplier : 1.5;
    const standardDailyHours = p.standardDailyHours != null && p.standardDailyHours > 0 ? p.standardDailyHours : 8;

    const empSummaries = summaryMapByEmp.get(empId) || [];

    let empShiftSec = 0;
    let empActiveSec = 0;
    let empIdleSec = 0;
    let empBreakSec = 0;
    let empBillableSec = 0;
    let empRegHrs = 0;
    let empOtHrs = 0;
    let daysWorked = 0;

    for (const ds of empSummaries) {
      const act = ds.activeSeconds || 0;
      const idl = ds.idleSeconds || 0;
      const brk = ds.breakSeconds || 0;
      const shift = ds.totalSessionSeconds || (act + idl + brk);

      // Billable seconds: payIdleTime includes both active and idle intervals
      const billable = payIdleTime ? (act + idl) : act;
      const billableHrs = billable / 3600;

      if (billableHrs > 0) {
        daysWorked++;
      }

      const dayReg = Math.min(billableHrs, standardDailyHours);
      const dayOt = Math.max(0, billableHrs - standardDailyHours);

      empShiftSec += shift;
      empActiveSec += act;
      empIdleSec += idl;
      empBreakSec += brk;
      empBillableSec += billable;
      empRegHrs += dayReg;
      empOtHrs += dayOt;
    }

    // If today is in range, incorporate live session counters and calculate overtime
    if (todayStr >= startStr! && todayStr <= endStr! && ((p.todayActiveSeconds || 0) > 0 || (p.todayIdleSeconds || 0) > 0 || p.currentStatus !== 'OFFLINE')) {
      const todayDs = empSummaries.find((s) => s.date === todayStr);
      const liveAct = Math.max(0, p.todayActiveSeconds || 0);
      const liveIdl = Math.max(0, p.todayIdleSeconds || 0);

      const recordedAct = todayDs ? (todayDs.activeSeconds || 0) : 0;
      const recordedIdl = todayDs ? (todayDs.idleSeconds || 0) : 0;
      const deltaAct = Math.max(0, liveAct - recordedAct);
      const deltaIdl = Math.max(0, liveIdl - recordedIdl);
      const deltaBillable = payIdleTime ? (deltaAct + deltaIdl) : deltaAct;

      if (deltaAct > 0 || deltaIdl > 0) {
        empShiftSec += (deltaAct + deltaIdl);
        empActiveSec += deltaAct;
        empIdleSec += deltaIdl;
        empBillableSec += deltaBillable;

        // Partition today's total into regular and overtime hours
        const priorBillable = payIdleTime ? (recordedAct + recordedIdl) : recordedAct;
        const priorBillableHrs = priorBillable / 3600;
        const priorReg = Math.min(priorBillableHrs, standardDailyHours);
        const priorOt = Math.max(0, priorBillableHrs - standardDailyHours);

        const newBillable = priorBillable + deltaBillable;
        const newBillableHrs = newBillable / 3600;
        const newReg = Math.min(newBillableHrs, standardDailyHours);
        const newOt = Math.max(0, newBillableHrs - standardDailyHours);

        empRegHrs += (newReg - priorReg);
        empOtHrs += (newOt - priorOt);

        if (!todayDs && newBillableHrs > 0 && daysWorked === 0) {
          daysWorked++;
        }
      }
    }

    const regPay = Math.round(empRegHrs * hourlyRate * 100) / 100;
    const otPay = Math.round(empOtHrs * hourlyRate * overtimeMultiplier * 100) / 100;
    const grossPay = Math.round((regPay + otPay) * 100) / 100;

    totalGrossPay += grossPay;
    totalBillableSec += empBillableSec;
    totalActiveSec += empActiveSec;
    totalIdleSec += empIdleSec;
    totalOtHours += empOtHrs;
    totalOtPay += otPay;
    totalRateSum += hourlyRate;

    return {
      employeeId: empId,
      employeeCode: p.employeeCode,
      name,
      email: user?.email || '',
      department: p.department,
      designation: p.designation,
      hourlyRate,
      currency,
      overtimeMultiplier,
      standardDailyHours,
      totalShiftSeconds: empShiftSec,
      activeSeconds: empActiveSec,
      idleSeconds: empIdleSec,
      breakSeconds: empBreakSec,
      billableSeconds: empBillableSec,
      regularHours: Math.round(empRegHrs * 100) / 100,
      overtimeHours: Math.round(empOtHrs * 100) / 100,
      totalHours: Math.round((empRegHrs + empOtHrs) * 100) / 100,
      regularPay: regPay,
      overtimePay: otPay,
      grossPay,
      daysWorked
    };
  });

  const employeeCount = profiles.length;
  const avgHourlyRate = employeeCount > 0 ? Math.round((totalRateSum / employeeCount) * 100) / 100 : 0;

  return {
    totalGrossPay: Math.round(totalGrossPay * 100) / 100,
    currency: items[0]?.currency || 'USD',
    totalBillableHours: Math.round((totalBillableSec / 3600) * 100) / 100,
    totalActiveHours: Math.round((totalActiveSec / 3600) * 100) / 100,
    totalIdleHours: Math.round((totalIdleSec / 3600) * 100) / 100,
    totalOvertimeHours: Math.round(totalOtHours * 100) / 100,
    totalOvertimePay: Math.round(totalOtPay * 100) / 100,
    employeeCount,
    avgHourlyRate,
    periodStart: startStr!,
    periodEnd: endStr!,
    payIdleTime,
    items
  };
};

export const getEmployeePayrollDetail = async (
  companyId: string,
  employeeId: string,
  startDate?: string,
  endDate?: string,
  payIdleTime = true
): Promise<{
  profile: any;
  summary: PayrollEmployeeItem;
  dailyBreakdown: PayrollDailyEntry[];
}> => {
  const companyObjId = new mongoose.Types.ObjectId(companyId);
  const empObjId = new mongoose.Types.ObjectId(employeeId);

  const profile = await EmployeeProfile.findOne({
    _id: empObjId,
    companyId: companyObjId
  }).populate('userId', 'firstName lastName email role');

  if (!profile) {
    throw new AppError('Employee profile not found', 404);
  }

  const company = await Company.findById(companyObjId);
  const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
  const todayStr = getDateStringInTimezone(new Date(), companyTz);

  let startStr = startDate;
  let endStr = endDate;
  if (!startStr || !endStr) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    if (!startStr) startStr = `${year}-${month}-01`;
    if (!endStr) endStr = todayStr;
  }

  const summaries = await DailySummary.find({
    companyId: companyObjId,
    employeeId: empObjId,
    date: { $gte: startStr, $lte: endStr }
  })
    .sort({ date: 1 })
    .lean();

  const hourlyRate = profile.hourlyRate != null && profile.hourlyRate >= 0 ? profile.hourlyRate : 25;
  const currency = profile.currency || 'USD';
  const overtimeMultiplier = profile.overtimeMultiplier != null && profile.overtimeMultiplier >= 1 ? profile.overtimeMultiplier : 1.5;
  const standardDailyHours = profile.standardDailyHours != null && profile.standardDailyHours > 0 ? profile.standardDailyHours : 8;

  let totalShiftSec = 0;
  let totalActiveSec = 0;
  let totalIdleSec = 0;
  let totalBreakSec = 0;
  let totalBillableSec = 0;
  let totalRegHrs = 0;
  let totalOtHrs = 0;
  let daysWorked = 0;

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const dailyBreakdown: PayrollDailyEntry[] = summaries.map((ds: any) => {
    const dateObj = new Date(ds.date + 'T00:00:00Z');
    const dayOfWeek = daysOfWeek[dateObj.getUTCDay()] || '';

    const act = ds.activeSeconds || 0;
    const idl = ds.idleSeconds || 0;
    const brk = ds.breakSeconds || 0;
    const shift = ds.totalSessionSeconds || (act + idl + brk);

    const billable = payIdleTime ? (act + idl) : act;
    const billableHrs = billable / 3600;

    const regHrs = Math.min(billableHrs, standardDailyHours);
    const otHrs = Math.max(0, billableHrs - standardDailyHours);
    const dayEarnings = Math.round((regHrs * hourlyRate + otHrs * hourlyRate * overtimeMultiplier) * 100) / 100;

    if (billableHrs > 0) daysWorked++;

    totalShiftSec += shift;
    totalActiveSec += act;
    totalIdleSec += idl;
    totalBreakSec += brk;
    totalBillableSec += billable;
    totalRegHrs += regHrs;
    totalOtHrs += otHrs;

    return {
      date: ds.date,
      dayOfWeek,
      status: ds.status || 'PRESENT',
      shiftSeconds: shift,
      activeSeconds: act,
      idleSeconds: idl,
      breakSeconds: brk,
      billableSeconds: billable,
      regularHours: Math.round(regHrs * 100) / 100,
      overtimeHours: Math.round(otHrs * 100) / 100,
      dailyEarnings: dayEarnings,
      firstStart: ds.firstSessionStart ? new Date(ds.firstSessionStart).toISOString() : undefined,
      lastEnd: ds.lastSessionEnd ? new Date(ds.lastSessionEnd).toISOString() : undefined
    };
  });

  // Incorporate today's live telemetry and overtime if within requested date range
  if (todayStr >= startStr && todayStr <= endStr) {
    const liveAct = Math.max(0, profile.todayActiveSeconds || 0);
    const liveIdl = Math.max(0, profile.todayIdleSeconds || 0);
    const liveBrk = Math.max(0, profile.todayBreakSeconds || 0);

    const existingToday = dailyBreakdown.find((b) => b.date === todayStr);

    if (existingToday) {
      const recAct = existingToday.activeSeconds || 0;
      const recIdl = existingToday.idleSeconds || 0;
      const deltaAct = Math.max(0, liveAct - recAct);
      const deltaIdl = Math.max(0, liveIdl - recIdl);
      const deltaBillable = payIdleTime ? (deltaAct + deltaIdl) : deltaAct;

      if (deltaAct > 0 || deltaIdl > 0) {
        const priorBillable = existingToday.billableSeconds || 0;
        const priorBillableHrs = priorBillable / 3600;
        const priorReg = Math.min(priorBillableHrs, standardDailyHours);
        const priorOt = Math.max(0, priorBillableHrs - standardDailyHours);

        const newBillable = priorBillable + deltaBillable;
        const newBillableHrs = newBillable / 3600;
        const newReg = Math.min(newBillableHrs, standardDailyHours);
        const newOt = Math.max(0, newBillableHrs - standardDailyHours);

        totalShiftSec += (deltaAct + deltaIdl);
        totalActiveSec += deltaAct;
        totalIdleSec += deltaIdl;
        totalBillableSec += deltaBillable;
        totalRegHrs += (newReg - priorReg);
        totalOtHrs += (newOt - priorOt);

        existingToday.activeSeconds += deltaAct;
        existingToday.idleSeconds += deltaIdl;
        existingToday.shiftSeconds += (deltaAct + deltaIdl);
        existingToday.billableSeconds = newBillable;
        existingToday.regularHours = Math.round(newReg * 100) / 100;
        existingToday.overtimeHours = Math.round(newOt * 100) / 100;
        existingToday.dailyEarnings = Math.round((newReg * hourlyRate + newOt * hourlyRate * overtimeMultiplier) * 100) / 100;
      }
    } else if (liveAct > 0 || liveIdl > 0 || profile.currentStatus !== 'OFFLINE') {
      const shift = liveAct + liveIdl + liveBrk;
      const billable = payIdleTime ? (liveAct + liveIdl) : liveAct;
      const billableHrs = billable / 3600;
      const regHrs = Math.min(billableHrs, standardDailyHours);
      const otHrs = Math.max(0, billableHrs - standardDailyHours);
      const dayEarnings = Math.round((regHrs * hourlyRate + otHrs * hourlyRate * overtimeMultiplier) * 100) / 100;

      if (billableHrs > 0) daysWorked++;

      totalShiftSec += shift;
      totalActiveSec += liveAct;
      totalIdleSec += liveIdl;
      totalBreakSec += liveBrk;
      totalBillableSec += billable;
      totalRegHrs += regHrs;
      totalOtHrs += otHrs;

      const dateObj = new Date(todayStr + 'T00:00:00Z');
      const dayOfWeek = daysOfWeek[dateObj.getUTCDay()] || '';

      dailyBreakdown.push({
        date: todayStr,
        dayOfWeek,
        status: profile.currentStatus !== 'OFFLINE' ? 'ACTIVE' : 'PRESENT',
        shiftSeconds: shift,
        activeSeconds: liveAct,
        idleSeconds: liveIdl,
        breakSeconds: liveBrk,
        billableSeconds: billable,
        regularHours: Math.round(regHrs * 100) / 100,
        overtimeHours: Math.round(otHrs * 100) / 100,
        dailyEarnings: dayEarnings
      });
    }
  }

  const regPay = Math.round(totalRegHrs * hourlyRate * 100) / 100;
  const otPay = Math.round(totalOtHrs * hourlyRate * overtimeMultiplier * 100) / 100;
  const grossPay = Math.round((regPay + otPay) * 100) / 100;

  const user = profile.userId as any;
  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || profile.employeeCode;

  const summary: PayrollEmployeeItem = {
    employeeId: profile._id.toString(),
    employeeCode: profile.employeeCode,
    name,
    email: user?.email || '',
    department: profile.department,
    designation: profile.designation,
    hourlyRate,
    currency,
    overtimeMultiplier,
    standardDailyHours,
    totalShiftSeconds: totalShiftSec,
    activeSeconds: totalActiveSec,
    idleSeconds: totalIdleSec,
    breakSeconds: totalBreakSec,
    billableSeconds: totalBillableSec,
    regularHours: Math.round(totalRegHrs * 100) / 100,
    overtimeHours: Math.round(totalOtHrs * 100) / 100,
    totalHours: Math.round((totalRegHrs + totalOtHrs) * 100) / 100,
    regularPay: regPay,
    overtimePay: otPay,
    grossPay,
    daysWorked
  };

  return {
    profile,
    summary,
    dailyBreakdown
  };
};

export const updateEmployeeHourlyRate = async (
  companyId: string,
  employeeId: string,
  data: {
    hourlyRate?: number;
    currency?: string;
    overtimeMultiplier?: number;
    standardDailyHours?: number;
  }
) => {
  const companyObjId = new mongoose.Types.ObjectId(companyId);
  const empObjId = new mongoose.Types.ObjectId(employeeId);

  const updateFields: any = {};
  if (data.hourlyRate != null && data.hourlyRate >= 0) {
    updateFields.hourlyRate = Number(data.hourlyRate);
  }
  if (data.currency) {
    updateFields.currency = data.currency.trim().toUpperCase();
  }
  if (data.overtimeMultiplier != null && data.overtimeMultiplier >= 1) {
    updateFields.overtimeMultiplier = Number(data.overtimeMultiplier);
  }
  if (data.standardDailyHours != null && data.standardDailyHours > 0) {
    updateFields.standardDailyHours = Number(data.standardDailyHours);
  }

  const updatedProfile = await EmployeeProfile.findOneAndUpdate(
    { _id: empObjId, companyId: companyObjId },
    { $set: updateFields },
    { new: true }
  ).populate('userId', 'firstName lastName email role');

  if (!updatedProfile) {
    throw new AppError('Employee profile not found', 404);
  }

  return updatedProfile;
};
