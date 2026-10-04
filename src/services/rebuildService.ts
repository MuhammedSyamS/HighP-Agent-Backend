import mongoose from 'mongoose';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { DailySummary } from '../models/DailySummary';
import { Break } from '../models/Break';
import { Company } from '../models/Company';
import { ActivityEventType } from '../shared';
import { determineCategory } from './activityService';
import { getDayRangeInTimezone, getDateStringInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';

export interface DayRebuildResult {
  date: string;
  employeeId: string;
  totalEvents: number;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalBreakSeconds: number;
  uniqueApplications: number;
}

export const rebuildEmployeeDay = async (
  companyId: string,
  employeeId: string,
  dateStr: string // "YYYY-MM-DD"
): Promise<DayRebuildResult> => {
  const companyObjId = new mongoose.Types.ObjectId(companyId);
  const employeeObjId = new mongoose.Types.ObjectId(employeeId);

  const company = await Company.findById(companyObjId);
  const companyTimezone = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
  const categories = company?.config?.appCategories || [];

  // Determine authoritative day boundaries in company timezone
  const { start: startOfDay, end: endOfDay } = getDayRangeInTimezone(dateStr, companyTimezone);

  // 1. Fetch all authoritative ActivityEvents for this day (exclude internal self-monitoring & legacy synthetic live events)
  const events = await ActivityEvent.find({
    companyId: companyObjId,
    employeeId: employeeObjId,
    startedAt: { $gte: startOfDay, $lte: endOfDay },
    eventId: { $not: /^live-/ },
    applicationName: { $not: /highp|internal workforce|highphaus|electron/i }
  })
    .sort({ startedAt: 1 })
    .lean();

  // 2. Aggregate application usage from events
  const appMap: Record<string, { duration: number; category: string; lastUsed: Date }> = {};
  let totalActiveSeconds = 0;
  let totalIdleSeconds = 0;

  for (const ev of events) {
    const dur = ev.durationSeconds || 0;
    if (dur <= 0) continue;

    if (ev.type === ActivityEventType.IDLE_INTERVAL) {
      totalIdleSeconds += dur;
    } else {
      totalActiveSeconds += dur;
      const appName = ev.applicationName.trim() || 'Unknown Application';
      const cat = determineCategory(appName, categories);

      if (!appMap[appName]) {
        appMap[appName] = { duration: 0, category: cat, lastUsed: ev.endedAt };
      }
      appMap[appName].duration += dur;
      if (ev.endedAt > appMap[appName].lastUsed) {
        appMap[appName].lastUsed = ev.endedAt;
      }
    }
  }

  // 3. Atomically reconcile ApplicationUsage collection for this day
  for (const [appName, stats] of Object.entries(appMap)) {
    await ApplicationUsage.findOneAndUpdate(
      {
        companyId: companyObjId,
        employeeId: employeeObjId,
        date: dateStr,
        applicationName: appName
      },
      {
        $set: {
          totalSeconds: stats.duration,
          category: stats.category,
          lastUsedAt: stats.lastUsed
        }
      },
      { upsert: true, new: true }
    );
  }

  // 4. Calculate total break seconds from Break records for this day
  const breaks = await Break.find({
    companyId: companyObjId,
    employeeId: employeeObjId,
    startedAt: { $gte: startOfDay, $lte: endOfDay }
  }).lean();

  const totalBreakSeconds = breaks.reduce((acc, b) => {
    let dur = b.durationSeconds || 0;
    if (!b.endedAt && b.startedAt) {
      dur = Math.max(dur, Math.round((Date.now() - new Date(b.startedAt).getTime()) / 1000));
    }
    return acc + dur;
  }, 0);

  // 5. Fetch AttendanceSessions for first/last timestamps
  const sessions = await AttendanceSession.find({
    companyId: companyObjId,
    employeeId: employeeObjId,
    startedAt: { $gte: startOfDay, $lte: endOfDay }
  })
    .sort({ startedAt: 1 })
    .lean();

  let firstSessionStart: Date | undefined;
  let lastSessionEnd: Date | undefined;
  let totalSessionSeconds = 0;

  if (sessions.length > 0) {
    firstSessionStart = sessions[0].startedAt;
    const lastSess = sessions[sessions.length - 1];
    lastSessionEnd = lastSess.endedAt || undefined;
    totalSessionSeconds = totalActiveSeconds + totalIdleSeconds + totalBreakSeconds;
  }

  // 6. Upsert authoritative DailySummary record
  const summaryAppUsage = Object.entries(appMap).map(([appName, stats]) => ({
    applicationName: appName,
    category: stats.category,
    totalSeconds: stats.duration
  }));

  await DailySummary.findOneAndUpdate(
    {
      companyId: companyObjId,
      employeeId: employeeObjId,
      date: dateStr
    },
    {
      $set: {
        firstSessionStart,
        lastSessionEnd,
        totalSessionSeconds,
        activeSeconds: totalActiveSeconds,
        idleSeconds: totalIdleSeconds,
        breakSeconds: totalBreakSeconds,
        applicationUsage: summaryAppUsage
      }
    },
    { upsert: true }
  );

  // 7. If date matches today in the company's timezone, synchronize live profile cache
  const todayInCompanyTz = getDateStringInTimezone(new Date(), companyTimezone);
  if (dateStr === todayInCompanyTz) {
    const existing = await EmployeeProfile.findById(employeeObjId).lean();
    await EmployeeProfile.updateOne(
      { _id: employeeObjId, companyId: companyObjId },
      {
        $set: {
          todayActiveSeconds: Math.max(totalActiveSeconds, existing?.todayActiveSeconds || 0),
          todayIdleSeconds: Math.max(totalIdleSeconds, existing?.todayIdleSeconds || 0),
          todayBreakSeconds: Math.max(totalBreakSeconds, existing?.todayBreakSeconds || 0),
          lastDateReset: todayInCompanyTz
        }
      }
    );
  }

  return {
    date: dateStr,
    employeeId,
    totalEvents: events.length,
    totalActiveSeconds,
    totalIdleSeconds,
    totalBreakSeconds,
    uniqueApplications: Object.keys(appMap).length
  };
};
