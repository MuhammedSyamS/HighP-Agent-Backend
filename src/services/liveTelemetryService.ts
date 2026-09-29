import { EmployeeProfile } from '../models/EmployeeProfile';
import { emitToCompany, emitToEmployee } from '../realtime/socketManager';

export interface LiveTelemetryState {
  employeeProfileId: string;
  companyId: string;
  hwnd: number | null;
  pid: number | null;
  executable: string | null;
  application: string | null;
  windowTitle?: string | null;
  startedAt: string | null;
  lastSeenAt: string | null;
  activeDurationSeconds: number;
  idleSeconds: number;
  status: 'active' | 'idle' | 'break' | 'offline';
}

const liveMap = new Map<string, LiveTelemetryState>();

export const liveTelemetryService = {
  setLiveTelemetry(state: LiveTelemetryState): void {
    if (!state.employeeProfileId) return;
    const key = state.employeeProfileId.toString();

    const existing = liveMap.get(key);
    if (existing && existing.lastSeenAt && state.lastSeenAt) {
      const existingMs = new Date(existing.lastSeenAt).getTime();
      const newMs = new Date(state.lastSeenAt).getTime();
      if (!isNaN(existingMs) && !isNaN(newMs) && newMs < existingMs) {
        // Discard stale out-of-order telemetry update
        return;
      }
    }

    liveMap.set(key, { ...state });

    // Emit live telemetry event to company and employee rooms
    emitToCompany(state.companyId, 'employee:telemetry_updated', state);
    emitToEmployee(state.employeeProfileId, 'employee:telemetry_updated', state);
  },

  async getLiveTelemetry(employeeProfileId: string, companyId?: string): Promise<LiveTelemetryState | null> {
    if (!employeeProfileId) return null;
    const key = employeeProfileId.toString();

    // Check fast in-memory state
    const cached = liveMap.get(key);
    if (cached) {
      let activeDuration = cached.activeDurationSeconds || 0;
      if (cached.status === 'active' && cached.startedAt) {
        const startedMs = new Date(cached.startedAt).getTime();
        if (!isNaN(startedMs)) {
          activeDuration = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
        }
      }
      return {
        ...cached,
        activeDurationSeconds: activeDuration
      };
    }

    // Fallback to MongoDB EmployeeProfile
    const profile = await EmployeeProfile.findById(employeeProfileId);
    if (!profile) return null;

    const normStatus = (profile.currentStatus || 'OFFLINE').toLowerCase() as 'active' | 'idle' | 'break' | 'offline';
    const startedAt = (profile as any).currentAppStartedAt
      ? (profile as any).currentAppStartedAt.toISOString()
      : profile.lastActiveAt
      ? profile.lastActiveAt.toISOString()
      : null;

    let activeDuration = 0;
    if (normStatus === 'active' && startedAt) {
      const startedMs = new Date(startedAt).getTime();
      if (!isNaN(startedMs)) {
        activeDuration = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
      }
    }

    const state: LiveTelemetryState = {
      employeeProfileId: profile._id.toString(),
      companyId: profile.companyId.toString(),
      hwnd: null,
      pid: null,
      executable: (profile as any).currentExecutable || null,
      application: profile.currentApplication || null,
      windowTitle: null,
      startedAt,
      lastSeenAt: profile.lastHeartbeatAt ? profile.lastHeartbeatAt.toISOString() : null,
      activeDurationSeconds: activeDuration,
      idleSeconds: 0,
      status: normStatus
    };

    liveMap.set(key, state);
    return state;
  },

  markEmployeeOffline(employeeProfileId: string, companyId: string): void {
    if (!employeeProfileId) return;
    const key = employeeProfileId.toString();
    const existing = liveMap.get(key);

    const offlineState: LiveTelemetryState = {
      employeeProfileId,
      companyId,
      hwnd: null,
      pid: null,
      executable: null,
      application: null,
      windowTitle: null,
      startedAt: null,
      lastSeenAt: new Date().toISOString(),
      activeDurationSeconds: 0,
      idleSeconds: 0,
      status: 'offline'
    };

    liveMap.set(key, offlineState);
    emitToCompany(companyId, 'employee:telemetry_updated', offlineState);
    emitToEmployee(employeeProfileId, 'employee:telemetry_updated', offlineState);
  }
};
