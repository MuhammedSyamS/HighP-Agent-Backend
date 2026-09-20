import mongoose from 'mongoose';
import { AuditLog } from '../models/AuditLog';

export const logAudit = async (params: {
  companyId: string;
  userId?: string;
  action: string;
  resource: string;
  details?: Record<string, any>;
  ipAddress?: string;
}) => {
  try {
    await AuditLog.create({
      companyId: new mongoose.Types.ObjectId(params.companyId),
      ...(params.userId && { userId: new mongoose.Types.ObjectId(params.userId) }),
      action: params.action,
      resource: params.resource,
      details: params.details,
      ipAddress: params.ipAddress,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('[AuditService] Error logging audit action:', err);
  }
};
