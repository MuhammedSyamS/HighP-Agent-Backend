import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { startWorkSession, endWorkSession } from '../services/sessionService';
import { processHeartbeat } from '../services/heartbeatService';
import { ingestActivityEvents } from '../services/activityService';
import { AttendanceSession } from '../models/AttendanceSession';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { DailySummary } from '../models/DailySummary';
import { Company } from '../models/Company';
import { AppError } from '../middleware/errorHandler';
import { UserRole, ActivityState, ActivityEventType } from '../shared';
import { getDateStringInTimezone, getDayRangeInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';

export const startSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this user account', 400);
    }

    const { deviceId } = req.body;
    const session = await startWorkSession(req.companyId!, employeeId, deviceId);

    res.status(200).json({
      success: true,
      message: 'Work session started successfully.',
      data: session
    });
  } catch (error) {
    next(error);
  }
};

export const endSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this user account', 400);
    }

    const { sessionId, endReason } = req.body;
    const session = await endWorkSession(req.companyId!, employeeId, sessionId, endReason);

    res.status(200).json({
      success: true,
      message: 'Work session ended successfully.',
      data: session
    });
  } catch (error) {
    next(error);
  }
};

export const getAttendanceSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId, startDate, endDate, date, limit = '50' } = req.query;
    const query: any = { companyId: new mongoose.Types.ObjectId(req.companyId) };

    if (req.user?.role === UserRole.EMPLOYEE) {
      query.employeeId = new mongoose.Types.ObjectId(req.user.employeeProfileId);
    } else if (employeeId) {
      query.employeeId = new mongoose.Types.ObjectId(employeeId as string);
    }

    if (date && typeof date === 'string') {
      const company = await Company.findById(req.companyId);
      const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
      const range = getDayRangeInTimezone(date, companyTz);
      query.startedAt = { $gte: range.start, $lte: range.end };
    } else if (startDate || endDate) {
      query.startedAt = {};
      if (startDate) query.startedAt.$gte = new Date(startDate as string);
      if (endDate) query.startedAt.$lte = new Date(endDate as string);
    }

    const sessions = await AttendanceSession.find(query)
      .populate({
        path: 'employeeId',
        select: 'employeeCode department userId currentStatus currentApplication',
        populate: {
          path: 'userId',
          select: 'firstName lastName email'
        }
      })
      .sort({ startedAt: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();

    res.status(200).json({
      success: true,
      data: sessions
    });
  } catch (error) {
    next(error);
  }
};

export const getAttendanceDailyRoster = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { date } = req.query;
    const company = await Company.findById(req.companyId);
    const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
    const dateStr = (date as string) || getDateStringInTimezone(new Date(), companyTz);
    const dayRange = getDayRangeInTimezone(dateStr, companyTz);

    const profiles = await EmployeeProfile.find({
      companyId: new mongoose.Types.ObjectId(req.companyId)
    })
      .populate({
        path: 'userId',
        select: 'firstName lastName email role status'
      })
      .sort({ employeeCode: 1 })
      .lean();

    const sessions = await AttendanceSession.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      startedAt: { $gte: dayRange.start, $lte: dayRange.end }
    })
      .sort({ startedAt: 1 })
      .lean();

    const dailySummaries = await DailySummary.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      date: dateStr
    }).lean();
    const summaryMap = new Map<string, any>();
    for (const ds of dailySummaries) {
      if (ds.employeeId) summaryMap.set(ds.employeeId.toString(), ds);
    }

    const sessByEmp = new Map<string, any[]>();
    for (const s of sessions) {
      if (!s.employeeId) continue;
      const k = s.employeeId.toString();
      if (!sessByEmp.has(k)) sessByEmp.set(k, []);
      sessByEmp.get(k)!.push(s);
    }

    let presentCount = 0;
    let workingNowCount = 0;
    let completedShiftCount = 0;
    let absentCount = 0;

    const roster = profiles.map((p: any) => {
      const pId = p._id.toString();
      const empSessions = sessByEmp.get(pId) || [];
      const user = p.userId;
      const name = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Employee' : 'Employee';
      const ds = summaryMap.get(pId);

      const firstStart = empSessions.length > 0 ? empSessions[0].startedAt : (ds?.firstSessionStart || null);
      const isLiveNow = empSessions.some((s: any) => s.status === 'ACTIVE') || p.currentStatus === ActivityState.ACTIVE;
      const lastCompleted = [...empSessions].reverse().find((s: any) => s.endedAt);
      const lastEnd = !isLiveNow && lastCompleted ? lastCompleted.endedAt : (ds?.lastSessionEnd || null);

      let status = 'ABSENT';
      if (isLiveNow) {
        status = 'PRESENT_ACTIVE';
        presentCount++;
        workingNowCount++;
      } else if (firstStart) {
        status = 'SHIFT_COMPLETED';
        presentCount++;
        completedShiftCount++;
      } else {
        absentCount++;
      }

      let totalActive = 0;
      let totalIdle = 0;
      let totalBreak = 0;
      for (const s of empSessions) {
        let act = s.activeSeconds || 0;
        let idl = s.idleSeconds || 0;
        let brk = s.breakSeconds || 0;
        if (s.status === 'ACTIVE' && s.startedAt) {
          const elap = Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000));
          act = Math.max(act, elap - idl - brk);
        }
        totalActive += act;
        totalIdle += idl;
        totalBreak += brk;
      }
      if (ds) {
        totalActive = Math.max(totalActive, ds.activeSeconds || 0);
        totalIdle = Math.max(totalIdle, ds.idleSeconds || 0);
        totalBreak = Math.max(totalBreak, ds.breakSeconds || 0);
      }

      const totalShiftSeconds = totalActive + totalIdle + totalBreak;

      return {
        employeeId: p._id,
        name,
        email: user?.email || '',
        employeeCode: p.employeeCode,
        department: p.department,
        designation: p.designation,
        currentStatus: p.currentStatus,
        attendanceStatus: status,
        shiftStartedAt: firstStart ? new Date(firstStart).toISOString() : null,
        shiftEndedAt: lastEnd ? new Date(lastEnd).toISOString() : null,
        totalShiftSeconds,
        totalActiveSeconds: totalActive,
        totalIdleSeconds: totalIdle,
        totalBreakSeconds: totalBreak,
        sessionsCount: empSessions.length,
        sessions: empSessions.map((s: any) => ({
          _id: s._id,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationSeconds: (s.activeSeconds || 0) + (s.idleSeconds || 0) + (s.breakSeconds || 0),
          activeSeconds: s.activeSeconds,
          status: s.status
        }))
      };
    });

    const totalEmployees = profiles.length;
    const attendanceRate = totalEmployees > 0 ? Math.round((presentCount / totalEmployees) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        date: dateStr,
        summary: {
          totalEmployees,
          presentCount,
          workingNowCount,
          completedShiftCount,
          absentCount,
          attendanceRate
        },
        roster
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeAttendance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId } = req.params;

    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== employeeId) {
        throw new AppError('Forbidden: Employees can only view their own attendance', 403);
      }
    }

    const sessions = await AttendanceSession.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      employeeId: new mongoose.Types.ObjectId(employeeId)
    })
      .sort({ startedAt: -1 })
      .limit(30)
      .lean();

    res.status(200).json({
      success: true,
      data: sessions
    });
  } catch (error) {
    next(error);
  }
};

export const attendanceHeartbeat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employeeId = req.user?.employeeProfileId;
    if (!employeeId) {
      throw new AppError('No employee profile associated with this user account', 400);
    }

    const { status, currentApplication, recentDurationSeconds = 15, idleSeconds = 0, totalActiveSeconds, totalIdleSeconds } = req.body;
    const profile = await EmployeeProfile.findOne({
      _id: new mongoose.Types.ObjectId(employeeId),
      companyId: new mongoose.Types.ObjectId(req.companyId)
    });

    if (!profile) {
      throw new AppError('Employee profile not found', 404);
    }

    const sessionId = profile.currentSessionId ? profile.currentSessionId.toString() : undefined;
    const now = new Date();
    let effectiveApp = currentApplication ? currentApplication.trim() : profile.currentApplication;
    if (
      effectiveApp &&
      (effectiveApp.includes('•') ||
        effectiveApp.includes('Internal Workforce') ||
        effectiveApp.includes('HighP Web Workspace') ||
        effectiveApp.length > 30)
    ) {
      effectiveApp = profile.currentApplication;
    }

    const effectiveStatus = status || profile.currentStatus || ActivityState.ACTIVE;

    const result = await processHeartbeat({
      companyId: req.companyId!,
      employeeId,
      sessionId,
      timestamp: now.toISOString(),
      status: effectiveStatus,
      currentApplication: effectiveApp,
      totalActiveSeconds: totalActiveSeconds != null ? Number(totalActiveSeconds) : undefined,
      totalIdleSeconds: totalIdleSeconds != null ? Number(totalIdleSeconds) : undefined,
      idleSeconds: Number(idleSeconds) || 0,
      recentDurationSeconds: Number(recentDurationSeconds) || 0,
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const getAttendanceMonthly = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { year, month, department, exportCsv } = req.query;
    const company = await Company.findById(req.companyId);
    const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;

    const nowInTz = new Date();
    const todayStr = getDateStringInTimezone(nowInTz, companyTz);
    const todayParts = todayStr.split('-').map(Number);

    const targetYear = year ? parseInt(year as string, 10) : todayParts[0];
    const targetMonth = month ? parseInt(month as string, 10) : todayParts[1];

    const monthStr = String(targetMonth).padStart(2, '0');
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    const startMonthStr = `${targetYear}-${monthStr}-01`;
    const endMonthStr = `${targetYear}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthLabel = `${monthNames[targetMonth - 1]} ${targetYear}`;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const daysMeta: Array<{
      day: number;
      date: string;
      dayOfWeek: string;
      isWeekend: boolean;
      isToday: boolean;
      isFuture: boolean;
    }> = [];

    let totalWorkingDaysInMonth = 0;
    let workingDaysElapsed = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${targetYear}-${monthStr}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(targetYear, targetMonth - 1, d);
      const dow = dateObj.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isToday = dStr === todayStr;
      const isFuture = dStr > todayStr;

      if (!isWeekend) {
        totalWorkingDaysInMonth++;
        if (!isFuture) {
          workingDaysElapsed++;
        }
      }

      daysMeta.push({
        day: d,
        date: dStr,
        dayOfWeek: dayNames[dow],
        isWeekend,
        isToday,
        isFuture
      });
    }

    const employeeQuery: any = { companyId: new mongoose.Types.ObjectId(req.companyId) };
    if (department && department !== 'ALL') {
      employeeQuery.department = department;
    }
    if (req.user?.role === UserRole.EMPLOYEE) {
      employeeQuery._id = new mongoose.Types.ObjectId(req.user.employeeProfileId);
    }

    const profiles = await EmployeeProfile.find(employeeQuery)
      .populate({
        path: 'userId',
        select: 'firstName lastName email role status'
      })
      .sort({ employeeCode: 1 })
      .lean();

    const summaries = await DailySummary.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      date: { $gte: startMonthStr, $lte: endMonthStr }
    }).lean();

    const summaryMap = new Map<string, Map<string, any>>();
    for (const ds of summaries) {
      if (!ds.employeeId) continue;
      const empKey = ds.employeeId.toString();
      if (!summaryMap.has(empKey)) summaryMap.set(empKey, new Map());
      summaryMap.get(empKey)!.set(ds.date, ds);
    }

    const todaySessions = await AttendanceSession.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      startedAt: {
        $gte: getDayRangeInTimezone(todayStr, companyTz).start,
        $lte: getDayRangeInTimezone(todayStr, companyTz).end
      }
    }).lean();

    const todaySessionMap = new Map<string, any[]>();
    for (const s of todaySessions) {
      if (!s.employeeId) continue;
      const empKey = s.employeeId.toString();
      if (!todaySessionMap.has(empKey)) todaySessionMap.set(empKey, []);
      todaySessionMap.get(empKey)!.push(s);
    }

    let companyTotalShiftSec = 0;
    let companyTotalActiveSec = 0;
    let companyTotalIdleSec = 0;
    let companyTotalBreakSec = 0;
    let companyPresentDaysSum = 0;

    const employeesResult = profiles.map((p: any) => {
      const pId = p._id.toString();
      const user = p.userId;
      const name = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Employee' : 'Employee';
      const empSummaries = summaryMap.get(pId) || new Map<string, any>();
      const empTodaySessions = todaySessionMap.get(pId) || [];

      let empTotalShiftSec = 0;
      let empTotalActiveSec = 0;
      let empTotalIdleSec = 0;
      let empTotalBreakSec = 0;
      let empPresentDays = 0;

      const dailyAttendance = daysMeta.map((dm) => {
        const ds = empSummaries.get(dm.date);
        let shiftSec = ds?.totalSessionSeconds || 0;
        let actSec = ds?.activeSeconds || 0;
        let idlSec = ds?.idleSeconds || 0;
        let brkSec = ds?.breakSeconds || 0;
        let firstStart = ds?.firstSessionStart ? new Date(ds.firstSessionStart).toISOString() : null;
        let lastEnd = ds?.lastSessionEnd ? new Date(ds.lastSessionEnd).toISOString() : null;
        let dayStatus: 'PRESENT_ACTIVE' | 'PRESENT' | 'ABSENT' | 'WEEKEND' | 'FUTURE' = 'ABSENT';

        if (dm.isToday && empTodaySessions.length > 0) {
          const isLiveNow = empTodaySessions.some((s: any) => s.status === 'ACTIVE');
          let liveAct = 0;
          let liveIdl = 0;
          let liveBrk = 0;
          let minStart: Date | null = null;
          let maxEnd: Date | null = null;

          for (const s of empTodaySessions) {
            let sAct = s.activeSeconds || 0;
            let sIdl = s.idleSeconds || 0;
            let sBrk = s.breakSeconds || 0;
            if (s.status === 'ACTIVE' && s.startedAt) {
              const elap = Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000));
              sAct = Math.max(sAct, elap - sIdl - sBrk);
            }
            liveAct += sAct;
            liveIdl += sIdl;
            liveBrk += sBrk;
            if (!minStart || new Date(s.startedAt) < minStart) minStart = new Date(s.startedAt);
            if (s.endedAt && (!maxEnd || new Date(s.endedAt) > maxEnd)) maxEnd = new Date(s.endedAt);
          }

          actSec = Math.max(actSec, liveAct);
          idlSec = Math.max(idlSec, liveIdl);
          brkSec = Math.max(brkSec, liveBrk);
          shiftSec = actSec + idlSec + brkSec;
          if (minStart) firstStart = minStart.toISOString();
          if (maxEnd && !isLiveNow) lastEnd = maxEnd.toISOString();
        }

        if (dm.isFuture) {
          dayStatus = 'FUTURE';
        } else if (shiftSec > 0 || (ds?.status && ds.status !== 'ABSENT') || (dm.isToday && empTodaySessions.length > 0)) {
          const isLive = dm.isToday && (empTodaySessions.some((s: any) => s.status === 'ACTIVE') || p.currentStatus === ActivityState.ACTIVE);
          dayStatus = isLive ? 'PRESENT_ACTIVE' : 'PRESENT';
          empPresentDays++;
        } else if (dm.isWeekend) {
          dayStatus = 'WEEKEND';
        } else {
          dayStatus = 'ABSENT';
        }

        empTotalShiftSec += shiftSec;
        empTotalActiveSec += actSec;
        empTotalIdleSec += idlSec;
        empTotalBreakSec += brkSec;

        return {
          day: dm.day,
          date: dm.date,
          dayOfWeek: dm.dayOfWeek,
          isWeekend: dm.isWeekend,
          isToday: dm.isToday,
          isFuture: dm.isFuture,
          status: dayStatus,
          shiftSeconds: shiftSec,
          activeSeconds: actSec,
          idleSeconds: idlSec,
          breakSeconds: brkSec,
          firstStart,
          lastEnd
        };
      });

      const effectiveWorkingDays = workingDaysElapsed > 0 ? workingDaysElapsed : 1;
      const attendanceRate = Math.min(100, Math.round((empPresentDays / effectiveWorkingDays) * 100));
      const absentDays = Math.max(0, workingDaysElapsed - empPresentDays);
      const avgDailyActiveSec = empPresentDays > 0 ? Math.round(empTotalActiveSec / empPresentDays) : 0;
      const activeFocusPercent = empTotalShiftSec > 0 ? Math.round((empTotalActiveSec / empTotalShiftSec) * 100) : 0;

      companyTotalShiftSec += empTotalShiftSec;
      companyTotalActiveSec += empTotalActiveSec;
      companyTotalIdleSec += empTotalIdleSec;
      companyTotalBreakSec += empTotalBreakSec;
      companyPresentDaysSum += empPresentDays;

      return {
        employeeId: p._id,
        name,
        email: user?.email || '',
        employeeCode: p.employeeCode,
        department: p.department,
        designation: p.designation,
        currentStatus: p.currentStatus,
        presentDays: empPresentDays,
        absentDays,
        attendanceRate,
        totalShiftSeconds: empTotalShiftSec,
        totalActiveSeconds: empTotalActiveSec,
        totalIdleSeconds: empTotalIdleSec,
        totalBreakSeconds: empTotalBreakSec,
        averageDailyActiveSeconds: avgDailyActiveSec,
        activeFocusPercent,
        dailyAttendance
      };
    });

    const totalEmployees = profiles.length;
    const avgAttendanceRate = totalEmployees > 0
      ? Math.round(employeesResult.reduce((acc, e) => acc + e.attendanceRate, 0) / totalEmployees)
      : 0;
    const companyActiveFocusPercent = companyTotalShiftSec > 0
      ? Math.round((companyTotalActiveSec / companyTotalShiftSec) * 100)
      : 0;

    const summary = {
      totalEmployees,
      totalWorkingDaysInMonth,
      workingDaysElapsed,
      companyTotalShiftSeconds: companyTotalShiftSec,
      companyTotalActiveSeconds: companyTotalActiveSec,
      companyTotalIdleSeconds: companyTotalIdleSec,
      companyTotalBreakSeconds: companyTotalBreakSec,
      avgAttendanceRate,
      companyActiveFocusPercent,
      totalPresentDays: companyPresentDaysSum
    };

    if (exportCsv === 'true') {
      const formatHrs = (sec: number) => (sec / 3600).toFixed(1) + 'h';
      const dayHeaders = daysMeta.map((dm) => `Day ${dm.day} (${dm.dayOfWeek})`);
      const headers = [
        'Employee Code',
        'Name',
        'Email',
        'Department',
        'Designation',
        'Present Days',
        'Absent Days',
        'Attendance Rate (%)',
        'Total Shift Time',
        'Active Work Time',
        'Idle Time',
        'Break Time',
        'Active Focus (%)',
        ...dayHeaders
      ];

      const csvRows = employeesResult.map((emp) => {
        const dayCols = emp.dailyAttendance.map((d) => {
          if (d.status === 'PRESENT_ACTIVE') return `Present/Active (${formatHrs(d.shiftSeconds)})`;
          if (d.status === 'PRESENT') return `Present (${formatHrs(d.shiftSeconds)})`;
          if (d.status === 'WEEKEND') return 'Weekend';
          if (d.status === 'FUTURE') return '-';
          return 'Absent';
        });

        return [
          `"${emp.employeeCode}"`,
          `"${emp.name}"`,
          `"${emp.email}"`,
          `"${emp.department || 'N/A'}"`,
          `"${emp.designation || 'N/A'}"`,
          emp.presentDays,
          emp.absentDays,
          `"${emp.attendanceRate}%"`,
          `"${formatHrs(emp.totalShiftSeconds)}"`,
          `"${formatHrs(emp.totalActiveSeconds)}"`,
          `"${formatHrs(emp.totalIdleSeconds)}"`,
          `"${formatHrs(emp.totalBreakSeconds)}"`,
          `"${emp.activeFocusPercent}%"`,
          ...dayCols.map((col) => `"${col}"`)
        ].join(',');
      });

      const csvContent = [headers.join(','), ...csvRows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=monthly-attendance-${targetYear}-${monthStr}.csv`);
      res.status(200).send(csvContent);
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        year: targetYear,
        month: targetMonth,
        monthLabel,
        daysInMonth,
        workingDaysElapsed,
        totalWorkingDaysInMonth,
        summary,
        days: daysMeta,
        employees: employeesResult
      }
    });
  } catch (error) {
    next(error);
  }
};

