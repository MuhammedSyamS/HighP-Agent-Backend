import { ActivityState, SessionStatus } from '@highp/shared';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Company } from '../models/Company';
import { emitToCompany } from '../realtime/socketManager';

let reaperInterval: NodeJS.Timeout | null = null;

export const checkStaleSessions = async () => {
  try {
    const companies = await Company.find().select('_id config').lean();

    for (const company of companies) {
      const heartbeatSec = company.config?.heartbeatIntervalSeconds || 30;
      const timeoutThresholdMs = heartbeatSec * 3 * 1000; // 3 missed heartbeats
      const cutoff = new Date(Date.now() - timeoutThresholdMs);

      // Find active/idle employees whose heartbeat timed out
      const staleEmployees = await EmployeeProfile.find({
        companyId: company._id,
        currentStatus: { $in: [ActivityState.ACTIVE, ActivityState.IDLE] },
        lastHeartbeatAt: { $lt: cutoff }
      });

      for (const employee of staleEmployees) {
        employee.currentStatus = ActivityState.OFFLINE;
        await employee.save();

        emitToCompany(company._id.toString(), 'employee:status_changed', {
          companyId: company._id.toString(),
          employeeId: employee._id.toString(),
          status: ActivityState.OFFLINE,
          currentApplication: employee.currentApplication,
          lastActiveAt: employee.lastActiveAt?.toISOString()
        });
      }
    }
  } catch (error) {
    console.error('[ReaperService] Error checking stale sessions:', error);
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
