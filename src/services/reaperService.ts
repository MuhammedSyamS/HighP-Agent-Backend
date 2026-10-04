import mongoose from 'mongoose';
import { ActivityState, SessionStatus } from '../shared';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Company } from '../models/Company';
import { emitToCompany } from '../realtime/socketManager';
import { rebuildEmployeeDay } from './rebuildService';
import { getDateStringInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';

let reaperInterval: NodeJS.Timeout | null = null;

export const checkStaleSessions = async (targetCompanyId?: string) => {
  try {
    // Skip if database is currently disconnected during network recovery
    if (mongoose.connection.readyState !== 1) {
      return;
    }

    const filter = targetCompanyId ? { _id: targetCompanyId } : {};
    const companies = await Company.find(filter).select('_id config').lean();

    for (const company of companies) {
      const heartbeatSec = company.config?.heartbeatIntervalSeconds || 30;
      // Use at least 10 minutes timeout threshold to prevent premature session termination from background tab throttling or brief network interruptions
      const timeoutThresholdMs = Math.max(heartbeatSec * 10 * 1000, 10 * 60 * 1000);
      const cutoff = new Date(Date.now() - timeoutThresholdMs);

      // Find active/idle employees whose heartbeat timed out
      const staleEmployees = await EmployeeProfile.find({
        companyId: company._id,
        currentStatus: { $in: [ActivityState.ACTIVE, ActivityState.IDLE] },
        lastHeartbeatAt: { $lt: cutoff }
      });

      for (const employee of staleEmployees) {
        // Disconnect only updates presence status to OFFLINE; work sessions remain OPEN until explicit End Work
        employee.currentStatus = ActivityState.OFFLINE;
        employee.currentApplication = '';
        await employee.save();

        emitToCompany(company._id.toString(), 'employee:status_changed', {
          companyId: company._id.toString(),
          employeeId: employee._id.toString(),
          status: ActivityState.OFFLINE,
          currentApplication: '',
          lastActiveAt: employee.lastActiveAt?.toISOString()
        });
      }
    }
  } catch (error: any) {
    if (error?.name === 'MongoServerSelectionError' || error?.code === 'ENOTFOUND') {
      console.warn('[ReaperService] MongoDB network unavailable, will retry next cycle.');
    } else {
      console.error('[ReaperService] Error checking stale sessions:', error?.message || error);
    }
  }
};

export const startReaperService = (intervalSeconds = 30) => {
  if (reaperInterval) clearInterval(reaperInterval);
  reaperInterval = setInterval(checkStaleSessions, intervalSeconds * 1000);
  console.log(`[ReaperService] Stale session monitoring started (${intervalSeconds}s interval).`);
};

export const stopReaperService = () => {
  if (reaperInterval) {
    clearInterval(reaperInterval);
    reaperInterval = null;
  }
};
