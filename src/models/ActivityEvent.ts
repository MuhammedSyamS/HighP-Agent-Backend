import mongoose, { Schema, Document } from 'mongoose';
import { ActivityEventType } from '@highp/shared';

export interface IActivityEventDocument extends Document {
  eventId: string;
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  deviceId?: mongoose.Types.ObjectId;
  type: ActivityEventType;
  applicationName: string;
  processName?: string;
  windowTitleSanitized?: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  createdAt: Date;
}

const ActivityEventSchema = new Schema<IActivityEventDocument>(
  {
    eventId: { type: String, required: true, trim: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AttendanceSession', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    type: { type: String, enum: Object.values(ActivityEventType), default: ActivityEventType.APPLICATION_FOCUS },
    applicationName: { type: String, required: true, trim: true },
    processName: { type: String, trim: true },
    windowTitleSanitized: { type: String, trim: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    durationSeconds: { type: Number, required: true, min: 0 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Enforce unique eventId per company to guarantee idempotent sync
ActivityEventSchema.index({ companyId: 1, eventId: 1 }, { unique: true });
ActivityEventSchema.index({ companyId: 1, employeeId: 1, startedAt: -1 });
ActivityEventSchema.index({ companyId: 1, sessionId: 1, startedAt: 1 });
ActivityEventSchema.index({ companyId: 1, applicationName: 1, startedAt: -1 });

export const ActivityEvent = mongoose.model<IActivityEventDocument>('ActivityEvent', ActivityEventSchema);
