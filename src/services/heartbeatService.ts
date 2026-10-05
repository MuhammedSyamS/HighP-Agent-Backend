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
  totalActiveSeconds?: number;
  totalIdleSeconds?: number;
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

  // 1. Session Active Guard: Verify if employee has an active session
  let activeSession: any = null;
  const targetSessionId = sessionId || (profile.currentSessionId ? profile.currentSessionId.toString() : undefined);
  if (targetSessionId && mongoose.Types.ObjectId.isValid(targetSessionId)) {
    activeSession = await AttendanceSession.findOne({
      _id: new mongoose.Types.ObjectId(targetSessionId),
      companyId: new mongoose.Types.ObjectId(companyId)
    });
  }

  // If the target session is completed or ended, or if profile is OFFLINE without any active session:
  const isSessionEnded =
    (!activeSession || activeSession.status === SessionStatus.COMPLETED || activeSession.endedAt != null) &&
    (!profile.currentSessionId || profile.currentStatus === ActivityState.OFFLINE);

  if (isSessionEnded) {
    if (status !== ActivityState.OFFLINE) {
      profile.currentSessionId = undefined;
      profile.currentStatus = ActivityState.OFFLINE;
      profile.currentApplication = '';
      profile.currentExecutable = '';
      profile.currentWebsiteDomain = '';
      profile.currentAppStartedAt = undefined;
      await profile.save();

      return {
        success: true,
        serverTime: now.toISOString(),
        status: ActivityState.OFFLINE,
        sessionEnded: true,
        message: 'Work session has ended. Telemetry tracking stopped.'
      };
    }
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

  const idleThresholdSec = Math.max(30, (company?.config?.idleThresholdMinutes || 1) * 60);
  const isPhysicallyIdle = idleSeconds >= idleThresholdSec;
  const effectiveStatus = status === ActivityState.IDLE || isPhysicallyIdle
    ? ActivityState.IDLE
    : status;

  console.log(`[BACKEND_HEARTBEAT] employee=${employeeId} application=${cleanApp || 'None'} website=${website?.domain || 'None'} status=${effectiveStatus} idleSec=${idleSeconds}`);

  const wasActive = profile.currentStatus === ActivityState.ACTIVE;

  if (isDesktop) {
    // Desktop agent is authoritative
    profile.currentStatus = effectiveStatus;

    if (effectiveStatus === ActivityState.ACTIVE) {
      if (isValidApp) {
        if (!wasActive || profile.currentApplication !== cleanApp || !profile.currentAppStartedAt) {
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

      // If transitioning from ACTIVE to IDLE, retroactively reallocate initial idle period
      if (wasActive && effectiveStatus === ActivityState.IDLE && params.totalActiveSeconds == null) {
        const sessActive = Math.max(0, activeSession?.activeSeconds || 0);
        const retroSec = Math.min(sessActive, Math.max(0, idleSeconds));
        if (retroSec > 0) {
          profile.todayActiveSeconds = Math.max(0, (profile.todayActiveSeconds || 0) - retroSec);
          profile.todayIdleSeconds = (profile.todayIdleSeconds || 0) + retroSec;
          if (profile.currentSessionId) {
            await AttendanceSession.updateOne(
              { _id: profile.currentSessionId, companyId: new mongoose.Types.ObjectId(companyId) },
              { $inc: { activeSeconds: -retroSec, idleSeconds: retroSec } }
            );
          }
        }
      }
    }

    // Link device if not linked yet
    if (!profile.currentDeviceId && deviceId) {
      const devDoc = await Device.findOne({ companyId, deviceId });
      if (devDoc) profile.currentDeviceId = devDoc._id as mongoose.Types.ObjectId;
    }
  } else {
    // Web Presence: Only update if no desktop agent has reported recently
    if (!isDesktopActive) {
      profile.currentStatus = effectiveStatus;

      if (effectiveStatus === ActivityState.ACTIVE) {
        if (isValidApp) {
          if (!wasActive || profile.currentApplication !== cleanApp || !profile.currentAppStartedAt) {
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

        if (wasActive && effectiveStatus === ActivityState.IDLE && params.totalActiveSeconds == null) {
          const sessActive = Math.max(0, activeSession?.activeSeconds || 0);
          const retroSec = Math.min(sessActive, Math.max(0, idleSeconds));
          if (retroSec > 0) {
            profile.todayActiveSeconds = Math.max(0, (profile.todayActiveSeconds || 0) - retroSec);
            profile.todayIdleSeconds = (profile.todayIdleSeconds || 0) + retroSec;
            if (profile.currentSessionId) {
              await AttendanceSession.updateOne(
                { _id: profile.currentSessionId, companyId: new mongoose.Types.ObjectId(companyId) },
                { $inc: { activeSeconds: -retroSec, idleSeconds: retroSec } }
              );
            }
          }
        }
      }
    }
  }

  // Maintain active session linkage ONLY if the session is genuinely active
  if (activeSession && activeSession.status === SessionStatus.ACTIVE && !activeSession.endedAt) {
    profile.currentSessionId = activeSession._id as mongoose.Types.ObjectId;
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

    // Synchronize Live Active and Idle Counters
    if (params.totalActiveSeconds != null && params.totalIdleSeconds != null) {
      let sessActive = Math.max(0, params.totalActiveSeconds);
      let sessIdle = Math.max(0, params.totalIdleSeconds);

      if (profile.currentSessionId && activeSession?.startedAt) {
        // Authoritative accounting constraint: active + idle + break cannot exceed elapsed shift duration
        const elapsedSessionSec = Math.max(0, Math.round((now.getTime() - new Date(activeSession.startedAt).getTime()) / 1000));
        const sessBreak = Math.max(0, activeSession.breakSeconds || 0);
        const maxAllowedIdle = Math.max(0, elapsedSessionSec - sessActive - sessBreak + 30);
        sessIdle = Math.min(sessIdle, maxAllowedIdle);

        await AttendanceSession.updateOne(
          { _id: profile.currentSessionId, companyId: new mongoose.Types.ObjectId(companyId) },
          {
            $set: {
              activeSeconds: sessActive,
              idleSeconds: sessIdle,
              lastHeartbeatAt: now
            }
          }
        );

        // Calculate cumulative day totals across all completed sessions today + current session
        const todayRange = getDayRangeInTimezone(todayStr, companyTz);
        const priorSessions = await AttendanceSession.find({
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: profile._id,
          _id: { $ne: profile.currentSessionId },
          startedAt: { $gte: todayRange.start, $lte: todayRange.end },
          status: SessionStatus.COMPLETED
        }).lean();

        const priorActive = priorSessions.reduce((sum, s) => sum + Math.max(0, s.activeSeconds || 0), 0);
        const priorIdle = priorSessions.reduce((sum, s) => sum + Math.max(0, s.idleSeconds || 0), 0);

        profile.todayActiveSeconds = priorActive + sessActive;
        profile.todayIdleSeconds = priorIdle + sessIdle;
      } else {
        profile.todayActiveSeconds = Math.max(profile.todayActiveSeconds || 0, sessActive);
        profile.todayIdleSeconds = Math.max(profile.todayIdleSeconds || 0, sessIdle);
      }
      await profile.save();
    } else if (params.recentDurationSeconds != null && params.recentDurationSeconds > 0) {
      // Fallback delta calculation for agents explicitly transmitting interval durations
      const delta = params.recentDurationSeconds;
      if (profile.currentStatus === ActivityState.IDLE) {
        if (!wasActive) {
          profile.todayIdleSeconds = (profile.todayIdleSeconds || 0) + delta;
          await profile.save();
          if (profile.currentSessionId) {
            await AttendanceSession.updateOne(
              { _id: profile.currentSessionId, companyId: new mongoose.Types.ObjectId(companyId) },
              { $inc: { idleSeconds: delta }, $set: { lastHeartbeatAt: now } }
            );
          }
        }
      } else if (profile.currentStatus === ActivityState.ACTIVE) {
        profile.todayActiveSeconds = (profile.todayActiveSeconds || 0) + delta;
        await profile.save();
        if (profile.currentSessionId) {
          await AttendanceSession.updateOne(
            { _id: profile.currentSessionId, companyId: new mongoose.Types.ObjectId(companyId) },
            { $inc: { activeSeconds: delta }, $set: { lastHeartbeatAt: now } }
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
    application: profile.currentStatus === ActivityState.IDLE ? 'System Idle' : effectiveApp,
    windowTitle: profile.currentStatus === ActivityState.IDLE ? 'System Idle' : (windowTitle || null),
    startedAt: effectiveStartedAt,
    lastSeenAt: now.toISOString(),
    activeDurationSeconds: profile.currentStatus === ActivityState.IDLE ? 0 : effectiveDuration,
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
