import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_APP_CATEGORIES, DEFAULT_HEARTBEAT_INTERVAL_SECONDS, DEFAULT_IDLE_THRESHOLD_MINUTES, DEFAULT_RETENTION_DAYS } from '@highp/shared';

export interface ICompanyDocument extends Document {
  name: string;
  slug: string;
  ownerId?: mongoose.Types.ObjectId;
  config: {
    idleThresholdMinutes: number;
    heartbeatIntervalSeconds: number;
    offlineSyncBatchLimit: number;
    retentionDays: number;
    allowManualBreaks: boolean;
    appCategories: Array<{
      name: string;
      color: string;
      apps: string[];
    }>;
    allowedTrackingHours?: {
      enabled: boolean;
      startTime: string;
      endTime: string;
      timezone: string;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new Schema<ICompanyDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    config: {
      idleThresholdMinutes: { type: Number, default: DEFAULT_IDLE_THRESHOLD_MINUTES },
      heartbeatIntervalSeconds: { type: Number, default: DEFAULT_HEARTBEAT_INTERVAL_SECONDS },
      offlineSyncBatchLimit: { type: Number, default: 100 },
      retentionDays: { type: Number, default: DEFAULT_RETENTION_DAYS },
      allowManualBreaks: { type: Boolean, default: true },
      appCategories: {
        type: [
          {
            name: { type: String, required: true },
            color: { type: String, required: true },
            apps: [{ type: String }]
          }
        ],
        default: DEFAULT_APP_CATEGORIES
      },
      allowedTrackingHours: {
        enabled: { type: Boolean, default: false },
        startTime: { type: String, default: '09:00' },
        endTime: { type: String, default: '18:00' },
        timezone: { type: String, default: 'UTC' }
      }
    }
  },
  { timestamps: true }
);

export const Company = mongoose.model<ICompanyDocument>('Company', CompanySchema);
