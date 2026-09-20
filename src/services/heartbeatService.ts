import mongoose from 'mongoose';
import { ActivityState } from '../shared';
import { EmployeeProfile, IEmployeeProfileDocument } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Device } from '../models/Device';
import { Company } from '../models/Company';
import { emitToCompany } from '../realtime/socketManager';

export interface HeartbeatParams {
  companyId: string;
  employeeId: string;
  deviceId?: string;
  sessionId?: string;
  timestamp: string;
  status: ActivityState;
  currentApplication?: string;
  idleSeconds: number;
  recentDurationSeconds?: number;
  ipAddress?: string;
}

export const processHeartbeat = async (params: HeartbeatParams) => {
  const {
    companyId,
    employeeId,
    deviceId,
    sessionId,
    timestamp,
    status,
    currentApplication,
    idleSeconds,
    recentDurationSeconds = 0,
    ipAddress
  } = params;

  const now = new Date(timestamp || Date.now());
  const todayStr = now.toISOString().slice(0, 10);

  const profile = await EmployeeProfile.findOne({
    _id: employeeId,
    companyId
  });

  if (!profile) {
    return { success: false, message: 'Employee profile not found' };
  }

  // Handle midnight date reset for daily live counters
  if (profile.lastDateReset !== todayStr) {
    profile.todayActiveSeconds = 0;
    profile.todayIdleSeconds = 0;
    profile.todayBreakSeconds = 0;
    profile.lastDateReset = todayStr;
  }

  const previousStatus = profile.currentStatus;
  const previousApp = profile.currentApplication;

  profile.currentStatus = status;
  profile.currentApplication = currentApplication || profile.currentApplication;
  profile.lastHeartbeatAt = now;

  if (status === ActivityState.ACTIVE) {
    profile.lastActiveAt = now;
    profile.todayActiveSeconds += recentDurationSeconds;
  } else if (status === ActivityState.IDLE) {
    profile.todayIdleSeconds += recentDurationSeconds;
  } else if (status === ActivityState.BREAK) {
    profile.todayBreakSeconds += recentDurationSeconds;
  }

  if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
    profile.currentSessionId = new mongoose.Types.ObjectId(sessionId);
    // Update active attendance session counters
    if (recentDurationSeconds > 0) {
      const updateFields: any = {};
      if (status === ActivityState.ACTIVE) updateFields.activeSeconds = recentDurationSeconds;
      if (status === ActivityState.IDLE) updateFields.idleSeconds = recentDurationSeconds;
      if (status === ActivityState.BREAK) updateFields.breakSeconds = recentDurationSeconds;

      await AttendanceSession.updateOne(
        { _id: sessionId, companyId },
        { $inc: updateFields }
      );
    }
  }

  await profile.save();

  // Update Device heartbeat timestamp
  if (deviceId) {
    await Device.updateOne(
      { companyId, deviceId },
      {
        $set: {
          lastHeartbeatAt: now,
          ...(ipAddress && { lastIpAddress: ipAddress })
        }
      }
    );
  }

  // Real-time broadcast if status or application changed
  if (previousStatus !== status || previousApp !== currentApplication) {
    emitToCompany(companyId, 'employee:status_changed', {
      companyId,
      employeeId: profile._id.toString(),
      status: profile.currentStatus,
      currentApplication: profile.currentApplication,
      lastActiveAt: profile.lastActiveAt?.toISOString(),
      todayActiveSeconds: profile.todayActiveSeconds,
      todayIdleSeconds: profile.todayIdleSeconds,
      todayBreakSeconds: profile.todayBreakSeconds
    });
  }

  return {
    success: true,
    serverTime: now.toISOString(),
    status: profile.currentStatus
  };
};
