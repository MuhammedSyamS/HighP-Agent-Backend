import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../shared';
import { config } from '../config';
import { User, IUserDocument } from '../models/User';
import { Device, IDeviceDocument } from '../models/Device';
import mongoose from 'mongoose';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
  companyId: string;
  employeeProfileId?: string;
}

export interface AuthenticatedDevice {
  deviceId: string;
  companyId: string;
  employeeId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      device?: AuthenticatedDevice;
      companyId?: string;
    }
  }
}

export const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
      role: UserRole;
      companyId: string;
      employeeProfileId?: string;
      type?: string;
    };

    if (decoded.type && decoded.type !== 'access') {
      res.status(401).json({ success: false, message: 'Invalid token type.' });
      return;
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
      employeeProfileId: decoded.employeeProfileId
    };
    req.companyId = decoded.companyId;

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

export const requireRoles = (roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required.' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' is not authorized for this resource.`
      });
      return;
    }

    next();
  };
};

export const authenticateAgent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Agent authorization required.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
      role: UserRole;
      companyId: string;
      employeeProfileId?: string;
      deviceId?: string;
    };

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId,
      employeeProfileId: decoded.employeeProfileId
    };
    req.companyId = decoded.companyId;

    if (decoded.deviceId) {
      req.device = {
        deviceId: decoded.deviceId,
        companyId: decoded.companyId,
        employeeId: decoded.employeeProfileId || ''
      };
    }

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired agent token.' });
  }
};
