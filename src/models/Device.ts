import mongoose, { Schema, Document } from 'mongoose';
import { DeviceStatus } from '@highp/shared';

export interface IDeviceDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
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
  lastHeartbeatAt: Date;
  lastIpAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceSchema = new Schema<IDeviceDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    deviceId: { type: String, required: true, trim: true },
    deviceName: { type: String, required: true, trim: true },
    osInfo: {
      platform: { type: String, default: 'win32' },
      release: { type: String, default: '' },
      arch: { type: String, default: 'x64' },
      hostname: { type: String, default: '' }
    },
    agentVersion: { type: String, default: '1.0.0' },
    status: { type: String, enum: Object.values(DeviceStatus), default: DeviceStatus.ACTIVE },
    lastHeartbeatAt: { type: Date, default: Date.now },
    lastIpAddress: { type: String }
  },
  { timestamps: true }
);

DeviceSchema.index({ companyId: 1, deviceId: 1 }, { unique: true });
DeviceSchema.index({ companyId: 1, employeeId: 1 });

export const Device = mongoose.model<IDeviceDocument>('Device', DeviceSchema);
