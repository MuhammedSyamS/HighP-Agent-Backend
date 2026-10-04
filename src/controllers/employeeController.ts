import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { WebsiteActivity } from '../models/WebsiteActivity';
import { Device } from '../models/Device';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditService';
import { AuditAction, UserStatus, UserRole, ActivityState, IDashboardOverview } from '../shared';
import { DailySummary } from '../models/DailySummary';
import { Break } from '../models/Break';
import { getDateStringInTimezone, getDayRangeInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';
import { Company } from '../models/Company';
import { liveTelemetryService } from '../services/liveTelemetryService';


export const getEmployees = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { department, status, search } = req.query;
    const query: any = { companyId: new mongoose.Types.ObjectId(req.companyId) };

    if (department) {
      query.department = department;
    }
    if (status) {
      query.currentStatus = status;
    }

    const profiles = await EmployeeProfile.find(query)
      .populate({
        path: 'userId',
        select: 'firstName lastName email role status'
      })
      .sort({ createdAt: -1 })
      .lean();

    // Only include profiles with an existing user record
    let results = profiles.filter((p: any) => p.userId != null);

    // Filter by search term if provided
    if (search && typeof search === 'string') {
      const term = search.toLowerCase();
      results = results.filter((p: any) => {
        const user = p.userId;
        const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.toLowerCase();
        const code = (p.employeeCode || '').toLowerCase();
        const email = (user?.email || '').toLowerCase();
        return fullName.includes(term) || code.includes(term) || email.includes(term);
      });
    }

    // 1. Fetch company timezone and today's date
    const company = await Company.findById(req.companyId);
    const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
    const todayStr = getDateStringInTimezone(new Date(), companyTz);

    // 2. Fetch today's aggregated ApplicationUsage per employee
    const appUsages = await ApplicationUsage.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(req.companyId),
          date: todayStr
        }
      },
      {
        $group: {
          _id: '$employeeId',
          totalAppSeconds: { $sum: '$totalSeconds' }
        }
      }
    ]);
    const appUsageMap = new Map<string, number>();
    for (const au of appUsages) {
      if (au._id) appUsageMap.set(au._id.toString(), au.totalAppSeconds || 0);
    }

    // 3. Fetch today's DailySummary per employee
    const dailySummaries = await DailySummary.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      date: todayStr
    }).lean();
    const summaryMap = new Map<string, any>();
    for (const ds of dailySummaries) {
      if (ds.employeeId) summaryMap.set(ds.employeeId.toString(), ds);
    }

    // 3b. Fetch today's AttendanceSessions to guarantee active work persistence
    const todayRange = getDayRangeInTimezone(todayStr, companyTz);
    const todaySessions = await AttendanceSession.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      startedAt: { $gte: todayRange.start, $lte: todayRange.end }
    }).lean();
    const sessionActiveMap = new Map<string, number>();
    const sessionIdleMap = new Map<string, number>();
    const sessionBreakMap = new Map<string, number>();

    for (const sess of todaySessions) {
      if (!sess.employeeId) continue;
      const empKey = sess.employeeId.toString();
      let sActive = sess.activeSeconds || 0;
      let sIdle = sess.idleSeconds || 0;
      let sBreak = sess.breakSeconds || 0;

      if (sess.status === 'ACTIVE' && sess.startedAt) {
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(sess.startedAt).getTime()) / 1000));
        sActive = Math.max(sActive, elapsed - sIdle - sBreak);
      }

      sessionActiveMap.set(empKey, (sessionActiveMap.get(empKey) || 0) + sActive);
      sessionIdleMap.set(empKey, (sessionIdleMap.get(empKey) || 0) + sIdle);
      sessionBreakMap.set(empKey, (sessionBreakMap.get(empKey) || 0) + sBreak);
    }

    // 3c. Fetch ongoing breaks to calculate live elapsed break time
    const ongoingBreaks = await Break.find({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      endedAt: { $exists: false }
    }).lean();
    const ongoingBreakMap = new Map<string, number>();
    for (const b of ongoingBreaks) {
      if (b.employeeId && b.startedAt) {
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(b.startedAt).getTime()) / 1000));
        ongoingBreakMap.set(b.employeeId.toString(), elapsed);
      }
    }

    // 4. Ensure currentApplication strictly reflects active status and reconcile active work times
    for (const p of results as any[]) {
      const pIdStr = p._id.toString();
      const appSec = appUsageMap.get(pIdStr) || 0;
      const sumDoc = summaryMap.get(pIdStr);
      const sumActive = sumDoc?.activeSeconds || 0;
      const sumIdle = sumDoc?.idleSeconds || 0;
      const sumBreak = sumDoc?.breakSeconds || 0;
      const cachedActive = p.todayActiveSeconds || 0;
      const cachedIdle = p.todayIdleSeconds || 0;
      const cachedBreak = p.todayBreakSeconds || 0;
      const sessActive = sessionActiveMap.get(pIdStr) || 0;
      const sessIdle = sessionIdleMap.get(pIdStr) || 0;
      const sessBreak = sessionBreakMap.get(pIdStr) || 0;
      const ongoingBreakSec = ongoingBreakMap.get(pIdStr) || 0;

      let activeSec = Math.max(cachedActive, sumActive, appSec, sessActive);

      if (p.currentStatus === ActivityState.ACTIVE) {
        p.currentWebsite = p.currentWebsiteDomain ? { domain: p.currentWebsiteDomain } : null;
      } else {
        p.currentApplication = '';
        p.currentWebsite = null;
      }

      p.todayActiveSeconds = activeSec;
      p.todayIdleSeconds = Math.max(cachedIdle, sumIdle, sessIdle);
      p.todayBreakSeconds = Math.max(cachedBreak, sumBreak, sessBreak) + (p.currentStatus === ActivityState.BREAK ? ongoingBreakSec : 0);
    }

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Employee not found', 404);
    }

    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== id) {
        throw new AppError('Forbidden: Employees can only view their own profile', 403);
      }
    }

    const profile = await EmployeeProfile.findOne({
      _id: new mongoose.Types.ObjectId(id),
      companyId: new mongoose.Types.ObjectId(req.companyId)
    })
      .populate({
        path: 'userId',
        select: 'firstName lastName email role status'
      })
      .populate('managerId', 'employeeCode')
      .lean();

    if (!profile) {
      throw new AppError('Employee not found', 404);
    }

    // Fetch active session if any
    let currentSession = null;
    if (profile.currentSessionId) {
      currentSession = await AttendanceSession.findOne({
        _id: profile.currentSessionId,
        companyId: req.companyId
      }).lean();
    }

    // Fetch registered devices
    const devices = await Device.find({
      companyId: req.companyId,
      employeeId: profile._id
    }).lean();

    // Fetch today's top applications using company timezone
    const company = await Company.findById(req.companyId);
    const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
    const todayStr = getDateStringInTimezone(new Date(), companyTz);
    const topApps = await ApplicationUsage.find({
      companyId: req.companyId,
      employeeId: profile._id,
      date: todayStr
    })
      .sort({ totalSeconds: -1 })
      .lean();

    const topWebsites = await WebsiteActivity.find({
      companyId: req.companyId,
      employeeId: profile._id,
      date: todayStr
    })
      .sort({ totalSeconds: -1 })
      .lean();

    // Reconcile active work time for this profile
    const appSec = topApps.reduce((acc, a) => acc + (a.totalSeconds || 0), 0);
    const summaryDoc = await DailySummary.findOne({
      companyId: req.companyId,
      employeeId: profile._id,
      date: todayStr
    }).lean();
    const sumActive = summaryDoc?.activeSeconds || 0;
    const sumIdle = summaryDoc?.idleSeconds || 0;
    const sumBreak = summaryDoc?.breakSeconds || 0;
    const cachedActive = (profile as any).todayActiveSeconds || 0;
    const cachedIdle = (profile as any).todayIdleSeconds || 0;
    const cachedBreak = (profile as any).todayBreakSeconds || 0;

    let sessActive = 0;
    let sessIdle = 0;
    let sessBreak = 0;
    if (currentSession && currentSession.startedAt) {
      sessActive = currentSession.activeSeconds || 0;
      sessIdle = currentSession.idleSeconds || 0;
      sessBreak = currentSession.breakSeconds || 0;
    }

    let activeSec = Math.max(cachedActive, sumActive, appSec, sessActive);

    if (profile.currentStatus !== ActivityState.ACTIVE) {
      profile.currentApplication = '';
    }

    // Check for ongoing break to display live break time
    const ongoingBreak = await Break.findOne({
      companyId: req.companyId,
      employeeId: profile._id,
      endedAt: { $exists: false }
    }).lean();
    const ongoingBreakSec = (ongoingBreak && ongoingBreak.startedAt)
      ? Math.max(0, Math.floor((Date.now() - new Date(ongoingBreak.startedAt).getTime()) / 1000))
      : 0;

    (profile as any).todayActiveSeconds = activeSec;
    (profile as any).todayIdleSeconds = Math.max(cachedIdle, sumIdle, sessIdle);
    (profile as any).todayBreakSeconds = Math.max(cachedBreak, sumBreak, sessBreak) + (profile.currentStatus === ActivityState.BREAK ? ongoingBreakSec : 0);

    res.status(200).json({
      success: true,
      data: {
        profile,
        currentSession,
        devices,
        topApps,
        topWebsites
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeLiveTelemetry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid employee ID', 400);
    }

    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== id) {
        throw new AppError('Forbidden: Employees can only view their own live telemetry', 403);
      }
    }

    const state = await liveTelemetryService.getLiveTelemetry(id, req.companyId);
    res.status(200).json({
      success: true,
      data: state
    });
  } catch (error) {
    next(error);
  }
};

export const createEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, firstName, lastName, password = 'Password@123', role, employeeCode, department, designation, managerId } = req.body;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw new AppError('A user with this email already exists', 409);
    }

    const existingCode = await EmployeeProfile.findOne({
      companyId: req.companyId,
      employeeCode: employeeCode.trim()
    });
    if (existingCode) {
      throw new AppError(`Employee code '${employeeCode}' is already taken in your company.`, 409);
    }

    // Create User
    const user = new User({
      email: email.toLowerCase(),
      passwordHash: password,
      firstName,
      lastName,
      role,
      companyId: new mongoose.Types.ObjectId(req.companyId),
      status: UserStatus.ACTIVE
    });
    await user.save();

    // Create EmployeeProfile
    const profile = await EmployeeProfile.create({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      userId: user._id,
      employeeCode: employeeCode.trim(),
      department: department.trim(),
      designation: designation.trim(),
      ...(managerId && { managerId: new mongoose.Types.ObjectId(managerId) })
    });

    user.employeeProfileId = profile._id;
    await user.save();

    await logAudit({
      companyId: req.companyId!,
      userId: req.user?.userId,
      action: AuditAction.EMPLOYEE_CREATED,
      resource: 'Employee',
      details: { employeeId: profile._id, email: user.email },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Employee created successfully.',
      data: {
        profile,
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { firstName, lastName, role, department, designation, managerId, status } = req.body;

    const profile = await EmployeeProfile.findOne({ _id: id, companyId: req.companyId });
    if (!profile) {
      throw new AppError('Employee not found', 404);
    }

    if (department !== undefined) profile.department = department;
    if (designation !== undefined) profile.designation = designation;
    if (managerId !== undefined) {
      profile.managerId = managerId ? new mongoose.Types.ObjectId(managerId) : undefined;
    }
    await profile.save();

    // Update corresponding User record
    const user = await User.findById(profile.userId);
    if (user) {
      if (firstName !== undefined) user.firstName = firstName;
      if (lastName !== undefined) user.lastName = lastName;
      if (role !== undefined) user.role = role;
      if (status !== undefined) user.status = status;
      await user.save();
    }

    await logAudit({
      companyId: req.companyId!,
      userId: req.user?.userId,
      action: AuditAction.EMPLOYEE_UPDATED,
      resource: 'Employee',
      details: { employeeId: profile._id },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Employee updated successfully.',
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

export const deleteEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const profile = await EmployeeProfile.findOne({ _id: id, companyId: req.companyId });
    if (!profile) {
      throw new AppError('Employee not found', 404);
    }

    // Soft delete / suspend user
    await User.updateOne({ _id: profile.userId }, { status: UserStatus.INACTIVE });

    await logAudit({
      companyId: req.companyId!,
      userId: req.user?.userId,
      action: AuditAction.EMPLOYEE_DELETED,
      resource: 'Employee',
      details: { employeeId: profile._id },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Employee marked as inactive.'
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboardOverview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const companyId = new mongoose.Types.ObjectId(req.companyId);

    const rawProfiles = await EmployeeProfile.find({ companyId }).populate('userId', '_id status').lean();
    const profiles = rawProfiles.filter((p: any) => p.userId != null);
    const totalEmployees = profiles.length;

    let activeNow = 0;
    let idleNow = 0;
    let onBreakNow = 0;
    let offlineNow = 0;
    let totalActiveSecondsToday = 0;
    let totalIdleSecondsToday = 0;
    let totalBreakSecondsToday = 0;

    const company = await Company.findById(companyId);
    const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
    const todayStr = getDateStringInTimezone(new Date(), companyTz);

    const appUsages = await ApplicationUsage.aggregate([
      {
        $match: {
          companyId,
          date: todayStr
        }
      },
      {
        $group: {
          _id: '$employeeId',
          totalAppSeconds: { $sum: '$totalSeconds' }
        }
      }
    ]);
    const appUsageMap = new Map<string, number>();
    for (const au of appUsages) {
      if (au._id) appUsageMap.set(au._id.toString(), au.totalAppSeconds || 0);
    }

    const dailySummaries = await DailySummary.find({
      companyId,
      date: todayStr
    }).lean();
    const summaryMap = new Map<string, any>();
    for (const ds of dailySummaries) {
      if (ds.employeeId) summaryMap.set(ds.employeeId.toString(), ds);
    }

    const todayRange = getDayRangeInTimezone(todayStr, companyTz);
    const todaySessions = await AttendanceSession.find({
      companyId,
      startedAt: { $gte: todayRange.start, $lte: todayRange.end }
    }).lean();
    const sessionActiveMap = new Map<string, number>();
    const sessionIdleMap = new Map<string, number>();
    const sessionBreakMap = new Map<string, number>();

    for (const sess of todaySessions) {
      if (!sess.employeeId) continue;
      const empKey = sess.employeeId.toString();
      let sActive = sess.activeSeconds || 0;
      let sIdle = sess.idleSeconds || 0;
      let sBreak = sess.breakSeconds || 0;

      if (sess.status === 'ACTIVE' && sess.startedAt) {
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(sess.startedAt).getTime()) / 1000));
        sActive = Math.max(sActive, elapsed - sIdle - sBreak);
      }

      sessionActiveMap.set(empKey, (sessionActiveMap.get(empKey) || 0) + sActive);
      sessionIdleMap.set(empKey, (sessionIdleMap.get(empKey) || 0) + sIdle);
      sessionBreakMap.set(empKey, (sessionBreakMap.get(empKey) || 0) + sBreak);
    }

    const ongoingBreaks = await Break.find({
      companyId,
      endedAt: { $exists: false }
    }).lean();
    const ongoingBreakMap = new Map<string, number>();
    for (const b of ongoingBreaks) {
      if (b.employeeId && b.startedAt) {
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(b.startedAt).getTime()) / 1000));
        ongoingBreakMap.set(b.employeeId.toString(), elapsed);
      }
    }

    for (const p of profiles) {
      if (p.currentStatus === ActivityState.ACTIVE) activeNow++;
      else if (p.currentStatus === ActivityState.IDLE) idleNow++;
      else if (p.currentStatus === ActivityState.BREAK) onBreakNow++;
      else offlineNow++;

      const pIdStr = p._id.toString();
      const appSec = appUsageMap.get(pIdStr) || 0;
      const sumDoc = summaryMap.get(pIdStr);
      const sumActive = sumDoc?.activeSeconds || 0;
      const sumIdle = sumDoc?.idleSeconds || 0;
      const sumBreak = sumDoc?.breakSeconds || 0;
      const cachedActive = p.todayActiveSeconds || 0;
      const cachedIdle = p.todayIdleSeconds || 0;
      const cachedBreak = p.todayBreakSeconds || 0;
      const sessActive = sessionActiveMap.get(pIdStr) || 0;
      const sessIdle = sessionIdleMap.get(pIdStr) || 0;
      const sessBreak = sessionBreakMap.get(pIdStr) || 0;
      const ongoingBreakSec = ongoingBreakMap.get(pIdStr) || 0;

      let activeSec = Math.max(cachedActive, sumActive, appSec, sessActive);

      totalActiveSecondsToday += activeSec;
      totalIdleSecondsToday += Math.max(cachedIdle, sumIdle, sessIdle);
      totalBreakSecondsToday += Math.max(cachedBreak, sumBreak, sessBreak) + (p.currentStatus === ActivityState.BREAK ? ongoingBreakSec : 0);
    }

    const overview: IDashboardOverview = {
      totalEmployees,
      activeNow,
      idleNow,
      onBreakNow,
      offlineNow,
      currentlyWorking: activeNow + idleNow,
      totalActiveSecondsToday,
      totalIdleSecondsToday,
      totalBreakSecondsToday
    };

    res.status(200).json({
      success: true,
      data: overview
    });
  } catch (error) {
    next(error);
  }
};
