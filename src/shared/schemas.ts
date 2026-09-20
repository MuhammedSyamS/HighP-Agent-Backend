import { z } from 'zod';
import { UserRole, BreakReason, ActivityState, ActivityEventType } from './enums';

export const RegisterCompanySchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters').max(100),
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

export const SignupSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  department: z.string().optional(),
  designation: z.string().optional(),
  companySlug: z.string().optional()
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

export const CreateEmployeeSchema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  role: z.nativeEnum(UserRole).default(UserRole.EMPLOYEE),
  employeeCode: z.string().min(1, 'Employee code is required'),
  department: z.string().min(1, 'Department is required'),
  designation: z.string().min(1, 'Designation is required'),
  managerId: z.string().optional()
});

export const UpdateEmployeeSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.nativeEnum(UserRole).optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  managerId: z.string().nullable().optional(),
  status: z.string().optional()
});

export const UpdateCompanyConfigSchema = z.object({
  idleThresholdMinutes: z.number().min(1).max(60).optional(),
  heartbeatIntervalSeconds: z.number().min(5).max(300).optional(),
  retentionDays: z.number().min(7).max(3650).optional(),
  allowManualBreaks: z.boolean().optional(),
  appCategories: z.array(
    z.object({
      name: z.string(),
      color: z.string(),
      apps: z.array(z.string())
    })
  ).optional()
});

export const StartBreakSchema = z.object({
  reason: z.nativeEnum(BreakReason).or(z.string()).default(BreakReason.OTHER),
  note: z.string().max(200).optional()
});

export const EndBreakSchema = z.object({
  breakId: z.string().optional()
});

export const AgentRegisterSchema = z.object({
  deviceIdentifier: z.string().min(1),
  deviceName: z.string().min(1),
  osInfo: z.object({
    platform: z.string(),
    release: z.string(),
    arch: z.string(),
    hostname: z.string()
  }),
  agentVersion: z.string()
});

export const AgentHeartbeatSchema = z.object({
  deviceId: z.string().min(1),
  sessionId: z.string().optional(),
  timestamp: z.string(),
  status: z.nativeEnum(ActivityState),
  currentApplication: z.string().optional(),
  idleSeconds: z.number().min(0),
  recentDurationSeconds: z.number().min(0).optional()
});

export const AgentSyncSchema = z.object({
  deviceId: z.string().min(1),
  sessionId: z.string().min(1),
  events: z.array(
    z.object({
      eventId: z.string().uuid(),
      type: z.nativeEnum(ActivityEventType),
      applicationName: z.string().min(1),
      processName: z.string().optional(),
      startedAt: z.string(),
      endedAt: z.string(),
      durationSeconds: z.number().min(0)
    })
  ).max(500)
});
