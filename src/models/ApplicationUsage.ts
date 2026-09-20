import mongoose, { Schema, Document } from 'mongoose';

export interface IApplicationUsageDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  date: string; // "YYYY-MM-DD"
  applicationName: string;
  category: string;
  totalSeconds: number;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationUsageSchema = new Schema<IApplicationUsageDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    applicationName: { type: String, required: true, trim: true },
    category: { type: String, default: 'Other', trim: true },
    totalSeconds: { type: Number, default: 0, min: 0 },
    lastUsedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

ApplicationUsageSchema.index({ companyId: 1, employeeId: 1, date: 1, applicationName: 1 }, { unique: true });
ApplicationUsageSchema.index({ companyId: 1, date: 1, totalSeconds: -1 });
ApplicationUsageSchema.index({ companyId: 1, applicationName: 1, totalSeconds: -1 });

export const ApplicationUsage = mongoose.model<IApplicationUsageDocument>('ApplicationUsage', ApplicationUsageSchema);
