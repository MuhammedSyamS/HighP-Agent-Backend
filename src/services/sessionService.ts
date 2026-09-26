import mongoose from 'mongoose';
import { SessionStatus, ActivityState, BreakReason } from '../shared';
import { AttendanceSession, IAttendanceSessionDocument } from '../models/AttendanceSession';
import { Break, IBreakDocument } from '../models/Break';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { Device } from '../models/Device';
import { AppError } from '../middleware/errorHandler';
import { emitToCompany, emitToEmployee } from '../realtime/socketManager';

export const startWorkSession = async (
  companyId: string,
  employeeId: string,
  deviceId?: string
) => {
  const profile = await EmployeeProfile.findOne({ _id: employeeId, companyId });
  if (!profile) {
    throw new AppError('Employee profile not found.', 404);
  }

  // If already in an active session, return current session
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

  let resolvedDeviceId: mongoose.Types.ObjectId | undefined;
  if (deviceId) {
    if (typeof deviceId === 'string' && /^[0-9a-fA-F]{24}$/.test(deviceId)) {
      resolvedDeviceId = new mongoose.Types.ObjectId(deviceId);
    } else {
      const devDoc = await Device.findOne({ companyId, deviceId });
      if (devDoc) resolvedDeviceId = devDoc._id as mongoose.Types.ObjectId;
    }
  }

  const now = new Date();
  const session = await AttendanceSession.create({
    companyId: new mongoose.Types.ObjectId(companyId),
    employeeId: new mongoose.Types.ObjectId(employeeId),
    ...(resolvedDeviceId && { deviceId: resolvedDeviceId }),
    startedAt: now,
    status: SessionStatus.ACTIVE
  });

  profile.currentSessionId = session._id;
  if (resolvedDeviceId) profile.currentDeviceId = resolvedDeviceId;
  profile.currentStatus = ActivityState.ACTIVE;
  profile.lastActiveAt = now;
  profile.lastHeartbeatAt = now;
  await profile.save();

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
    session.breakSeconds += ongoingBreak.durationSeconds;
  }

  session.endedAt = now;
  session.status = SessionStatus.COMPLETED;
  session.endReason = endReason;
  await session.save();

  profile.currentSessionId = undefined;
  profile.currentStatus = ActivityState.OFFLINE;
  profile.currentApplication = '';
  await profile.save();

  emitToCompany(companyId, 'employee:session_ended', {
    companyId,
    employeeId: profile._id.toString(),
    sessionId: session._id.toString(),
    endedAt: now.toISOString(),
    totalActiveSeconds: session.activeSeconds,
    totalIdleSeconds: session.idleSeconds
  });

  emitToCompany(companyId, 'employee:status_changed', {
    companyId,
    employeeId: profile._id.toString(),
    status: ActivityState.OFFLINE,
    currentApplication: ''
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

  // Check if already on break
  const existingBreak = await Break.findOne({
    companyId,
    employeeId,
    sessionId: profile.currentSessionId,
    endedAt: { $exists: false }
  });

  if (existingBreak) {
    throw new AppError('A break is already in progress.', 400);
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
    currentApplication: 'On Break'
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
  profile.todayBreakSeconds += breakRecord.durationSeconds;
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
    currentApplication: profile.currentApplication
  });

  return breakRecord;
};
