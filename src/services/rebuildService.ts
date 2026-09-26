import mongoose from 'mongoose';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { Break } from '../models/Break';
import { Company } from '../models/Company';
import { ActivityEventType } from '../shared';
import { determineCategory } from './activityService';

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

  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

  // 1. Fetch all authoritative ActivityEvents for this day
  const events = await ActivityEvent.find({
    companyId: companyObjId,
    employeeId: employeeObjId,
    startedAt: { $gte: startOfDay, $lte: endOfDay }
  })
    .sort({ startedAt: 1 })
    .lean();

  const company = await Company.findById(companyObjId);
  const categories = company?.config?.appCategories || [];

  // 2. Aggregate application usage from events
  const appMap: Record<string, { duration: number; lastUsed: Date }> = {};
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
      if (!appMap[appName]) {
        appMap[appName] = { duration: 0, lastUsed: ev.endedAt };
      }
      appMap[appName].duration += dur;
      if (ev.endedAt > appMap[appName].lastUsed) {
        appMap[appName].lastUsed = ev.endedAt;
      }
    }
  }

  // 3. Atomically reconcile ApplicationUsage collection for this day
  for (const [appName, stats] of Object.entries(appMap)) {
    const cat = determineCategory(appName, categories);
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
          category: cat,
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

  const totalBreakSeconds = breaks.reduce((acc, b) => acc + (b.durationSeconds || 0), 0);

  // 5. If date is today, synchronize authoritative cached daily counters on EmployeeProfile
  const todayStr = new Date().toISOString().slice(0, 10);
  if (dateStr === todayStr) {
    await EmployeeProfile.updateOne(
      { _id: employeeObjId, companyId: companyObjId },
      {
        $set: {
          todayActiveSeconds: totalActiveSeconds,
          todayIdleSeconds: totalIdleSeconds,
          todayBreakSeconds: totalBreakSeconds,
          lastDateReset: todayStr
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
