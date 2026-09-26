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

  // Check desktop priority: if web heartbeat arrives while desktop agent is actively sending telemetry (<120s),
  // preserve desktop agent as the authoritative workstation activity source.
  const isDesktop = !!deviceId;
  const isDesktopActive =
    !isDesktop &&
    profile.lastHeartbeatAt &&
    now.getTime() - profile.lastHeartbeatAt.getTime() < 120000;

  if (isDesktop) {
    // Desktop agent is authoritative
    profile.currentStatus = status;
    const cleanApp = (currentApplication || '').trim();
    if (
      cleanApp &&
      !cleanApp.toLowerCase().includes('highp') &&
      !cleanApp.toLowerCase().includes('electron') &&
      !cleanApp.toLowerCase().includes('internal workforce')
    ) {
      profile.currentApplication = cleanApp;
    }
    profile.lastHeartbeatAt = now;
    if (status === ActivityState.ACTIVE) {
      profile.lastActiveAt = now;
    }

    // Link device if not linked yet
    if (!profile.currentDeviceId && deviceId) {
      const devDoc = await Device.findOne({ companyId, deviceId });
      if (devDoc) profile.currentDeviceId = devDoc._id as mongoose.Types.ObjectId;
    }
  } else if (!isDesktopActive) {
    // Web presence is allowed only when desktop agent is not actively connected
    profile.currentStatus = status;
    const cleanApp = (currentApplication || '').trim();
    if (
      cleanApp &&
      !cleanApp.toLowerCase().includes('highp') &&
      !cleanApp.toLowerCase().includes('electron') &&
      !cleanApp.toLowerCase().includes('internal workforce')
    ) {
      profile.currentApplication = cleanApp;
    }
    profile.lastHeartbeatAt = now;
    if (status === ActivityState.ACTIVE) {
      profile.lastActiveAt = now;
    }
  } else {
    // Desktop is active; web heartbeat is purely web presence keepalive, ignore app/status override
  }

  if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
    profile.currentSessionId = new mongoose.Types.ObjectId(sessionId);
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

  // Real-time broadcast with authoritative current state
  emitToCompany(companyId, 'employee:status_changed', {
    companyId,
    employeeId: profile._id.toString(),
    status: profile.currentStatus,
    currentApplication: profile.currentApplication,
    lastActiveAt: profile.lastActiveAt?.toISOString(),
    todayActiveSeconds: profile.todayActiveSeconds,
    todayIdleSeconds: profile.todayIdleSeconds,
    todayBreakSeconds: profile.todayBreakSeconds,
    source: isDesktop ? 'DESKTOP' : isDesktopActive ? 'DESKTOP' : 'WEB'
  });

  return {
    success: true,
    serverTime: now.toISOString(),
    status: profile.currentStatus
  };
};
