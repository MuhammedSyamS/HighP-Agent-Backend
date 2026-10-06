import mongoose from 'mongoose';
import { ActivityEventType, ActivityState, SessionStatus } from '../shared';
import { ActivityEvent, IActivityEventDocument } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { WebsiteActivity } from '../models/WebsiteActivity';
import { Company } from '../models/Company';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Device } from '../models/Device';
import { TrackedApplication } from '../models/TrackedApplication';
import { DiscoveredApplication } from '../models/DiscoveredApplication';
import { applicationRegistryService } from './applicationRegistryService';
import { emitToCompany } from '../realtime/socketManager';
import { getDayRangeInTimezone, getDateStringInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';

export interface IngestEventInput {
  eventId: string;
  type: ActivityEventType;
  applicationName: string;
  processName?: string;
  windowTitleSanitized?: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  domain?: string;
}

export const determineCategory = (appName: string, companyCategories: Array<{ name: string; color: string; apps: string[] }>): string => {
  const lowerApp = appName.toLowerCase();
  for (const category of companyCategories) {
    if (category.apps.some((keyword) => lowerApp.includes(keyword.toLowerCase()))) {
      return category.name;
    }
  }
  return 'Other';
};

export const ingestActivityEvents = async (
  companyId: string,
  employeeId: string,
  sessionId: string,
  deviceId: string | undefined,
  events: IngestEventInput[]
) => {
  if (!events || events.length === 0) {
    return { accepted: [], duplicates: [], failed: [], ingestedCount: 0, duplicatesCount: 0 };
  }

  const company = await Company.findById(companyId);
  const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
  const categories = company?.config?.appCategories || [];

  // Resolve device ObjectId if a string identifier was provided
  let resolvedDeviceId: mongoose.Types.ObjectId | undefined;
  if (deviceId) {
    if (typeof deviceId === 'string' && /^[0-9a-fA-F]{24}$/.test(deviceId)) {
      resolvedDeviceId = new mongoose.Types.ObjectId(deviceId);
    } else {
      const dev = await Device.findOne({ companyId, deviceId });
      if (dev) resolvedDeviceId = dev._id as mongoose.Types.ObjectId;
    }
  }

  // Resolve session ObjectId
  let resolvedSessionId: mongoose.Types.ObjectId | undefined;
  if (sessionId && typeof sessionId === 'string' && /^[0-9a-fA-F]{24}$/.test(sessionId)) {
    resolvedSessionId = new mongoose.Types.ObjectId(sessionId);
  } else {
    const profile = await EmployeeProfile.findById(employeeId);
    if (profile?.currentSessionId) {
      resolvedSessionId = profile.currentSessionId;
    } else {
      const activeSession = await AttendanceSession.findOne({
        companyId: new mongoose.Types.ObjectId(companyId),
        employeeId: new mongoose.Types.ObjectId(employeeId),
        status: SessionStatus.ACTIVE
      });
      if (activeSession) {
        resolvedSessionId = activeSession._id as mongoose.Types.ObjectId;
      }
    }
  }

  const accepted: string[] = [];
  const duplicates: string[] = [];
  const failed: Array<{ eventId: string; error: string }> = [];

  // Reconstruct strict chronological and sequential ordering (Requirement 13)
  const orderedEvents = [...events].sort((a: any, b: any) => {
    if (a.sequenceNumber !== undefined && b.sequenceNumber !== undefined && a.sequenceNumber !== b.sequenceNumber) {
      return a.sequenceNumber - b.sequenceNumber;
    }
    const tA = new Date(a.startedAt || a.timestamp).getTime();
    const tB = new Date(b.startedAt || b.timestamp).getTime();
    return tA - tB;
  });

  for (const event of orderedEvents) {
    const started = new Date(event.startedAt);
    const ended = new Date(event.endedAt);
    const dateStr = getDateStringInTimezone(started, companyTz);
    const duration = Math.max(0, event.durationSeconds || Math.round((ended.getTime() - started.getTime()) / 1000));
    const cleanAppName = event.applicationName.trim() || 'Unknown Application';

    try {
      // 1. Idempotency check: verify if eventId already processed for this company
      const existing = await ActivityEvent.findOne({
        companyId: new mongoose.Types.ObjectId(companyId),
        eventId: event.eventId
      });
      if (existing) {
        duplicates.push(event.eventId);
        continue;
      }

      // If still no session, check for today's session first before creating a fallback session
      if (!resolvedSessionId) {
        const { start: dayStart, end: dayEnd } = getDayRangeInTimezone(dateStr, companyTz);
        let todaySession = await AttendanceSession.findOne({
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: new mongoose.Types.ObjectId(employeeId),
          $or: [
            { date: dateStr },
            { startedAt: { $gte: dayStart, $lte: dayEnd } }
          ]
        }).sort({ startedAt: 1 });

        if (!todaySession) {
          todaySession = await AttendanceSession.create({
            companyId: new mongoose.Types.ObjectId(companyId),
            employeeId: new mongoose.Types.ObjectId(employeeId),
            date: dateStr,
            startedAt: started,
            status: SessionStatus.ACTIVE
          });
        }
        resolvedSessionId = todaySession._id as mongoose.Types.ObjectId;
      }

      // Handle idle events directly without requiring TrackedApplication registry match
      const isIdleType =
        event.type === ActivityEventType.IDLE_INTERVAL ||
        event.type === ActivityEventType.IDLE_START ||
        event.type === ActivityEventType.IDLE_END;

      if (isIdleType) {
        await ActivityEvent.create({
          eventId: event.eventId,
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: new mongoose.Types.ObjectId(employeeId),
          sessionId: resolvedSessionId,
          ...(resolvedDeviceId && { deviceId: resolvedDeviceId }),
          sequenceNumber: (event as any).sequenceNumber,
          type: event.type,
          applicationName: 'System Idle',
          processName: 'idle',
          category: 'Other',
          durationMs: (event as any).durationMs,
          clockSource: (event as any).clockSource || 'MONOTONIC',
          wallClockStart: (event as any).wallClockStart ? new Date((event as any).wallClockStart) : started,
          wallClockEnd: (event as any).wallClockEnd ? new Date((event as any).wallClockEnd) : ended,
          startedAt: started,
          endedAt: ended,
          durationSeconds: duration,
          status: 'COMPLETED'
        });

        if (resolvedSessionId && duration > 0) {
          const sess = await AttendanceSession.findById(resolvedSessionId);
          if (sess) {
            const sessEnd = sess.endedAt ? sess.endedAt.getTime() : Date.now();
            const elapsed = Math.max(0, Math.round((sessEnd - sess.startedAt.getTime()) / 1000));
            const currentIdle = Math.max(0, sess.idleSeconds || 0);
            const currentActive = Math.max(0, sess.activeSeconds || 0);
            const currentBreak = Math.max(0, sess.breakSeconds || 0);
            const maxAllowedIdle = Math.max(0, elapsed - currentActive - currentBreak + 30);
            sess.idleSeconds = Math.min(Math.max(currentIdle, currentIdle + duration), maxAllowedIdle);
            await sess.save();
          }
        }

        accepted.push(event.eventId);
        continue;
      }

      // Handle system lifecycle & session audit events directly
      const isLifecycleEvent = [
        ActivityEventType.SESSION_START,
        ActivityEventType.SESSION_END,
        ActivityEventType.LOCK,
        ActivityEventType.UNLOCK,
        ActivityEventType.SLEEP,
        ActivityEventType.RESUME,
        ActivityEventType.HEARTBEAT,
        ActivityEventType.NETWORK_OFFLINE,
        ActivityEventType.NETWORK_ONLINE,
        ActivityEventType.SYSTEM_LOCK
      ].includes(event.type);

      if (isLifecycleEvent) {
        await ActivityEvent.create({
          eventId: event.eventId,
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: new mongoose.Types.ObjectId(employeeId),
          sessionId: resolvedSessionId,
          ...(resolvedDeviceId && { deviceId: resolvedDeviceId }),
          type: event.type,
          applicationName: cleanAppName || 'System Event',
          processName: event.processName || 'system',
          category: 'System',
          startedAt: started,
          endedAt: ended,
          durationSeconds: duration,
          status: 'COMPLETED'
        });

        accepted.push(event.eventId);
        continue;
      }

      // Filter out self-monitoring / internal agent processes only
      const lowerApp = cleanAppName.toLowerCase();
      if (
        lowerApp.includes('highp agent') ||
        lowerApp.includes('internal workforce') ||
        lowerApp.includes('highphaus') ||
        lowerApp === 'electron' ||
        lowerApp === 'electron.exe'
      ) {
        accepted.push(event.eventId);
        continue;
      }

      // Handle dedicated website focus events (WEBSITE_FOCUS_START / WEBSITE_FOCUS_END)
      const isWebsiteEventType =
        event.type === ActivityEventType.WEBSITE_FOCUS_START ||
        event.type === ActivityEventType.WEBSITE_FOCUS_END;

      if (isWebsiteEventType) {
        const domain = (event.domain || '').toLowerCase().trim();
        await ActivityEvent.create({
          eventId: event.eventId,
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: new mongoose.Types.ObjectId(employeeId),
          sessionId: resolvedSessionId,
          ...(resolvedDeviceId && { deviceId: resolvedDeviceId }),
          sequenceNumber: (event as any).sequenceNumber,
          type: event.type,
          applicationName: cleanAppName,
          processName: event.processName,
          category: 'Browsers',
          windowTitleSanitized: event.windowTitleSanitized,
          domain: domain || undefined,
          durationMs: (event as any).durationMs,
          clockSource: (event as any).clockSource || 'MONOTONIC',
          wallClockStart: (event as any).wallClockStart ? new Date((event as any).wallClockStart) : started,
          wallClockEnd: (event as any).wallClockEnd ? new Date((event as any).wallClockEnd) : ended,
          startedAt: started,
          endedAt: ended,
          durationSeconds: duration,
          status: 'COMPLETED'
        });

        if (domain && duration > 0) {
          await WebsiteActivity.findOneAndUpdate(
            {
              companyId: new mongoose.Types.ObjectId(companyId),
              employeeId: new mongoose.Types.ObjectId(employeeId),
              date: dateStr,
              domain
            },
            {
              $inc: { totalSeconds: duration },
              $set: { browser: cleanAppName, lastUsedAt: ended, sessionId: resolvedSessionId }
            },
            { upsert: true, new: true }
          );
        }

        accepted.push(event.eventId);
        continue;
      }

      // 2. Independently verify Application Registry configuration (Security Test Section 23)
      const exeName = (event.processName || '').trim().toLowerCase();
      let trackedDoc = await TrackedApplication.findOne({
        companyId: new mongoose.Types.ObjectId(companyId),
        $or: [
          { name: new RegExp(`^${cleanAppName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          { executableNames: exeName }
        ]
      }).lean();

      if (!trackedDoc) {
        await applicationRegistryService.seedDefaultApplications(companyId);
        trackedDoc = await TrackedApplication.findOne({
          companyId: new mongoose.Types.ObjectId(companyId),
          $or: [
            { name: new RegExp(`^${cleanAppName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            { executableNames: exeName }
          ]
        }).lean();
      }

      if (trackedDoc && (trackedDoc.ignored || !trackedDoc.tracked)) {
        // App is explicitly IGNORED by administrator policy: do not record employee activity
        accepted.push(event.eventId);
        continue;
      }

      // Unknown applications: do NOT discard! Discover and track under 'Other' / UNKNOWN category
      if (!trackedDoc) {
        if (exeName && exeName.endsWith('.exe')) {
          await DiscoveredApplication.findOneAndUpdate(
            { companyId: new mongoose.Types.ObjectId(companyId), executableName: exeName },
            {
              $setOnInsert: {
                companyId: new mongoose.Types.ObjectId(companyId),
                executableName: exeName,
                executablePath: '',
                windowTitle: cleanAppName,
                status: 'DISCOVERED',
                firstSeenAt: started
              },
              $set: { lastSeenAt: ended }
            },
            { upsert: true }
          ).catch(() => {});
        }
      }

      const category = trackedDoc?.category || determineCategory(cleanAppName, categories) || 'Other';

      // Remove any temporary live placeholder event for this session & app to prevent duplicates
      await ActivityEvent.deleteMany({
        companyId: new mongoose.Types.ObjectId(companyId),
        employeeId: new mongoose.Types.ObjectId(employeeId),
        sessionId: resolvedSessionId,
        applicationName: cleanAppName,
        eventId: { $regex: /^live-/ }
      });

      // Check if previous event in the same session is the exact same application and continuous (gap <= 120s)
      const isAppTracking =
        event.type === ActivityEventType.APPLICATION_FOCUS ||
        event.type === ActivityEventType.APP_FOCUS_START ||
        event.type === ActivityEventType.APP_FOCUS_END;

      const lastSessionEvent = await ActivityEvent.findOne({
        companyId: new mongoose.Types.ObjectId(companyId),
        employeeId: new mongoose.Types.ObjectId(employeeId),
        sessionId: resolvedSessionId,
        type: event.type,
        startedAt: { $lte: started }
      }).sort({ startedAt: -1 });

      const isContinuous =
        lastSessionEvent &&
        lastSessionEvent.applicationName.trim().toLowerCase() === cleanAppName.trim().toLowerCase() &&
        started.getTime() >= lastSessionEvent.endedAt.getTime() &&
        (started.getTime() - lastSessionEvent.endedAt.getTime()) <= 120000;

      if (isContinuous) {
        // Coalesce into existing interval: increase its time and extend endedAt
        lastSessionEvent.endedAt = ended > lastSessionEvent.endedAt ? ended : lastSessionEvent.endedAt;
        lastSessionEvent.durationSeconds += duration;
        lastSessionEvent.status = 'COMPLETED';
        if (trackedDoc?._id) lastSessionEvent.applicationId = trackedDoc._id as mongoose.Types.ObjectId;
        if (category) lastSessionEvent.category = category;
        await lastSessionEvent.save();
      } else {
        // Insert new distinct activity interval
        await ActivityEvent.create({
          eventId: event.eventId,
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: new mongoose.Types.ObjectId(employeeId),
          sessionId: resolvedSessionId,
          ...(resolvedDeviceId && { deviceId: resolvedDeviceId }),
          ...(trackedDoc?._id && { applicationId: trackedDoc._id as mongoose.Types.ObjectId }),
          sequenceNumber: (event as any).sequenceNumber,
          type: event.type,
          applicationName: cleanAppName,
          processName: event.processName,
          category,
          windowTitleSanitized: event.windowTitleSanitized,
          domain: event.domain,
          durationMs: (event as any).durationMs,
          clockSource: (event as any).clockSource || 'MONOTONIC',
          wallClockStart: (event as any).wallClockStart ? new Date((event as any).wallClockStart) : started,
          wallClockEnd: (event as any).wallClockEnd ? new Date((event as any).wallClockEnd) : ended,
          startedAt: started,
          endedAt: ended,
          durationSeconds: duration,
          status: 'COMPLETED'
        });
      }

      // 2. Aggregate into Daily Application Usage
      if (isAppTracking && duration > 0) {
        await ApplicationUsage.findOneAndUpdate(
          {
            companyId: new mongoose.Types.ObjectId(companyId),
            employeeId: new mongoose.Types.ObjectId(employeeId),
            date: dateStr,
            applicationName: cleanAppName
          },
          {
            $inc: { totalSeconds: duration },
            $set: { category, lastUsedAt: ended }
          },
          { upsert: true, new: true }
        );

        if (resolvedSessionId) {
          await AttendanceSession.updateOne(
            { _id: resolvedSessionId, companyId: new mongoose.Types.ObjectId(companyId) },
            { $inc: { activeSeconds: duration } }
          );
        }

        // 3. Aggregate into Daily Website Usage if domain is present
        if (event.domain) {
          await WebsiteActivity.findOneAndUpdate(
            {
              companyId: new mongoose.Types.ObjectId(companyId),
              employeeId: new mongoose.Types.ObjectId(employeeId),
              date: dateStr,
              domain: event.domain.toLowerCase().trim()
            },
            {
              $inc: { totalSeconds: duration },
              $set: { browser: cleanAppName, lastUsedAt: ended, sessionId: resolvedSessionId }
            },
            { upsert: true, new: true }
          );
        }
      }

      accepted.push(event.eventId);
    } catch (err: any) {
      if (err.code === 11000) {
        duplicates.push(event.eventId);
      } else {
        console.error('[ActivityService] Error ingesting event:', err);
        failed.push({ eventId: event.eventId, error: err.message || 'Ingestion error' });
      }
    }
  }

  // Cross-batch sequence reconciliation on AttendanceSession (Requirements 2, 3 & 4)
  if (resolvedSessionId) {
    try {
      const sessionDoc = await AttendanceSession.findById(resolvedSessionId);
      if (sessionDoc) {
        let currentLastSeq = sessionDoc.lastSequenceNumber || 0;
        const missingSet = new Set<number>(sessionDoc.missingSequences || []);
        const gapEntries = sessionDoc.sequenceGaps ? [...sessionDoc.sequenceGaps] : [];
        const now = new Date();

        for (const ev of orderedEvents) {
          const seq = (ev as any).sequenceNumber;
          if (typeof seq === 'number' && seq > 0) {
            if (seq > currentLastSeq + 1) {
              // Gaps detected! Sequence numbers between currentLastSeq and seq are missing
              for (let s = currentLastSeq + 1; s < seq; s++) {
                missingSet.add(s);
                const existingGap = gapEntries.find((g) => g.sequenceNumber === s);
                if (!existingGap) {
                  gapEntries.push({
                    sequenceNumber: s,
                    status: 'MISSING',
                    detectedAt: now,
                    reason: `Gap detected between sequence ${currentLastSeq} and ${seq}`
                  });
                }
              }
              currentLastSeq = seq;
            } else if (seq === currentLastSeq + 1) {
              currentLastSeq = seq;
            } else if (seq <= currentLastSeq) {
              // Late arrival or duplicate: if it was in missing sequences, mark resolved
              if (missingSet.has(seq)) {
                missingSet.delete(seq);
                const existingGap = gapEntries.find((g) => g.sequenceNumber === seq);
                if (existingGap && (existingGap.status === 'MISSING' || existingGap.status === 'EXPECTED')) {
                  existingGap.status = 'LATE';
                  existingGap.resolvedAt = now;
                  existingGap.reason = `Late sequence ${seq} successfully reconciled`;
                }
              }
            }
          }
        }

        // If session is terminating or contains SESSION_END, explicitly finalize remaining gaps
        const hasSessionEnd = orderedEvents.some((ev) => ev.type === ActivityEventType.SESSION_END);
        if (hasSessionEnd || sessionDoc.status === SessionStatus.COMPLETED) {
          for (const gap of gapEntries) {
            if (gap.status === 'MISSING' || gap.status === 'EXPECTED') {
              gap.status = 'FINALIZED';
              gap.finalizedAt = now;
              gap.reason = 'Permanently missing sequence gap finalized at session termination';
            }
          }
        }

        sessionDoc.lastSequenceNumber = Math.max(sessionDoc.lastSequenceNumber || 0, currentLastSeq);
        sessionDoc.missingSequences = Array.from(missingSet).sort((a, b) => a - b);
        sessionDoc.sequenceGaps = gapEntries;
        await sessionDoc.save();
      }
    } catch (seqErr) {
      console.warn('[ActivityService] Sequence reconciliation warning:', seqErr);
    }
  }

  // Emit activity:ingested notification so reports/timelines can refresh if needed
  if (accepted.length > 0) {
    emitToCompany(companyId, 'activity:ingested', {
      companyId,
      employeeId,
      count: accepted.length
    });
  }

  // Synchronize derived daily totals if any new events were accepted
  if (accepted.length > 0) {
    try {
      const todayStr = getDateStringInTimezone(new Date(), companyTz);
      const { rebuildEmployeeDay } = await import('./rebuildService');
      await rebuildEmployeeDay(companyId, employeeId, todayStr);
    } catch (rebuildErr) {
      console.warn('[ActivityService] Background day rebuild warning:', rebuildErr);
    }
  }

  return {
    accepted,
    duplicates,
    failed,
    ingestedCount: accepted.length,
    duplicatesCount: duplicates.length
  };
};

export const getEmployeeTimeline = async (
  companyId: string,
  employeeId: string,
  dateStr: string // "YYYY-MM-DD"
) => {
  const company = await Company.findById(companyId);
  const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
  const { start: startOfDay, end: endOfDay } = getDayRangeInTimezone(dateStr, companyTz);

  const events = await ActivityEvent.find({
    companyId: new mongoose.Types.ObjectId(companyId),
    employeeId: new mongoose.Types.ObjectId(employeeId),
    startedAt: { $gte: startOfDay, $lte: endOfDay },
    eventId: { $not: /^live-/ },
    applicationName: { $not: /highp|internal workforce|highphaus|electron/i }
  })
    .sort({ startedAt: 1 })
    .lean();

  // Consolidate consecutive events with the same app and event type into a single chronological block
  // so the timeline shows ONE card per application interval with increasing duration
  const consolidated: any[] = [];
  for (const evt of events) {
    if (consolidated.length === 0) {
      consolidated.push({ ...evt });
      continue;
    }

    const prev = consolidated[consolidated.length - 1];
    const prevEnd = new Date(prev.endedAt).getTime();
    const currStart = new Date(evt.startedAt).getTime();
    const isSameApp =
      (prev.applicationName || '').trim().toLowerCase() === (evt.applicationName || '').trim().toLowerCase();
    const isSameType = prev.type === evt.type;
    const isAdjacent = Math.abs(currStart - prevEnd) <= 120000; // gap <= 2 minutes

    if (isSameApp && isSameType && isAdjacent) {
      prev.durationSeconds += evt.durationSeconds;
      if (new Date(evt.endedAt) > new Date(prev.endedAt)) {
        prev.endedAt = evt.endedAt;
      }
    } else {
      consolidated.push({ ...evt });
    }
  }

  return consolidated;
};
