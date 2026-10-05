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
    if (mongoose.connection.readyState !== 1) {
      return;
    }

    const filter = targetCompanyId ? { _id: targetCompanyId } : {};
    const companies = await Company.find(filter).select('_id config').lean();
    let totalReconciled = 0;

    for (const company of companies) {
      const companyTz = company.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
      const heartbeatSec = company.config?.heartbeatIntervalSeconds || 30;
      // Presence timeout: 10 minutes without heartbeat -> mark OFFLINE
      const presenceTimeoutMs = Math.max(heartbeatSec * 10 * 1000, 10 * 60 * 1000);
      const presenceCutoff = new Date(Date.now() - presenceTimeoutMs);

      // Stale Session timeout: 2 hours without heartbeat -> reconcile and close session
      const sessionTimeoutMs = 2 * 60 * 60 * 1000;
      const sessionCutoff = new Date(Date.now() - sessionTimeoutMs);

      // 1. Mark presence OFFLINE for workers without recent heartbeat
      const stalePresence = await EmployeeProfile.find({
        companyId: company._id,
        currentStatus: { $in: [ActivityState.ACTIVE, ActivityState.IDLE] },
        lastHeartbeatAt: { $lt: presenceCutoff }
      });

      for (const employee of stalePresence) {
        employee.currentStatus = ActivityState.OFFLINE;
        employee.currentApplication = '';
        employee.currentWebsiteDomain = '';
        await employee.save();

        emitToCompany(company._id.toString(), 'employee:status_changed', {
          companyId: company._id.toString(),
          employeeId: employee._id.toString(),
          status: ActivityState.OFFLINE,
          currentApplication: '',
          lastActiveAt: employee.lastActiveAt?.toISOString()
        });
      }

      // 2. Reconcile abandoned ACTIVE sessions where no heartbeat arrived for > 2 hours
      const abandonedSessions = await AttendanceSession.find({
        companyId: company._id,
        status: SessionStatus.ACTIVE,
        $or: [
          { lastHeartbeatAt: { $lt: sessionCutoff } },
          { lastHeartbeatAt: { $exists: false }, startedAt: { $lt: sessionCutoff } }
        ]
      });

      for (const session of abandonedSessions) {
        const empProfile = await EmployeeProfile.findById(session.employeeId).lean();
        const recordedWorkSec = (session.activeSeconds || 0) + (session.idleSeconds || 0) + (session.breakSeconds || 0);

        // Determine true last known active/heartbeat time
        let candidateEnd = session.lastHeartbeatAt 
          || (empProfile?.lastHeartbeatAt && new Date(empProfile.lastHeartbeatAt) > session.startedAt ? empProfile.lastHeartbeatAt : null)
          || (empProfile?.lastActiveAt && new Date(empProfile.lastActiveAt) > session.startedAt ? empProfile.lastActiveAt : null)
          || session.updatedAt;

        let effectiveEndMs = candidateEnd ? new Date(candidateEnd).getTime() : (session.startedAt.getTime() + Math.max(60, recordedWorkSec) * 1000);
        // Ensure effectiveEnd is at least after recorded work time
        const minEndMs = session.startedAt.getTime() + Math.max(60, recordedWorkSec) * 1000;
        if (effectiveEndMs < minEndMs) {
          effectiveEndMs = minEndMs;
        }

        const effectiveEnd = new Date(effectiveEndMs);
        const durationSec = Math.max(0, Math.round((effectiveEnd.getTime() - session.startedAt.getTime()) / 1000));

        session.durationSeconds = durationSec;
        session.activeSeconds = Math.max(0, session.activeSeconds || 0);
        session.breakSeconds = Math.max(0, session.breakSeconds || 0);
        const remainingIdle = Math.max(0, durationSec - (session.activeSeconds || 0) - (session.breakSeconds || 0));
        session.idleSeconds = remainingIdle;

        session.endedAt = effectiveEnd;
        session.status = SessionStatus.COMPLETED;
        session.endReason = 'Auto-Reconciled by Reaper (Stale Session)';
        await session.save();

        // Clear current session on profile if linked
        await EmployeeProfile.updateOne(
          { _id: session.employeeId, currentSessionId: session._id },
          { $unset: { currentSessionId: 1 }, $set: { currentStatus: ActivityState.OFFLINE } }
        );

        const dateStr = getDateStringInTimezone(session.startedAt, companyTz);
        await rebuildEmployeeDay(company._id.toString(), session.employeeId.toString(), dateStr).catch(() => {});
        totalReconciled++;
      }
    }

    if (totalReconciled > 0) {
      console.log(`[REAPER] Reconciled ${totalReconciled} stale sessions`);
    }
  } catch (error: any) {
    if (error?.name === 'MongoServerSelectionError' || error?.code === 'ENOTFOUND') {
      console.warn('[REAPER] MongoDB network unavailable, will retry next cycle.');
    } else {
      console.error('[REAPER] Error checking stale sessions:', error?.message || error);
    }
  }
};

export const startReaperService = (intervalSeconds = 30) => {
  if (reaperInterval) clearInterval(reaperInterval);
  reaperInterval = setInterval(() => {
    checkStaleSessions();
  }, intervalSeconds * 1000);
  console.log(`[REAPER] Started (running every ${intervalSeconds}s)`);
};

export const stopReaperService = () => {
  if (reaperInterval) {
    clearInterval(reaperInterval);
    reaperInterval = null;
    console.log('[REAPER] Stopped');
  }
};
