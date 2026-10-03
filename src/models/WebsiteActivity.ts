import mongoose, { Schema, Document } from 'mongoose';

export interface IWebsiteActivityDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  sessionId?: mongoose.Types.ObjectId;
  browser: string;
  domain: string;
  date: string; // YYYY-MM-DD
  totalSeconds: number;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebsiteActivitySchema = new Schema<IWebsiteActivityDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AttendanceSession', index: true },
    browser: { type: String, required: true, trim: true },
    domain: { type: String, required: true, trim: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    totalSeconds: { type: Number, default: 0, min: 0 },
    lastUsedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

WebsiteActivitySchema.index({ companyId: 1, employeeId: 1, date: 1, domain: 1 }, { unique: true });
WebsiteActivitySchema.index({ companyId: 1, date: 1, totalSeconds: -1 });
WebsiteActivitySchema.index({ companyId: 1, domain: 1, totalSeconds: -1 });

export const WebsiteActivity = mongoose.model<IWebsiteActivityDocument>('WebsiteActivity', WebsiteActivitySchema);
