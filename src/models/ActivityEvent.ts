import mongoose, { Schema, Document } from 'mongoose';
import { ActivityEventType } from '../shared';

export interface IActivityEventDocument extends Document {
  eventId: string;
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  deviceId?: mongoose.Types.ObjectId;
  applicationId?: mongoose.Types.ObjectId;
  type: ActivityEventType;
  applicationName: string;
  processName?: string;
  category?: string;
  processId?: number;
  windowTitleSanitized?: string;
  sequenceNumber?: number;
  durationMs?: number;
  clockSource?: string;
  wallClockStart?: Date;
  wallClockEnd?: Date;
  startedAt: Date;
  lastSeenAt?: Date;
  endedAt: Date;
  durationSeconds: number;
  domain?: string;
  status?: string;
  createdAt: Date;
}

const ActivityEventSchema = new Schema<IActivityEventDocument>(
  {
    eventId: { type: String, required: true, trim: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AttendanceSession', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    applicationId: { type: Schema.Types.ObjectId, ref: 'TrackedApplication' },
    sequenceNumber: { type: Number },
    type: { type: String, enum: Object.values(ActivityEventType), default: ActivityEventType.APPLICATION_FOCUS },
    applicationName: { type: String, required: true, trim: true },
    processName: { type: String, trim: true },
    category: { type: String, trim: true, default: 'Other' },
    processId: { type: Number },
    windowTitleSanitized: { type: String, trim: true },
    domain: { type: String, trim: true },
    durationMs: { type: Number, min: 0 },
    clockSource: { type: String, default: 'MONOTONIC' },
    wallClockStart: { type: Date },
    wallClockEnd: { type: Date },
    startedAt: { type: Date, required: true },
    lastSeenAt: { type: Date },
    endedAt: { type: Date, required: true },
    durationSeconds: { type: Number, required: true, min: 0 },
    status: { type: String, default: 'ACTIVE' }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Enforce unique eventId per company to guarantee idempotent sync
ActivityEventSchema.index({ companyId: 1, eventId: 1 }, { unique: true });
ActivityEventSchema.index({ companyId: 1, employeeId: 1, startedAt: -1 });
ActivityEventSchema.index({ companyId: 1, sessionId: 1, startedAt: 1 });
ActivityEventSchema.index({ companyId: 1, applicationName: 1, startedAt: -1 });
ActivityEventSchema.index({ companyId: 1, category: 1, startedAt: -1 });

export const ActivityEvent = mongoose.model<IActivityEventDocument>('ActivityEvent', ActivityEventSchema);
