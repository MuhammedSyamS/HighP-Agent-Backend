import mongoose from 'mongoose';
import { SessionStatus, ActivityState, BreakReason, ActivityEventType } from '../shared';
import { AttendanceSession, IAttendanceSessionDocument } from '../models/AttendanceSession';
import { Break, IBreakDocument } from '../models/Break';
import { ActivityEvent } from '../models/ActivityEvent';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { Device } from '../models/Device';
import { AppError } from '../middleware/errorHandler';
import { emitToCompany, emitToEmployee } from '../realtime/socketManager';
import { Company } from '../models/Company';
import { getDateStringInTimezone, getDayRangeInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';
import { rebuildEmployeeDay } from './rebuildService';

export const startWorkSession = async (
  companyId: string,
  employeeId: string,
  deviceId?: string
) => {
  const profile = await EmployeeProfile.findOne({ _id: employeeId, companyId });
  if (!profile) {
    throw new AppError('Employee profile not found.', 404);
  }

  const company = await Company.findById(companyId);
  const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
  const now = new Date();
  const todayStr = getDateStringInTimezone(now, companyTz);
  const { start: startOfToday, end: endOfToday } = getDayRangeInTimezone(todayStr, companyTz);

  // 1. If profile is already linked to an active session, return it
  if (profile.currentSessionId) {
    const existing = await AttendanceSession.findOne({
      _id: profile.currentSessionId,
      companyId,
      status: SessionStatus.ACTIVE
    });
    if (existing) {
      return existing;
    }
  }

  // 2. Also check if an active work session is already open for this employee
  const existingActive = await AttendanceSession.findOne({
    companyId: new mongoose.Types.ObjectId(companyId),
    employeeId: profile._id,
    status: SessionStatus.ACTIVE
  }).sort({ startedAt: -1 });

  if (existingActive) {
    profile.currentSessionId = existingActive._id;
    profile.currentStatus = ActivityState.ACTIVE;
    profile.lastActiveAt = now;
    profile.lastHeartbeatAt = now;
    await profile.save();
    return existingActive;
  }

  let resolvedDeviceId: mongoose.Types.ObjectId | undefined;
  if (deviceId) {
    if (typeof deviceId === 'string' && /^[0-9a-fA-F]{24}$/.test(deviceId)) {
      resolvedDeviceId = new mongoose.Types.ObjectId(deviceId);
    } else {
      const devDoc = await Device.findOne({ companyId, deviceId });
      if (devDoc) resolvedDeviceId = devDoc._id as mongoose.Types.ObjectId;
    }
  }

  // 3. ENFORCE STRICTLY ONE ATTENDANCE SESSION PER DAY PER EMPLOYEE
  // Check if a session already exists for today (even if completed / clocked out earlier today)
  const existingTodaySession = await AttendanceSession.findOne({
    companyId: new mongoose.Types.ObjectId(companyId),
    employeeId: profile._id,
    $or: [
      { date: todayStr },
      { startedAt: { $gte: startOfToday, $lte: endOfToday } }
    ]
  }).sort({ startedAt: 1 });

  let session: IAttendanceSessionDocument;

  if (existingTodaySession) {
    // RESUME today's existing session: DO NOT create multiple sessions on the same day!
    existingTodaySession.status = SessionStatus.ACTIVE;
    existingTodaySession.endedAt = undefined;
    existingTodaySession.endReason = undefined;
    existingTodaySession.lastHeartbeatAt = now;
    if (!existingTodaySession.date) existingTodaySession.date = todayStr;
    if (resolvedDeviceId) existingTodaySession.deviceId = resolvedDeviceId;
    await existingTodaySession.save();
    session = existingTodaySession;
    console.log(`[SessionService] Resumed today's single session for employee ${employeeId} on ${todayStr} (ID: ${session._id})`);
  } else {
    // Create the ONLY session for today
    session = await AttendanceSession.create({
      companyId: new mongoose.Types.ObjectId(companyId),
      employeeId: new mongoose.Types.ObjectId(employeeId),
      date: todayStr,
      ...(resolvedDeviceId && { deviceId: resolvedDeviceId }),
      startedAt: now,
      durationSeconds: 0,
      activeSeconds: 0,
      idleSeconds: 0,
      breakSeconds: 0,
      status: SessionStatus.ACTIVE,
      lastHeartbeatAt: now
    });
    console.log(`[SessionService] Created single daily session for employee ${employeeId} on ${todayStr} (ID: ${session._id})`);
  }

  profile.currentSessionId = session._id;
  if (resolvedDeviceId) profile.currentDeviceId = resolvedDeviceId;
  profile.currentStatus = ActivityState.ACTIVE;
  profile.currentApplication = '';
  profile.currentExecutable = '';
  profile.currentWebsiteDomain = '';
  profile.currentAppStartedAt = now;
  profile.lastActiveAt = now;
  profile.lastHeartbeatAt = now;
  await profile.save();

  try {
    const company = await Company.findById(companyId);
    const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
    const todayStr = getDateStringInTimezone(now, companyTz);
    await rebuildEmployeeDay(companyId, profile._id.toString(), todayStr);
  } catch (rebuildErr) {
    console.error('[SessionService] Rebuild error on session start:', rebuildErr);
  }

  emitToCompany(companyId, 'employee:session_started', {
    companyId,
    employeeId: profile._id.toString(),
    sessionId: session._id.toString(),
    startedAt: now.toISOString()
  });

  emitToCompany(companyId, 'employee:status_changed', {
    companyId,
    employeeId: profile._id.toString(),
    status: ActivityState.ACTIVE,
    currentApplication: profile.currentApplication,
    lastActiveAt: now.toISOString()
  });

  return session;
};

export const endWorkSession = async (
  companyId: string,
  employeeId: string,
  sessionId?: string,
  endReason = 'User Manual End'
) => {
  const profile = await EmployeeProfile.findOne({ _id: employeeId, companyId });
  if (!profile) {
    throw new AppError('Employee profile not found.', 404);
  }

  const targetSessionId = sessionId || profile.currentSessionId;
  if (!targetSessionId) {
    throw new AppError('No active work session found to end.', 400);
  }

  const session = await AttendanceSession.findOne({
    _id: targetSessionId,
    companyId
  });

  if (!session) {
    throw new AppError('Session not found.', 404);
  }

  const now = new Date();

  // Close any ongoing break in this session
  const ongoingBreak = await Break.findOne({
    sessionId: session._id,
    companyId,
    endedAt: { $exists: false }
  });

  if (ongoingBreak) {
    ongoingBreak.endedAt = now;
    ongoingBreak.durationSeconds = Math.max(0, Math.round((now.getTime() - ongoingBreak.startedAt.getTime()) / 1000));
    await ongoingBreak.save();
    session.breakSeconds = Math.max(0, session.breakSeconds + ongoingBreak.durationSeconds);
  }

  // Authoritative timestamp-based duration and interval reconciliation
  const elapsedSessionSec = Math.max(0, Math.round((now.getTime() - session.startedAt.getTime()) / 1000));
  session.durationSeconds = elapsedSessionSec;

  const [sessionEvents, sessionBreaks] = await Promise.all([
    ActivityEvent.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      sessionId: session._id
    }).lean(),
    Break.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      sessionId: session._id
    }).lean()
  ]);

  const evActive = sessionEvents
    .filter((e: any) => e.type !== ActivityEventType.IDLE_INTERVAL)
    .reduce((sum: number, e: any) => sum + (e.durationSeconds || 0), 0);
  const evIdle = sessionEvents
    .filter((e: any) => e.type === ActivityEventType.IDLE_INTERVAL)
    .reduce((sum: number, e: any) => sum + (e.durationSeconds || 0), 0);
  const brkTotal = sessionBreaks
    .reduce((sum: number, b: any) => sum + (b.durationSeconds || 0), 0);

  let finalActive = Math.max(evActive, session.activeSeconds || 0);
  let finalIdle = Math.max(evIdle, session.idleSeconds || 0);
  let finalBreak = Math.max(brkTotal, session.breakSeconds || 0);

  const recordedSum = finalActive + finalIdle + finalBreak;
  const gap = Math.max(0, elapsedSessionSec - recordedSum);
  if (gap > 0) {
    if (profile.currentStatus === ActivityState.IDLE) {
      finalIdle += gap;
    } else if (profile.currentStatus === ActivityState.BREAK) {
      finalBreak += gap;
    } else {
      finalActive += gap;
    }
  }

  session.activeSeconds = finalActive;
  session.idleSeconds = finalIdle;
  session.breakSeconds = finalBreak;
  session.endedAt = now;
  session.status = SessionStatus.COMPLETED;
  session.endReason = endReason;
  session.lastHeartbeatAt = now;
  await session.save();

  // Clear current session on profile
  await EmployeeProfile.updateOne(
    { _id: profile._id },
    {
      $unset: { currentSessionId: 1, currentAppStartedAt: 1 },
      $set: {
        currentStatus: ActivityState.OFFLINE,
        currentApplication: '',
        currentExecutable: '',
        currentWebsiteDomain: ''
      }
    }
  );

  try {
    const company = await Company.findById(companyId);
    const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
    const todayStr = getDateStringInTimezone(now, companyTz);
    await rebuildEmployeeDay(companyId, profile._id.toString(), todayStr);
  } catch (rebuildErr) {
    console.error('[SessionService] Rebuild error on session end:', rebuildErr);
  }

  const refreshedProfile = await EmployeeProfile.findById(profile._id);

  emitToCompany(companyId, 'employee:session_ended', {
    companyId,
    employeeId: profile._id.toString(),
    sessionId: session._id.toString(),
    endedAt: now.toISOString(),
    totalActiveSeconds: session.activeSeconds,
    totalIdleSeconds: session.idleSeconds,
    todayActiveSeconds: refreshedProfile?.todayActiveSeconds || 0,
    todayIdleSeconds: refreshedProfile?.todayIdleSeconds || 0,
    todayBreakSeconds: refreshedProfile?.todayBreakSeconds || 0
  });

  emitToCompany(companyId, 'employee:status_changed', {
    companyId,
    employeeId: profile._id.toString(),
    status: ActivityState.OFFLINE,
    currentApplication: '',
    todayActiveSeconds: refreshedProfile?.todayActiveSeconds || 0,
    todayIdleSeconds: refreshedProfile?.todayIdleSeconds || 0,
    todayBreakSeconds: refreshedProfile?.todayBreakSeconds || 0
  });

  return session;
};

export const startBreak = async (
  companyId: string,
  employeeId: string,
  reason: BreakReason | string = BreakReason.OTHER,
  note?: string
) => {
  const profile = await EmployeeProfile.findOne({ _id: employeeId, companyId });
  if (!profile) {
    throw new AppError('Employee profile not found.', 404);
  }

  if (!profile.currentSessionId) {
    throw new AppError('Cannot start break without an active work session.', 400);
  }

  // Check if already on break - return existing for idempotency
  const existingBreak = await Break.findOne({
    companyId,
    employeeId,
    sessionId: profile.currentSessionId,
    endedAt: { $exists: false }
  });

  if (existingBreak) {
    return existingBreak;
  }

  const now = new Date();
  const breakRecord = await Break.create({
    companyId: new mongoose.Types.ObjectId(companyId),
    employeeId: new mongoose.Types.ObjectId(employeeId),
    sessionId: profile.currentSessionId,
    startedAt: now,
    reason,
    note
  });

  profile.currentStatus = ActivityState.BREAK;
  await profile.save();

  emitToCompany(companyId, 'employee:break_started', {
    companyId,
    employeeId: profile._id.toString(),
    breakId: breakRecord._id.toString(),
    reason: breakRecord.reason,
    startedAt: now.toISOString()
  });

  emitToCompany(companyId, 'employee:status_changed', {
    companyId,
    employeeId: profile._id.toString(),
    status: ActivityState.BREAK,
    currentApplication: 'On Break',
    todayActiveSeconds: profile.todayActiveSeconds,
    todayIdleSeconds: profile.todayIdleSeconds,
    todayBreakSeconds: profile.todayBreakSeconds
  });

  return breakRecord;
};

export const endBreak = async (
  companyId: string,
  employeeId: string,
  breakId?: string
) => {
  const profile = await EmployeeProfile.findOne({ _id: employeeId, companyId });
  if (!profile) {
    throw new AppError('Employee profile not found.', 404);
  }

  const query: any = {
    companyId,
    employeeId,
    endedAt: { $exists: false }
  };
  if (breakId) query._id = breakId;

  const breakRecord = await Break.findOne(query);
  if (!breakRecord) {
    throw new AppError('No ongoing break found to end.', 400);
  }

  const now = new Date();
  breakRecord.endedAt = now;
  breakRecord.durationSeconds = Math.max(0, Math.round((now.getTime() - breakRecord.startedAt.getTime()) / 1000));
  await breakRecord.save();

  // Accumulate to today's break total and session break total
  profile.todayBreakSeconds = (profile.todayBreakSeconds || 0) + breakRecord.durationSeconds;
  profile.currentStatus = ActivityState.ACTIVE;
  profile.lastActiveAt = now;
  await profile.save();

  if (profile.currentSessionId) {
    await AttendanceSession.updateOne(
      { _id: profile.currentSessionId, companyId },
      { $inc: { breakSeconds: breakRecord.durationSeconds } }
    );
  }

  emitToCompany(companyId, 'employee:break_ended', {
    companyId,
    employeeId: profile._id.toString(),
    breakId: breakRecord._id.toString(),
    durationSeconds: breakRecord.durationSeconds,
    endedAt: now.toISOString()
  });

  emitToCompany(companyId, 'employee:status_changed', {
    companyId,
    employeeId: profile._id.toString(),
    status: ActivityState.ACTIVE,
    currentApplication: profile.currentApplication,
    todayActiveSeconds: profile.todayActiveSeconds,
    todayIdleSeconds: profile.todayIdleSeconds,
    todayBreakSeconds: profile.todayBreakSeconds
  });

  return breakRecord;
};
