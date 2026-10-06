import mongoose, { Schema, Document } from 'mongoose';
import { SessionStatus } from '../shared';

export interface SequenceGapEntry {
  sequenceNumber: number;
  status: 'EXPECTED' | 'RECEIVED' | 'MISSING' | 'LATE' | 'DUPLICATE' | 'FINALIZED';
  detectedAt: Date;
  resolvedAt?: Date;
  finalizedAt?: Date;
  reason?: string;
}

export interface IAttendanceSessionDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  deviceId?: mongoose.Types.ObjectId;
  date?: string;
  startedAt: Date;
  endedAt?: Date;
  durationSeconds?: number;
  activeSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  status: SessionStatus;
  endReason?: string;
  lastHeartbeatAt?: Date;
  lastSequenceNumber?: number;
  missingSequences?: number[];
  sequenceGaps?: SequenceGapEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceSessionSchema = new Schema<IAttendanceSessionDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    date: { type: String, index: true },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date },
    durationSeconds: { type: Number, default: 0 },
    activeSeconds: { type: Number, default: 0 },
    idleSeconds: { type: Number, default: 0 },
    breakSeconds: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(SessionStatus), default: SessionStatus.ACTIVE },
    endReason: { type: String },
    lastHeartbeatAt: { type: Date },
    lastSequenceNumber: { type: Number, default: 0 },
    missingSequences: [{ type: Number }],
    sequenceGaps: [
      {
        sequenceNumber: { type: Number, required: true },
        status: {
          type: String,
          enum: ['EXPECTED', 'RECEIVED', 'MISSING', 'LATE', 'DUPLICATE', 'FINALIZED'],
          default: 'MISSING'
        },
        detectedAt: { type: Date, default: Date.now },
        resolvedAt: { type: Date },
        finalizedAt: { type: Date },
        reason: { type: String }
      }
    ]
  },
  { timestamps: true }
);

AttendanceSessionSchema.index({ companyId: 1, employeeId: 1, startedAt: -1 });
AttendanceSessionSchema.index({ companyId: 1, status: 1 });

export const AttendanceSession = mongoose.model<IAttendanceSessionDocument>('AttendanceSession', AttendanceSessionSchema);
