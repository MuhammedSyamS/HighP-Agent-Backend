import mongoose, { Schema, Document } from 'mongoose';
import { SubscriptionTier, SubscriptionStatus } from '@highp/shared';

export interface ISubscriptionDocument extends Document {
  companyId: mongoose.Types.ObjectId;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  maxEmployees: number;
  features: string[];
  trialEndsAt?: Date;
  currentPeriodEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscriptionDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
    tier: { type: String, enum: Object.values(SubscriptionTier), default: SubscriptionTier.TRIAL },
    status: { type: String, enum: Object.values(SubscriptionStatus), default: SubscriptionStatus.TRIALING },
    maxEmployees: { type: Number, default: 25 },
    features: [{ type: String }],
    trialEndsAt: { type: Date, default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) }, // 14-day trial
    currentPeriodEnd: { type: Date }
  },
  { timestamps: true }
);

export const Subscription = mongoose.model<ISubscriptionDocument>('Subscription', SubscriptionSchema);
