import mongoose from 'mongoose';
import { ActivityState } from '../shared';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Device } from '../models/Device';
import { Company } from '../models/Company';
import { emitToCompany } from '../realtime/socketManager';
import { getDateStringInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';
import { liveTelemetryService } from './liveTelemetryService';

export interface HeartbeatParams {
  companyId: string;
  employeeId: string;
  deviceId?: string;
  sessionId?: string;
  timestamp: string;
  status: ActivityState;
  currentApplication?: string;
  executable?: string;
  hwnd?: number | null;
  pid?: number | null;
  startedAt?: string | null;
  activeDurationSeconds?: number;
  idleSeconds: number;
  recentDurationSeconds?: number;
  windowTitle?: string | null;
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
    executable,
    hwnd,
    pid,
    startedAt,
    activeDurationSeconds,
    windowTitle,
    idleSeconds,
    ipAddress
  } = params;

  const now = new Date(timestamp || Date.now());

  const profile = await EmployeeProfile.findOne({
    _id: employeeId,
    companyId
  });

  if (!profile) {
    return { success: false, message: 'Employee profile not found' };
  }

  // Fetch company timezone for midnight reset
  const company = await Company.findById(companyId);
  const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
  const todayStr = getDateStringInTimezone(now, companyTz);

  // Midnight date reset for daily live counters
  if (profile.lastDateReset !== todayStr) {
    profile.todayActiveSeconds = 0;
    profile.todayIdleSeconds = 0;
    profile.todayBreakSeconds = 0;
    profile.lastDateReset = todayStr;
  }

  // Check desktop priority: if web heartbeat arrives while desktop agent is actively connected (<60s)
  const isDesktop = !!deviceId;
  let isDesktopActive = false;
  if (!isDesktop) {
    const devQuery: any = {
      companyId,
      lastHeartbeatAt: { $gte: new Date(now.getTime() - 60000) }
    };
    if (profile.currentDeviceId) {
      devQuery._id = profile.currentDeviceId;
    } else {
      devQuery.employeeId = profile._id;
    }
    const recentDesktop = await Device.findOne(devQuery);
    isDesktopActive = !!recentDesktop;
  }

  const cleanApp = (currentApplication || '').trim();
  const isValidApp =
    cleanApp &&
    !cleanApp.toLowerCase().includes('highp') &&
    !cleanApp.toLowerCase().includes('electron') &&
    !cleanApp.toLowerCase().includes('internal workforce') &&
    !cleanApp.toLowerCase().includes('telemetry') &&
    cleanApp.toLowerCase() !== 'unknown' &&
    cleanApp.toLowerCase() !== 'unknown application';

  // Drop out-of-order heartbeats if an older timestamp arrives
  if (profile.lastHeartbeatAt && now < profile.lastHeartbeatAt) {
    return {
      success: true,
      serverTime: now.toISOString(),
      status: profile.currentStatus,
      stale: true
    };
  }

  // Always update heartbeat timestamp to keep worker online
  profile.lastHeartbeatAt = now;

  if (isDesktop) {
    // Desktop agent is authoritative
    profile.currentStatus = status;
    if (isValidApp) {
      if (profile.currentApplication !== cleanApp) {
        profile.currentAppStartedAt = startedAt ? new Date(startedAt) : now;
      } else if (!profile.currentAppStartedAt) {
        profile.currentAppStartedAt = startedAt ? new Date(startedAt) : now;
      }
      profile.currentApplication = cleanApp;
      profile.currentExecutable = executable || profile.currentExecutable || '';
    } else if (status !== ActivityState.ACTIVE) {
      profile.currentApplication = '';
      profile.currentExecutable = '';
      profile.currentAppStartedAt = undefined;
    } else {
      // Active but unknown or empty app: clear stale application identity
      profile.currentApplication = cleanApp || '';
      profile.currentExecutable = executable || '';
      profile.currentAppStartedAt = undefined;
    }

    if (status === ActivityState.ACTIVE) {
      profile.lastActiveAt = now;
    }

    // Link device if not linked yet
    if (!profile.currentDeviceId && deviceId) {
      const devDoc = await Device.findOne({ companyId, deviceId });
      if (devDoc) profile.currentDeviceId = devDoc._id as mongoose.Types.ObjectId;
    }
  } else {
    // Web Presence: Only update if no desktop agent has reported recently
    if (!isDesktopActive) {
      profile.currentStatus = status;
      if (isValidApp) {
        if (profile.currentApplication !== cleanApp) {
          profile.currentAppStartedAt = startedAt ? new Date(startedAt) : now;
        } else if (!profile.currentAppStartedAt) {
          profile.currentAppStartedAt = startedAt ? new Date(startedAt) : now;
        }
        profile.currentApplication = cleanApp;
        profile.currentExecutable = executable || profile.currentExecutable || '';
      } else if (status !== ActivityState.ACTIVE) {
        profile.currentApplication = '';
        profile.currentExecutable = '';
        profile.currentAppStartedAt = undefined;
      } else {
        profile.currentApplication = cleanApp || '';
        profile.currentExecutable = executable || '';
        profile.currentAppStartedAt = undefined;
      }
      if (status === ActivityState.ACTIVE) {
        profile.lastActiveAt = now;
      }
    }
  }

  // Maintain active session linkage
  const effectiveSessionId = sessionId || (profile.currentSessionId ? profile.currentSessionId.toString() : undefined);
  if (effectiveSessionId && mongoose.Types.ObjectId.isValid(effectiveSessionId)) {
    profile.currentSessionId = new mongoose.Types.ObjectId(effectiveSessionId);
    await AttendanceSession.updateOne(
      { _id: profile.currentSessionId, companyId },
      { $set: { lastHeartbeatAt: now } }
    );
  }

  // Ensure active session linkage if employee is actively working
  if (profile.currentStatus === ActivityState.ACTIVE && !profile.currentSessionId) {
    let activeSession = await AttendanceSession.findOne({
      companyId,
      employeeId: profile._id,
      endedAt: { $exists: false }
    }).sort({ startedAt: -1 });

    if (!activeSession) {
      activeSession = await AttendanceSession.create({
        companyId,
        employeeId: profile._id,
        startedAt: now,
        lastHeartbeatAt: now,
        source: isDesktop ? 'DESKTOP' : 'WEB',
        activeSeconds: 0,
        idleSeconds: 0,
        breakSeconds: 0
      });
    }
    profile.currentSessionId = activeSession._id as mongoose.Types.ObjectId;
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

  // Update In-Memory Live Telemetry State and Broadcast
  const effectiveApp = profile.currentStatus === ActivityState.ACTIVE ? profile.currentApplication || null : null;
  const effectiveStartedAt = profile.currentAppStartedAt ? profile.currentAppStartedAt.toISOString() : (startedAt || null);
  const effectiveDuration = activeDurationSeconds != null
    ? activeDurationSeconds
    : profile.currentAppStartedAt
    ? Math.max(0, Math.round((now.getTime() - profile.currentAppStartedAt.getTime()) / 1000))
    : 0;

  console.log(`[BACKEND]\napplication=${effectiveApp}`);
  console.log(`[SOCKET]\napplication=${effectiveApp}`);

  liveTelemetryService.setLiveTelemetry({
    employeeProfileId: profile._id.toString(),
    companyId: companyId.toString(),
    hwnd: hwnd != null ? Number(hwnd) : null,
    pid: pid != null ? Number(pid) : null,
    executable: profile.currentExecutable || executable || null,
    application: effectiveApp,
    windowTitle: windowTitle || null,
    startedAt: effectiveStartedAt,
    lastSeenAt: now.toISOString(),
    activeDurationSeconds: effectiveDuration,
    idleSeconds: Number(idleSeconds) || 0,
    status: (profile.currentStatus || ActivityState.OFFLINE).toLowerCase() as any
  });

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

  if (isValidApp && profile.currentStatus === ActivityState.ACTIVE) {
    emitToCompany(companyId, 'employee:activity_changed', {
      companyId,
      employeeId: profile._id.toString(),
      currentApplication: cleanApp,
      startedAt: effectiveStartedAt,
      durationSeconds: effectiveDuration,
      timestamp: now.toISOString()
    });
  }

  return {
    success: true,
    serverTime: now.toISOString(),
    status: profile.currentStatus
  };
};
