import mongoose, { Schema, Document } from 'mongoose';
import { ActivityState } from '@highp/shared';

export interface IEmployeeProfileDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  employeeCode: string;
  department: string;
  designation: string;
  managerId?: mongoose.Types.ObjectId;
  currentSessionId?: mongoose.Types.ObjectId;
  currentDeviceId?: mongoose.Types.ObjectId;
  currentStatus: ActivityState;
  currentApplication?: string;
  lastActiveAt?: Date;
  lastHeartbeatAt?: Date;
  todayActiveSeconds: number;
  todayIdleSeconds: number;
  todayBreakSeconds: number;
  lastDateReset?: string; // "YYYY-MM-DD"
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeProfileSchema = new Schema<IEmployeeProfileDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    employeeCode: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile' },
    currentSessionId: { type: Schema.Types.ObjectId, ref: 'AttendanceSession' },
    currentDeviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    currentStatus: { type: String, enum: Object.values(ActivityState), default: ActivityState.OFFLINE },
    currentApplication: { type: String, default: '' },
    lastActiveAt: { type: Date },
    lastHeartbeatAt: { type: Date },
    todayActiveSeconds: { type: Number, default: 0 },
    todayIdleSeconds: { type: Number, default: 0 },
    todayBreakSeconds: { type: Number, default: 0 },
    lastDateReset: { type: String }
  },
  { timestamps: true }
);

EmployeeProfileSchema.index({ companyId: 1, employeeCode: 1 }, { unique: true });
EmployeeProfileSchema.index({ companyId: 1, currentStatus: 1 });
EmployeeProfileSchema.index({ companyId: 1, managerId: 1 });

export const EmployeeProfile = mongoose.model<IEmployeeProfileDocument>('EmployeeProfile', EmployeeProfileSchema);
