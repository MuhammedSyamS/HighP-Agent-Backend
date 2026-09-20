import mongoose, { Schema, Document } from 'mongoose';
import { SessionStatus } from '../shared';

export interface IAttendanceSessionDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  deviceId?: mongoose.Types.ObjectId;
  startedAt: Date;
  endedAt?: Date;
  activeSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  status: SessionStatus;
  endReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceSessionSchema = new Schema<IAttendanceSessionDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date },
    activeSeconds: { type: Number, default: 0 },
    idleSeconds: { type: Number, default: 0 },
    breakSeconds: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(SessionStatus), default: SessionStatus.ACTIVE },
    endReason: { type: String }
  },
  { timestamps: true }
);

AttendanceSessionSchema.index({ companyId: 1, employeeId: 1, startedAt: -1 });
AttendanceSessionSchema.index({ companyId: 1, status: 1 });

export const AttendanceSession = mongoose.model<IAttendanceSessionDocument>('AttendanceSession', AttendanceSessionSchema);
