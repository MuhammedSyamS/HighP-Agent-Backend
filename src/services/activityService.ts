import mongoose from 'mongoose';
import { ActivityEventType, ActivityState, SessionStatus } from '../shared';
import { ActivityEvent, IActivityEventDocument } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { Company } from '../models/Company';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Device } from '../models/Device';
import { emitToCompany } from '../realtime/socketManager';

export interface IngestEventInput {
  eventId: string;
  type: ActivityEventType;
  applicationName: string;
  processName?: string;
  windowTitleSanitized?: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
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
    return { ingestedCount: 0, duplicatesCount: 0 };
  }

  const company = await Company.findById(companyId);
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

  for (const event of events) {
    const started = new Date(event.startedAt);
    const ended = new Date(event.endedAt);
    const dateStr = started.toISOString().slice(0, 10);
    const duration = Math.max(0, event.durationSeconds || Math.round((ended.getTime() - started.getTime()) / 1000));
    const cleanAppName = event.applicationName.trim() || 'Unknown Application';
    const category = determineCategory(cleanAppName, categories);

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

      // If still no session, create one fallback session
      if (!resolvedSessionId) {
        const fallbackSession = await AttendanceSession.create({
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: new mongoose.Types.ObjectId(employeeId),
          startedAt: started,
          status: SessionStatus.ACTIVE
        });
        resolvedSessionId = fallbackSession._id as mongoose.Types.ObjectId;
      }

      // Filter out self-monitoring / internal agent spam events
      const lowerApp = cleanAppName.toLowerCase();
      if (
        lowerApp.includes('highp') ||
        lowerApp.includes('internal workforce') ||
        lowerApp.includes('highphaus') ||
        lowerApp === 'electron' ||
        lowerApp === 'electron.exe' ||
        lowerApp === 'unknown' ||
        lowerApp === 'unknown application'
      ) {
        // Skip inserting or counting self/unknown agent activity as a tracked application
        accepted.push(event.eventId);
        continue;
      }

      // Check if previous event in the same session is the exact same application and continuous (gap <= 120s)
      const lastSessionEvent = await ActivityEvent.findOne({
        companyId: new mongoose.Types.ObjectId(companyId),
        employeeId: new mongoose.Types.ObjectId(employeeId),
        sessionId: resolvedSessionId,
        type: event.type
      }).sort({ startedAt: -1 });

      const isContinuous =
        lastSessionEvent &&
        lastSessionEvent.applicationName.trim().toLowerCase() === cleanAppName.trim().toLowerCase() &&
        Math.abs(started.getTime() - lastSessionEvent.endedAt.getTime()) <= 120000;

      if (isContinuous) {
        // Coalesce into existing interval: increase its time and extend endedAt!
        lastSessionEvent.endedAt = ended > lastSessionEvent.endedAt ? ended : lastSessionEvent.endedAt;
        lastSessionEvent.durationSeconds += duration;
        await lastSessionEvent.save();
      } else {
        // Insert new distinct activity interval
        await ActivityEvent.create({
          eventId: event.eventId,
          companyId: new mongoose.Types.ObjectId(companyId),
          employeeId: new mongoose.Types.ObjectId(employeeId),
          sessionId: resolvedSessionId,
          ...(resolvedDeviceId && { deviceId: resolvedDeviceId }),
          type: event.type,
          applicationName: cleanAppName,
          processName: event.processName,
          windowTitleSanitized: event.windowTitleSanitized,
          startedAt: started,
          endedAt: ended,
          durationSeconds: duration
        });
      }

      // 2. Aggregate into Daily Application Usage
      if (event.type === ActivityEventType.APPLICATION_FOCUS && duration > 0) {
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

  // Update employee profile's current app if recent event (and not HighP agent)
  if (events.length > 0) {
    const validEvents = events.filter((e) => {
      const a = (e.applicationName || '').toLowerCase();
      return (
        a &&
        !a.includes('highp') &&
        !a.includes('internal workforce') &&
        !a.includes('highphaus') &&
        !a.includes('electron')
      );
    });

    if (validEvents.length > 0) {
      const latestEvent = validEvents[validEvents.length - 1];
      await EmployeeProfile.updateOne(
        { _id: employeeId, companyId },
        { $set: { currentApplication: latestEvent.applicationName } }
      );

      emitToCompany(companyId, 'employee:activity_changed', {
        companyId,
        employeeId,
        currentApplication: latestEvent.applicationName,
        timestamp: latestEvent.endedAt
      });
    }
  }

  // Synchronize derived daily totals if any new events were accepted
  if (accepted.length > 0) {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
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
  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

  const events = await ActivityEvent.find({
    companyId: new mongoose.Types.ObjectId(companyId),
    employeeId: new mongoose.Types.ObjectId(employeeId),
    startedAt: { $gte: startOfDay, $lte: endOfDay },
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
