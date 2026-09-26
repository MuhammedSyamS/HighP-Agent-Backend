import mongoose from 'mongoose';
import { ActivityState, ActivityEventType } from '../shared';
import { EmployeeProfile, IEmployeeProfileDocument } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
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

  // Check desktop priority: if web heartbeat arrives while desktop agent is actively connected (<60s)
  const isDesktop = !!deviceId;
  let isDesktopActive = false;
  if (!isDesktop && profile.currentDeviceId) {
    const recentDesktop = await Device.findOne({
      _id: profile.currentDeviceId,
      companyId,
      lastHeartbeatAt: { $gte: new Date(now.getTime() - 60000) }
    });
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

  // Always update heartbeat timestamp to keep worker online
  profile.lastHeartbeatAt = now;

  if (isDesktop) {
    // Desktop agent is authoritative
    profile.currentStatus = status;
    if (isValidApp) {
      profile.currentApplication = cleanApp;
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
    // Web Presence
    if (!isDesktopActive) {
      profile.currentStatus = status;
      if (isValidApp) {
        profile.currentApplication = cleanApp;
      }
      if (status === ActivityState.ACTIVE) {
        profile.lastActiveAt = now;
      }
    }
  }

  // Increment live work statistics based on duration
  const durationSec = Math.max(0, recentDurationSeconds);
  if (durationSec > 0) {
    if (profile.currentStatus === ActivityState.ACTIVE) {
      profile.todayActiveSeconds = (profile.todayActiveSeconds || 0) + durationSec;
    } else if (profile.currentStatus === ActivityState.IDLE) {
      profile.todayIdleSeconds = (profile.todayIdleSeconds || 0) + durationSec;
    } else if (profile.currentStatus === ActivityState.BREAK) {
      profile.todayBreakSeconds = (profile.todayBreakSeconds || 0) + durationSec;
    }
  }

  // Maintain active session linkage
  const effectiveSessionId = sessionId || (profile.currentSessionId ? profile.currentSessionId.toString() : undefined);
  if (effectiveSessionId && mongoose.Types.ObjectId.isValid(effectiveSessionId)) {
    profile.currentSessionId = new mongoose.Types.ObjectId(effectiveSessionId);
    if (durationSec > 0) {
      await AttendanceSession.updateOne(
        { _id: profile.currentSessionId, companyId },
        {
          $set: { lastHeartbeatAt: now },
          $inc: {
            ...(profile.currentStatus === ActivityState.ACTIVE && { activeSeconds: durationSec }),
            ...(profile.currentStatus === ActivityState.IDLE && { idleSeconds: durationSec }),
            ...(profile.currentStatus === ActivityState.BREAK && { breakSeconds: durationSec })
          }
        }
      );
    }
  }

  await profile.save();

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
        activeSeconds: durationSec > 0 ? durationSec : 0
      });
    }
    profile.currentSessionId = activeSession._id as mongoose.Types.ObjectId;
    await profile.save();
  }

  // Create or coalesce real ActivityEvent and ApplicationUsage for live timeline & recent activity feed
  if (isValidApp && profile.currentStatus === ActivityState.ACTIVE && profile.currentSessionId) {
    const effectiveSec = Math.max(1, durationSec);
    try {
      const lastEvent = await ActivityEvent.findOne({
        companyId: new mongoose.Types.ObjectId(companyId),
        employeeId: profile._id,
        sessionId: profile.currentSessionId,
        type: ActivityEventType.APPLICATION_FOCUS
      }).sort({ startedAt: -1 });

      const gapMs = lastEvent ? Math.abs(now.getTime() - lastEvent.endedAt.getTime()) : Infinity;
      if (lastEvent && lastEvent.applicationName.toLowerCase() === cleanApp.toLowerCase() && gapMs <= 120000) {
        lastEvent.endedAt = now;
        lastEvent.durationSeconds += effectiveSec;
        await lastEvent.save();
      } else {
        await ActivityEvent.create({
          eventId: `live-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: profile._id,
          sessionId: profile.currentSessionId,
          ...(profile.currentDeviceId && { deviceId: profile.currentDeviceId }),
          type: ActivityEventType.APPLICATION_FOCUS,
          applicationName: cleanApp,
          windowTitleSanitized: cleanApp,
          startedAt: new Date(now.getTime() - effectiveSec * 1000),
          endedAt: now,
          durationSeconds: effectiveSec
        });
      }

      await ApplicationUsage.findOneAndUpdate(
        {
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: profile._id,
          date: todayStr,
          applicationName: cleanApp
        },
        {
          $inc: { totalSeconds: effectiveSec },
          $set: { lastUsedAt: now }
        },
        { upsert: true }
      );
    } catch (ingestErr) {
      console.warn('[HeartbeatService] Live event coalescing warning:', ingestErr);
    }
  }

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

  if (isValidApp && profile.currentStatus === ActivityState.ACTIVE) {
    emitToCompany(companyId, 'employee:activity_changed', {
      companyId,
      employeeId: profile._id.toString(),
      currentApplication: cleanApp,
      timestamp: now.toISOString()
    });
  }

  return {
    success: true,
    serverTime: now.toISOString(),
    status: profile.currentStatus
  };
};
