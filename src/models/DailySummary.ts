import mongoose, { Schema, Document } from 'mongoose';

export interface IDailySummaryApplication {
  applicationName: string;
  category: string;
  totalSeconds: number;
}

export interface IDailySummaryDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  firstSessionStart?: Date;
  lastSessionEnd?: Date;
  totalSessionSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  applicationUsage: IDailySummaryApplication[];
  createdAt: Date;
  updatedAt: Date;
}

const DailySummarySchema = new Schema<IDailySummaryDocument>(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'EmployeeProfile',
      required: true,
      index: true
    },
    date: {
      type: String,
      required: true,
      index: true
    },
    firstSessionStart: {
      type: Date
    },
    lastSessionEnd: {
      type: Date
    },
    totalSessionSeconds: {
      type: Number,
      default: 0
    },
    activeSeconds: {
      type: Number,
      default: 0
    },
    idleSeconds: {
      type: Number,
      default: 0
    },
    breakSeconds: {
      type: Number,
      default: 0
    },
    applicationUsage: [
      {
        applicationName: { type: String, required: true },
        category: { type: String, required: true },
        totalSeconds: { type: Number, required: true }
      }
    ]
  },
  {
    timestamps: true
  }
);

// Compound Unique Index: One daily summary per employee per date per company
DailySummarySchema.index({ companyId: 1, employeeId: 1, date: 1 }, { unique: true });
DailySummarySchema.index({ companyId: 1, date: 1 });

export const DailySummary = mongoose.model<IDailySummaryDocument>('DailySummary', DailySummarySchema);
