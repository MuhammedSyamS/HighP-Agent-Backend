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

  let ingestedCount = 0;
  let duplicatesCount = 0;

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
        duplicatesCount++;
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

      // Insert Raw Activity Event
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

      ingestedCount++;
    } catch (err: any) {
      if (err.code === 11000) {
        // Duplicate eventId already processed
        duplicatesCount++;
      } else {
        console.error('[ActivityService] Error ingesting event:', err);
      }
    }
  }

  // Update employee profile's current app if recent event
  if (events.length > 0) {
    const latestEvent = events[events.length - 1];
    if (latestEvent.applicationName) {
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

  return { ingestedCount, duplicatesCount };
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
    startedAt: { $gte: startOfDay, $lte: endOfDay }
  })
    .sort({ startedAt: 1 })
    .lean();

  return events;
};
