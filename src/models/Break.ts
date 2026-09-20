import mongoose, { Schema, Document } from 'mongoose';
import { BreakReason } from '@highp/shared';

export interface IBreakDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  startedAt: Date;
  endedAt?: Date;
  durationSeconds: number;
  reason: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BreakSchema = new Schema<IBreakDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AttendanceSession', required: true, index: true },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date },
    durationSeconds: { type: Number, default: 0 },
    reason: { type: String, default: BreakReason.OTHER },
    note: { type: String, trim: true }
  },
  { timestamps: true }
);

BreakSchema.index({ companyId: 1, employeeId: 1, startedAt: -1 });

export const Break = mongoose.model<IBreakDocument>('Break', BreakSchema);
