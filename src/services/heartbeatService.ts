import mongoose from 'mongoose';
import { ActivityState, ActivityEventType, SessionStatus } from '../shared';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Device } from '../models/Device';
import { Company } from '../models/Company';
import { TrackedApplication } from '../models/TrackedApplication';
import { DiscoveredApplication } from '../models/DiscoveredApplication';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { Break } from '../models/Break';
import { emitToCompany } from '../realtime/socketManager';
import { getDateStringInTimezone, getDayRangeInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';
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
  website?: { domain?: string } | null;
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
    website,
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

  let cleanApp = (currentApplication || '').trim();
  const exeLower = (executable || '').trim().toLowerCase();

  // Query Application Registry to check tracking state
  let trackedDoc = null;
  if (cleanApp || exeLower) {
    trackedDoc = await TrackedApplication.findOne({
      companyId: new mongoose.Types.ObjectId(companyId),
      $or: [
        { name: new RegExp(`^${cleanApp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        { executableNames: exeLower }
      ]
    }).lean();
  }

  const trackingState: 'TRACKED' | 'IGNORED' | 'UNKNOWN' = trackedDoc
    ? (trackedDoc.tracked && !trackedDoc.ignored ? 'TRACKED' : 'IGNORED')
    : 'UNKNOWN';

  const isTracked = trackingState === 'TRACKED';

  // If application is unknown and not system, record in DiscoveredApplication
  if (!trackedDoc && exeLower && exeLower.endsWith('.exe') && !cleanApp.toLowerCase().includes('highp')) {
    DiscoveredApplication.findOneAndUpdate(
      { companyId: new mongoose.Types.ObjectId(companyId), executableName: exeLower },
      {
        $setOnInsert: {
          companyId: new mongoose.Types.ObjectId(companyId),
          executableName: exeLower,
          executablePath: '',
          windowTitle: cleanApp || exeLower,
          status: 'DISCOVERED',
          firstSeenAt: now
        },
        $set: { lastSeenAt: now }
      },
      { upsert: true }
    ).catch(() => {});
  }

  const isValidApp =
    cleanApp &&
    !cleanApp.toLowerCase().includes('highp') &&
    !cleanApp.toLowerCase().includes('electron') &&
    !cleanApp.toLowerCase().includes('internal workforce') &&
    !cleanApp.toLowerCase().includes('telemetry');

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

  console.log(`[BACKEND_HEARTBEAT] employee=${employeeId} application=${cleanApp || 'None'} website=${website?.domain || 'None'} status=${status}`);

  if (isDesktop) {
    // Desktop agent is authoritative
    const wasNotActive = profile.currentStatus !== ActivityState.ACTIVE;
    profile.currentStatus = status;

    if (status === ActivityState.ACTIVE) {
      if (isValidApp) {
        if (wasNotActive || profile.currentApplication !== cleanApp || !profile.currentAppStartedAt) {
          profile.currentAppStartedAt = startedAt ? new Date(startedAt) : now;
        }
        profile.currentApplication = cleanApp;
        profile.currentExecutable = executable || profile.currentExecutable || '';
      } else {
        profile.currentApplication = cleanApp || '';
        profile.currentExecutable = executable || '';
        if (!cleanApp) {
          profile.currentAppStartedAt = undefined;
        }
      }
      profile.lastActiveAt = now;
      if (website && website.domain) {
        profile.currentWebsiteDomain = website.domain;
      } else {
        profile.currentWebsiteDomain = '';
      }
    } else {
      // Status is IDLE, BREAK, or OFFLINE: clear active application and focus start time
      profile.currentApplication = '';
      profile.currentExecutable = '';
      profile.currentAppStartedAt = undefined;
      profile.currentWebsiteDomain = '';
    }

    // Link device if not linked yet
    if (!profile.currentDeviceId && deviceId) {
      const devDoc = await Device.findOne({ companyId, deviceId });
      if (devDoc) profile.currentDeviceId = devDoc._id as mongoose.Types.ObjectId;
    }
  } else {
    // Web Presence: Only update if no desktop agent has reported recently
    if (!isDesktopActive) {
      const wasNotActive = profile.currentStatus !== ActivityState.ACTIVE;
      profile.currentStatus = status;

      if (status === ActivityState.ACTIVE) {
        if (isValidApp) {
          if (wasNotActive || profile.currentApplication !== cleanApp || !profile.currentAppStartedAt) {
            profile.currentAppStartedAt = startedAt ? new Date(startedAt) : now;
          }
          profile.currentApplication = cleanApp;
          profile.currentExecutable = executable || profile.currentExecutable || '';
        } else {
          profile.currentApplication = cleanApp || '';
          profile.currentExecutable = executable || '';
          if (!cleanApp) {
            profile.currentAppStartedAt = undefined;
          }
        }
        profile.lastActiveAt = now;
      } else {
        profile.currentApplication = '';
        profile.currentExecutable = '';
        profile.currentAppStartedAt = undefined;
        profile.currentWebsiteDomain = '';
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

  // Section 7: If employee is working without an active session ID in memory, look up existing open session
  if (profile.currentStatus === ActivityState.ACTIVE && !profile.currentSessionId) {
    const activeSession = await AttendanceSession.findOne({
      companyId,
      employeeId: profile._id,
      status: SessionStatus.ACTIVE,
      endedAt: { $exists: false }
    }).sort({ startedAt: -1 });

    if (!activeSession) {
      console.log('[HEARTBEAT] No active work session for employee:', profile._id.toString());
      // Section 7: DO NOT create a new session automatically! The employee must explicitly start work.
    } else {
      profile.currentSessionId = activeSession._id as mongoose.Types.ObjectId;
      await AttendanceSession.updateOne(
        { _id: activeSession._id, companyId },
        { $set: { lastHeartbeatAt: now } }
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

  // Compute live duration
  const effectiveApp = profile.currentStatus === ActivityState.ACTIVE ? profile.currentApplication || null : null;
  const effectiveStartedAt = profile.currentAppStartedAt ? profile.currentAppStartedAt.toISOString() : (startedAt || null);
  const effectiveDuration = activeDurationSeconds != null
    ? activeDurationSeconds
    : profile.currentAppStartedAt
    ? Math.max(0, Math.round((now.getTime() - profile.currentAppStartedAt.getTime()) / 1000))
    : 0;

  // Persist Live Ongoing Activity Session to MongoDB (guarantees F5 refresh persistence)
  if (isValidApp && isTracked && profile.currentStatus === ActivityState.ACTIVE && profile.currentSessionId) {
    const appStart = profile.currentAppStartedAt ? new Date(profile.currentAppStartedAt) : now;
    const durSeconds = Math.max(1, effectiveDuration);

    try {
      // Find or update the ongoing ACTIVE event for this specific app session
      const ongoingEvent = await ActivityEvent.findOne({
        companyId: new mongoose.Types.ObjectId(companyId),
        employeeId: profile._id,
        sessionId: profile.currentSessionId,
        applicationName: cleanApp,
        status: 'ACTIVE'
      }).sort({ startedAt: -1 });

      if (ongoingEvent) {
        ongoingEvent.lastSeenAt = now;
        ongoingEvent.endedAt = now;
        ongoingEvent.durationSeconds = Math.max(ongoingEvent.durationSeconds, durSeconds);
        if (trackedDoc?._id) ongoingEvent.applicationId = trackedDoc._id as mongoose.Types.ObjectId;
        if (trackedDoc?.category) ongoingEvent.category = trackedDoc.category;
        if (pid) ongoingEvent.processId = pid;
        await ongoingEvent.save();
      } else {
        // Close other active events for this employee if they switched
        await ActivityEvent.updateMany(
          {
            companyId: new mongoose.Types.ObjectId(companyId),
            employeeId: profile._id,
            status: 'ACTIVE'
          },
          { $set: { status: 'COMPLETED' } }
        );

        const liveEventId = `live-${profile._id}-${cleanApp.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`;
        await ActivityEvent.create({
          eventId: liveEventId,
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: profile._id,
          sessionId: profile.currentSessionId,
          ...(profile.currentDeviceId && { deviceId: profile.currentDeviceId }),
          ...(trackedDoc?._id && { applicationId: trackedDoc._id as mongoose.Types.ObjectId }),
          type: ActivityEventType.APPLICATION_FOCUS,
          applicationName: cleanApp,
          processName: profile.currentExecutable || executable || 'unknown.exe',
          category: trackedDoc?.category || 'Other',
          processId: pid || undefined,
          windowTitleSanitized: windowTitle || cleanApp,
          startedAt: appStart,
          lastSeenAt: now,
          endedAt: now,
          durationSeconds: durSeconds,
          status: 'ACTIVE'
        });
      }

      // Persist into ApplicationUsage
      await ApplicationUsage.findOneAndUpdate(
        {
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: profile._id,
          date: todayStr,
          applicationName: cleanApp
        },
        {
          $max: { totalSeconds: durSeconds },
          $set: { category: trackedDoc?.category || 'Other', lastUsedAt: now }
        },
        { upsert: true }
      );
    } catch (persistErr: any) {
      console.warn('[HeartbeatService] Live activity persistence warning:', persistErr.message);
    }
  } else if (profile.currentStatus !== ActivityState.ACTIVE) {
    // If transitioned away from ACTIVE, mark previous ACTIVE events as COMPLETED
    try {
      await ActivityEvent.updateMany(
        {
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: profile._id,
          status: 'ACTIVE'
        },
        { $set: { status: 'COMPLETED' } }
      );
    } catch {}
  }

  // If employee is on BREAK, calculate live break duration from ongoing break record
    if (profile.currentStatus === ActivityState.BREAK) {
      try {
        const ongoingBreak = await Break.findOne({
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: profile._id,
          endedAt: { $exists: false }
        }).sort({ startedAt: -1 });

        if (ongoingBreak && ongoingBreak.startedAt) {
          const ongoingSec = Math.max(0, Math.floor((now.getTime() - new Date(ongoingBreak.startedAt).getTime()) / 1000));
          const todayRange = getDayRangeInTimezone(todayStr, companyTz);
          const completedBreaks = await Break.find({
            companyId: new mongoose.Types.ObjectId(companyId),
            employeeId: profile._id,
            endedAt: { $exists: true, $ne: null },
            startedAt: { $gte: todayRange.start, $lte: todayRange.end }
          }).lean();
          const completedSec = completedBreaks.reduce((sum, b) => sum + (b.durationSeconds || 0), 0);
          profile.todayBreakSeconds = completedSec + ongoingSec;
          await profile.save();
        }
      } catch (err: any) {
        console.warn('[HeartbeatService] Live break calculation warning:', err.message);
      }
    }

    // If employee is IDLE, accumulate delta idle time
    if (profile.currentStatus === ActivityState.IDLE) {
      const deltaIdle = params.recentDurationSeconds || (params.idleSeconds > 0 ? 15 : 0);
      if (deltaIdle > 0) {
        profile.todayIdleSeconds = (profile.todayIdleSeconds || 0) + deltaIdle;
        await profile.save();
        if (profile.currentSessionId) {
          await AttendanceSession.updateOne(
            { _id: profile.currentSessionId, companyId: new mongoose.Types.ObjectId(companyId) },
            { $inc: { idleSeconds: deltaIdle } }
          );
        }
      }
    }

    // If employee is ACTIVE, ensure todayActiveSeconds keeps pace
    if (profile.currentStatus === ActivityState.ACTIVE) {
      const deltaActive = params.recentDurationSeconds || 15;
      if (deltaActive > 0) {
        profile.todayActiveSeconds = (profile.todayActiveSeconds || 0) + deltaActive;
        await profile.save();
        if (profile.currentSessionId) {
          await AttendanceSession.updateOne(
            { _id: profile.currentSessionId, companyId: new mongoose.Types.ObjectId(companyId) },
            { $inc: { activeSeconds: deltaActive } }
          );
        }
      }
    }

  // Update In-Memory Live Telemetry State and Broadcast
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
    currentTrackingState: trackingState,
    currentWebsite: profile.currentWebsiteDomain ? { domain: profile.currentWebsiteDomain } : null,
    executable: profile.currentExecutable,
    lastActiveAt: profile.lastActiveAt?.toISOString(),
    todayActiveSeconds: profile.todayActiveSeconds,
    todayIdleSeconds: profile.todayIdleSeconds,
    todayBreakSeconds: profile.todayBreakSeconds,
    source: isDesktop ? 'DESKTOP' : isDesktopActive ? 'DESKTOP' : 'WEB'
  });

  // Dedicated Section 13 event: agent:current-application with website correlation
  emitToCompany(companyId, 'agent:current-application', {
    companyId,
    employeeId: profile._id.toString(),
    deviceId: deviceId || (profile.currentDeviceId ? profile.currentDeviceId.toString() : ''),
    application: {
      name: profile.currentApplication || 'Desktop',
      executableName: profile.currentExecutable || executable || '',
      category: trackedDoc?.category || 'Other',
      trackingState
    },
    website: profile.currentWebsiteDomain ? { domain: profile.currentWebsiteDomain } : null,
    timestamp: now.toISOString()
  });

  if (isValidApp && profile.currentStatus === ActivityState.ACTIVE) {
    emitToCompany(companyId, 'employee:activity_changed', {
      companyId,
      employeeId: profile._id.toString(),
      currentApplication: profile.currentApplication,
      trackingState,
      website: profile.currentWebsiteDomain ? { domain: profile.currentWebsiteDomain } : null,
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
