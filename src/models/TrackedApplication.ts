import mongoose, { Schema, Document } from 'mongoose';

export interface ITrackedApplicationDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  name: string;
  executableNames: string[];
  executablePaths: string[];
  category: string;
  tracked: boolean;
  ignored: boolean;
  isSystemApp: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TrackedApplicationSchema = new Schema<ITrackedApplicationDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true },
    executableNames: [{ type: String, required: true, trim: true, lowercase: true }],
    executablePaths: [{ type: String, trim: true }],
    category: { type: String, required: true, default: 'Other', trim: true, index: true },
    tracked: { type: Boolean, default: true, index: true },
    ignored: { type: Boolean, default: false, index: true },
    isSystemApp: { type: Boolean, default: false }
  },
  { timestamps: true }
);

TrackedApplicationSchema.index({ companyId: 1, name: 1 });
TrackedApplicationSchema.index({ companyId: 1, executableNames: 1 });
TrackedApplicationSchema.index({ companyId: 1, tracked: 1 });

export const TrackedApplication = mongoose.model<ITrackedApplicationDocument>(
  'TrackedApplication',
  TrackedApplicationSchema
);
