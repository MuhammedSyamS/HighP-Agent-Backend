import { ActivityState, SessionStatus } from '../shared';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Company } from '../models/Company';
import { emitToCompany } from '../realtime/socketManager';
import { rebuildEmployeeDay } from './rebuildService';
import { getDateStringInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';

let reaperInterval: NodeJS.Timeout | null = null;

export const checkStaleSessions = async () => {
  try {
    const companies = await Company.find().select('_id config').lean();

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
        const disconnectTime = employee.lastHeartbeatAt || new Date();

        // If employee had an open attendance session, gracefully close it at disconnectTime
        if (employee.currentSessionId) {
          try {
            const session = await AttendanceSession.findOne({
              _id: employee.currentSessionId,
              companyId: company._id,
              status: SessionStatus.ACTIVE
            });

            if (session) {
              session.endedAt = disconnectTime;
              session.status = SessionStatus.COMPLETED;
              session.endReason = 'Stale Disconnect (Heartbeat Timeout)';
              await session.save();

              const companyTz = company.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
              const disconnectDateStr = getDateStringInTimezone(disconnectTime, companyTz);
              await rebuildEmployeeDay(company._id.toString(), employee._id.toString(), disconnectDateStr);

              emitToCompany(company._id.toString(), 'employee:session_ended', {
                companyId: company._id.toString(),
                employeeId: employee._id.toString(),
                sessionId: session._id.toString(),
                endedAt: disconnectTime.toISOString(),
                totalActiveSeconds: session.activeSeconds,
                endReason: session.endReason
              });
            }
          } catch (sessionErr) {
            console.error('[ReaperService] Error closing stale session:', sessionErr);
          }
          employee.currentSessionId = undefined;
        }

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
