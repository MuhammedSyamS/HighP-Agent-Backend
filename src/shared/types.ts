import {
  UserRole,
  UserStatus,
  SessionStatus,
  ActivityState,
  ActivityEventType,
  BreakReason,
  DeviceStatus,
  SubscriptionTier,
  SubscriptionStatus
} from './enums';

export interface IAppCategory {
  name: string;
  color: string;
  apps: string[];
}

export interface ICompanyConfig {
  idleThresholdMinutes: number;
  heartbeatIntervalSeconds: number;
  offlineSyncBatchLimit: number;
  retentionDays: number;
  allowManualBreaks: boolean;
  appCategories: IAppCategory[];
  allowedTrackingHours?: {
    enabled: boolean;
    startTime: string; // "09:00"
    endTime: string;   // "18:00"
    timezone: string;
  };
}

export interface ICompany {
  _id: string;
  name: string;
  slug: string;
  ownerId: string;
  config: ICompanyConfig;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface IUser {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  companyId: string;
  employeeProfileId?: string;
  status: UserStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface IEmployeeProfile {
  _id: string;
  companyId: string;
  userId: string;
  employeeCode: string;
  department: string;
  designation: string;
  managerId?: string;
  currentSessionId?: string;
  currentDeviceId?: string;
  currentStatus: ActivityState;
  currentApplication?: string;
  lastActiveAt?: Date | string;
  lastHeartbeatAt?: Date | string;
  todayActiveSeconds: number;
  todayIdleSeconds: number;
  todayBreakSeconds: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface IAttendanceSession {
  _id: string;
  companyId: string;
  employeeId: string;
  deviceId?: string;
  startedAt: Date | string;
  endedAt?: Date | string;
  activeSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  status: SessionStatus;
  endReason?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface IBreak {
  _id: string;
  companyId: string;
  employeeId: string;
  sessionId: string;
  startedAt: Date | string;
  endedAt?: Date | string;
  durationSeconds: number;
  reason: BreakReason | string;
  note?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface IActivityEvent {
  _id?: string;
  eventId: string; // Unique client-generated UUID for idempotency
  companyId: string;
  employeeId: string;
  sessionId: string;
  deviceId?: string;
  type: ActivityEventType;
  applicationName: string;
  processName?: string;
  windowTitleSanitized?: string;
  startedAt: Date | string;
  endedAt: Date | string;
  durationSeconds: number;
  createdAt?: Date | string;
}

export interface IApplicationUsage {
  _id: string;
  companyId: string;
  employeeId: string;
  date: string; // "YYYY-MM-DD"
  applicationName: string;
  category?: string;
  totalSeconds: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface IDevice {
  _id: string;
  companyId: string;
  employeeId: string;
  deviceId: string;
  deviceName: string;
  osInfo: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
  };
  agentVersion: string;
  status: DeviceStatus;
  lastHeartbeatAt: Date | string;
  lastIpAddress?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ISubscription {
  _id: string;
  companyId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  maxEmployees: number;
  features: string[];
  trialEndsAt?: Date | string;
  currentPeriodEnd?: Date | string;
}

export interface IAuditLog {
  _id: string;
  companyId: string;
  userId?: string;
  action: string;
  resource: string;
  details?: Record<string, any>;
  ipAddress?: string;
  timestamp: Date | string;
}

// Agent API Payloads
export interface IAgentRegisterPayload {
  deviceIdentifier: string;
  deviceName: string;
  osInfo: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
  };
  agentVersion: string;
}

export interface IAgentHeartbeatPayload {
  deviceId: string;
  sessionId?: string;
  timestamp: string;
  status: ActivityState;
  currentApplication?: string;
  idleSeconds: number;
  recentDurationSeconds?: number;
}

export interface IAgentSyncPayload {
  deviceId: string;
  sessionId: string;
  events: {
    eventId: string;
    type: ActivityEventType;
    applicationName: string;
    processName?: string;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
  }[];
}

// Live Dashboard Stats
export interface IDashboardOverview {
  totalEmployees: number;
  activeNow: number;
  idleNow: number;
  onBreakNow: number;
  offlineNow: number;
  currentlyWorking: number;
  totalActiveSecondsToday: number;
  totalIdleSecondsToday: number;
  totalBreakSecondsToday: number;
}

export interface IEmployeeLiveStatus {
  employeeId: string;
  userId: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  status: ActivityState;
  currentApplication?: string;
  todayActiveSeconds: number;
  todayIdleSeconds: number;
  todayBreakSeconds: number;
  sessionStartedAt?: string;
  lastActiveAt?: string;
  deviceId?: string;
}

// Reports
export interface IDailyReportRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  date: string;
  sessionStartedAt?: string;
  sessionEndedAt?: string;
  activeSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  totalSessionSeconds: number;
  topApplications: { applicationName: string; seconds: number }[];
}

export interface IWeeklyMonthlyReportRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  period: string; // "2026-W38" or "2026-09"
  workingDaysCount: number;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  totalBreakSeconds: number;
  totalSessionSeconds: number;
  averageDailyActiveSeconds: number;
}

// Socket Events
export interface ISocketEvents {
  'employee:status_changed': {
    companyId: string;
    employeeId: string;
    status: ActivityState;
    currentApplication?: string;
    lastActiveAt?: string;
  };
  'employee:activity_changed': {
    companyId: string;
    employeeId: string;
    currentApplication: string;
    timestamp: string;
  };
  'employee:session_started': {
    companyId: string;
    employeeId: string;
    sessionId: string;
    startedAt: string;
  };
  'employee:session_ended': {
    companyId: string;
    employeeId: string;
    sessionId: string;
    endedAt: string;
    totalActiveSeconds: number;
    totalIdleSeconds: number;
  };
  'employee:break_started': {
    companyId: string;
    employeeId: string;
    breakId: string;
    reason: string;
    startedAt: string;
  };
  'employee:break_ended': {
    companyId: string;
    employeeId: string;
    breakId: string;
    durationSeconds: number;
    endedAt: string;
  };
}
