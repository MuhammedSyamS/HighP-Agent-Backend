import mongoose, { Schema, Document } from 'mongoose';

export interface IDiscoveredApplicationDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  executableName: string;
  executablePath?: string;
  windowTitle?: string;
  detectedTimes: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSeenByEmployeeId?: mongoose.Types.ObjectId;
  status: 'DISCOVERED' | 'TRACKED' | 'IGNORED';
  createdAt: Date;
  updatedAt: Date;
}

const DiscoveredApplicationSchema = new Schema<IDiscoveredApplicationDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    executableName: { type: String, required: true, trim: true, lowercase: true },
    executablePath: { type: String, trim: true },
    windowTitle: { type: String, trim: true },
    detectedTimes: { type: Number, default: 1, min: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    lastSeenByEmployeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile' },
    status: {
      type: String,
      enum: ['DISCOVERED', 'TRACKED', 'IGNORED'],
      default: 'DISCOVERED',
      index: true
    }
  },
  { timestamps: true }
);

DiscoveredApplicationSchema.index({ companyId: 1, executableName: 1 }, { unique: true });
DiscoveredApplicationSchema.index({ companyId: 1, status: 1 });

export const DiscoveredApplication = mongoose.model<IDiscoveredApplicationDocument>(
  'DiscoveredApplication',
  DiscoveredApplicationSchema
);
