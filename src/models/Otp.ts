import mongoose, { Schema, Document } from 'mongoose';

export interface IOtpDocument extends Document {
  email: string;
  otp: string;
  purpose: 'LOGIN' | 'FORGOT_PASSWORD' | 'SIGNUP';
  expiresAt: Date;
  createdAt: Date;
}

const OtpSchema = new Schema<IOtpDocument>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    otp: { type: String, required: true, trim: true },
    purpose: { type: String, enum: ['LOGIN', 'FORGOT_PASSWORD', 'SIGNUP'], required: true },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

// TTL index on createdAt: document will automatically expire in 10 minutes (600 seconds)
OtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });
OtpSchema.index({ email: 1, purpose: 1 });

export const Otp = mongoose.model<IOtpDocument>('Otp', OtpSchema);
