import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { Device } from '../models/Device';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditService';
import { AuditAction, UserStatus, UserRole, ActivityState, IDashboardOverview } from '@highp/shared';


export const getEmployees = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { department, status, search } = req.query;
    const query: any = { companyId: new mongoose.Types.ObjectId(req.companyId) };

    if (department) {
      query.department = department;
    }
    if (status) {
      query.currentStatus = status;
    }

    const profiles = await EmployeeProfile.find(query)
      .populate({
        path: 'userId',
        select: 'firstName lastName email role status'
      })
      .sort({ createdAt: -1 })
      .lean();

    // Filter by search term if provided
    let results = profiles;
    if (search && typeof search === 'string') {
      const term = search.toLowerCase();
      results = profiles.filter((p: any) => {
        const user = p.userId;
        const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.toLowerCase();
        const code = (p.employeeCode || '').toLowerCase();
        const email = (user?.email || '').toLowerCase();
        return fullName.includes(term) || code.includes(term) || email.includes(term);
      });
    }

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Employee not found', 404);
    }

    if (req.user?.role === UserRole.EMPLOYEE) {
      if (!req.user.employeeProfileId || req.user.employeeProfileId.toString() !== id) {
        throw new AppError('Forbidden: Employees can only view their own profile', 403);
      }
    }

    const profile = await EmployeeProfile.findOne({
      _id: new mongoose.Types.ObjectId(id),
      companyId: new mongoose.Types.ObjectId(req.companyId)
    })
      .populate({
        path: 'userId',
        select: 'firstName lastName email role status'
      })
      .populate('managerId', 'employeeCode')
      .lean();

    if (!profile) {
      throw new AppError('Employee not found', 404);
    }

    // Fetch active session if any
    let currentSession = null;
    if (profile.currentSessionId) {
      currentSession = await AttendanceSession.findById(profile.currentSessionId).lean();
    }

    // Fetch registered devices
    const devices = await Device.find({
      companyId: req.companyId,
      employeeId: profile._id
    }).lean();

    // Fetch today's top applications
    const todayStr = new Date().toISOString().slice(0, 10);
    const topApps = await ApplicationUsage.find({
      companyId: req.companyId,
      employeeId: profile._id,
      date: todayStr
    })
      .sort({ totalSeconds: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        profile,
        currentSession,
        devices,
        topApps
      }
    });
  } catch (error) {
    next(error);
  }
};

export const createEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, firstName, lastName, password = 'Password@123', role, employeeCode, department, designation, managerId } = req.body;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw new AppError('A user with this email already exists', 409);
    }

    const existingCode = await EmployeeProfile.findOne({
      companyId: req.companyId,
      employeeCode: employeeCode.trim()
    });
    if (existingCode) {
      throw new AppError(`Employee code '${employeeCode}' is already taken in your company.`, 409);
    }

    // Create User
    const user = new User({
      email: email.toLowerCase(),
      passwordHash: password,
      firstName,
      lastName,
      role,
      companyId: new mongoose.Types.ObjectId(req.companyId),
      status: UserStatus.ACTIVE
    });
    await user.save();

    // Create EmployeeProfile
    const profile = await EmployeeProfile.create({
      companyId: new mongoose.Types.ObjectId(req.companyId),
      userId: user._id,
      employeeCode: employeeCode.trim(),
      department: department.trim(),
      designation: designation.trim(),
      ...(managerId && { managerId: new mongoose.Types.ObjectId(managerId) })
    });

    user.employeeProfileId = profile._id;
    await user.save();

    await logAudit({
      companyId: req.companyId!,
      userId: req.user?.userId,
      action: AuditAction.EMPLOYEE_CREATED,
      resource: 'Employee',
      details: { employeeId: profile._id, email: user.email },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Employee created successfully.',
      data: {
        profile,
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { firstName, lastName, role, department, designation, managerId, status } = req.body;

    const profile = await EmployeeProfile.findOne({ _id: id, companyId: req.companyId });
    if (!profile) {
      throw new AppError('Employee not found', 404);
    }

    if (department !== undefined) profile.department = department;
    if (designation !== undefined) profile.designation = designation;
    if (managerId !== undefined) {
      profile.managerId = managerId ? new mongoose.Types.ObjectId(managerId) : undefined;
    }
    await profile.save();

    // Update corresponding User record
    const user = await User.findById(profile.userId);
    if (user) {
      if (firstName !== undefined) user.firstName = firstName;
      if (lastName !== undefined) user.lastName = lastName;
      if (role !== undefined) user.role = role;
      if (status !== undefined) user.status = status;
      await user.save();
    }

    await logAudit({
      companyId: req.companyId!,
      userId: req.user?.userId,
      action: AuditAction.EMPLOYEE_UPDATED,
      resource: 'Employee',
      details: { employeeId: profile._id },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Employee updated successfully.',
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

export const deleteEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const profile = await EmployeeProfile.findOne({ _id: id, companyId: req.companyId });
    if (!profile) {
      throw new AppError('Employee not found', 404);
    }

    // Soft delete / suspend user
    await User.updateOne({ _id: profile.userId }, { status: UserStatus.INACTIVE });

    await logAudit({
      companyId: req.companyId!,
      userId: req.user?.userId,
      action: AuditAction.EMPLOYEE_DELETED,
      resource: 'Employee',
      details: { employeeId: profile._id },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Employee marked as inactive.'
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboardOverview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const companyId = new mongoose.Types.ObjectId(req.companyId);

    const profiles = await EmployeeProfile.find({ companyId }).lean();
    const totalEmployees = profiles.length;

    let activeNow = 0;
    let idleNow = 0;
    let onBreakNow = 0;
    let offlineNow = 0;
    let totalActiveSecondsToday = 0;
    let totalIdleSecondsToday = 0;
    let totalBreakSecondsToday = 0;

    for (const p of profiles) {
      if (p.currentStatus === ActivityState.ACTIVE) activeNow++;
      else if (p.currentStatus === ActivityState.IDLE) idleNow++;
      else if (p.currentStatus === ActivityState.BREAK) onBreakNow++;
      else offlineNow++;

      totalActiveSecondsToday += p.todayActiveSeconds || 0;
      totalIdleSecondsToday += p.todayIdleSeconds || 0;
      totalBreakSecondsToday += p.todayBreakSeconds || 0;
    }

    const overview: IDashboardOverview = {
      totalEmployees,
      activeNow,
      idleNow,
      onBreakNow,
      offlineNow,
      currentlyWorking: activeNow + idleNow,
      totalActiveSecondsToday,
      totalIdleSecondsToday,
      totalBreakSecondsToday
    };

    res.status(200).json({
      success: true,
      data: overview
    });
  } catch (error) {
    next(error);
  }
};
