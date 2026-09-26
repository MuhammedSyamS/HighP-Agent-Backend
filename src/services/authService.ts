import jwt from 'jsonwebtoken';
import { UserRole, UserStatus, SubscriptionTier, SubscriptionStatus } from '../shared';
import { config } from '../config';
import { User, IUserDocument } from '../models/User';
import { Company, ICompanyDocument } from '../models/Company';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { Subscription } from '../models/Subscription';
import { AppError } from '../middleware/errorHandler';

interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  companyId: string;
  employeeProfileId?: string;
  type?: 'access' | 'refresh';
}

export const generateTokens = (user: IUserDocument) => {
  const payload: TokenPayload = {
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
    companyId: user.companyId.toString(),
    employeeProfileId: user.employeeProfileId?.toString(),
    type: 'access'
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as any
  });

  const refreshPayload: TokenPayload = {
    ...payload,
    type: 'refresh'
  };

  const refreshToken = jwt.sign(refreshPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as any
  });

  return { accessToken, refreshToken };
};

export const registerCompany = async (data: {
  companyName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) => {
  const existingUser = await User.findOne({ email: data.email.toLowerCase() });
  if (existingUser) {
    throw new AppError('An account with this email address already exists.', 409);
  }

  // Generate unique slug
  let baseSlug = data.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  if (baseSlug.length < 2) baseSlug = 'company';
  let slug = baseSlug;
  let counter = 1;
  while (await Company.findOne({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }

  // Create Company
  const company = await Company.create({
    name: data.companyName,
    slug
  });

  // Create HR Owner User
  const user = new User({
    email: data.email.toLowerCase(),
    passwordHash: data.password,
    firstName: data.firstName,
    lastName: data.lastName,
    role: UserRole.HR,
    companyId: company._id,
    status: UserStatus.ACTIVE
  });
  await user.save();

  // Link Owner to Company
  company.ownerId = user._id;
  await company.save();

  // Create Owner Employee Profile
  const profile = await EmployeeProfile.create({
    companyId: company._id,
    userId: user._id,
    employeeCode: 'EMP-001',
    department: 'Human Resources & People Operations',
    designation: 'Head of Human Resources (HR)'
  });

  user.employeeProfileId = profile._id;
  await user.save();

  // Create Default Trial Subscription
  await Subscription.create({
    companyId: company._id,
    tier: SubscriptionTier.TRIAL,
    status: SubscriptionStatus.TRIALING,
    maxEmployees: 25,
    features: ['live_dashboard', 'application_tracking', 'reports', 'csv_export', 'device_management']
  });

  const tokens = generateTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save();

  return {
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
      employeeProfileId: user.employeeProfileId
    },
    company: {
      id: company._id,
      name: company.name,
      slug: company.slug
    },
    tokens
  };
};

export const registerEmployee = async (data: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  department?: string;
  designation?: string;
  companySlug?: string;
}) => {
  const existingUser = await User.findOne({ email: data.email.toLowerCase() });
  if (existingUser) {
    throw new AppError('An account with this email address already exists.', 409);
  }

  let company = null;
  if (data.companySlug) {
    company = await Company.findOne({ slug: data.companySlug.toLowerCase() });
  }
  if (!company) {
    company = await Company.findOne().sort({ createdAt: 1 });
  }
  if (!company) {
    company = await Company.create({
      name: 'Highphaus Creative Agency',
      slug: 'highphaus'
    });
  }

  const count = await EmployeeProfile.countDocuments({ companyId: company._id });
  const employeeCode = `HP-${String(count + 1).padStart(3, '0')}`;

  const user = new User({
    email: data.email.toLowerCase(),
    passwordHash: data.password,
    firstName: data.firstName,
    lastName: data.lastName,
    role: UserRole.EMPLOYEE,
    companyId: company._id,
    status: UserStatus.ACTIVE
  });
  await user.save();

  const profile = await EmployeeProfile.create({
    companyId: company._id,
    userId: user._id,
    employeeCode,
    department: data.department || 'General',
    designation: data.designation || 'Team Member'
  });

  user.employeeProfileId = profile._id;
  await user.save();

  const tokens = generateTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save();

  return {
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
      employeeProfileId: user.employeeProfileId
    },
    company: {
      id: company._id,
      name: company.name,
      slug: company.slug
    },
    tokens,
    profile
  };
};

export const loginUser = async (data: { email: string; password: string }) => {
  const rawEmail = (data.email || '').toLowerCase().trim();
  
  // 1. Direct match by exact email
  let user: any = await User.findOne({ email: rawEmail }).select('+passwordHash +refreshToken');

  // 2. If not found, resolve aliases (e.g., admin, hr, shamsaifudheen, highphaus)
  if (!user) {
    if (rawEmail === 'admin' || rawEmail === 'hr' || rawEmail.includes('sham')) {
      user = await User.findOne({ email: 'shamsaifudheen@gmail.com' }).select('+passwordHash +refreshToken')
        || await User.findOne({ role: UserRole.HR }).select('+passwordHash +refreshToken');
    } else if (rawEmail === 'employee' || rawEmail.includes('highp')) {
      user = await User.findOne({ email: 'highphaus@gmail.com' }).select('+passwordHash +refreshToken')
        || await User.findOne({ role: UserRole.EMPLOYEE }).select('+passwordHash +refreshToken');
    } else if (!rawEmail.includes('@')) {
      user = await User.findOne({ email: new RegExp('^' + rawEmail, 'i') }).select('+passwordHash +refreshToken');
    }
  }

  if (!user) {
    throw new AppError('Invalid email or password. Please verify your credentials.', 401);
  }

  if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.INACTIVE) {
    throw new AppError('Account is inactive or suspended. Please contact administrator.', 403);
  }

  const isMatch = await user.comparePassword(data.password);
  if (!isMatch) {
    throw new AppError('Invalid email or password. Please verify your credentials.', 401);
  }

  const company = await Company.findById(user.companyId);
  if (!company) {
    throw new AppError('Associated company not found.', 404);
  }

  const tokens = generateTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save();

  let profile = null;
  if (user.employeeProfileId) {
    profile = await EmployeeProfile.findById(user.employeeProfileId);
  }
  if (!profile) {
    profile = await EmployeeProfile.findOne({ userId: user._id });
  }

  return {
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
      employeeProfileId: user.employeeProfileId
    },
    company: {
      id: company._id,
      name: company.name,
      slug: company.slug,
      config: company.config
    },
    tokens,
    profile
  };
};

export const refreshAccessToken = async (refreshToken: string) => {
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as TokenPayload;
    const user = await User.findById(decoded.userId).select('+refreshToken');
    if (!user || user.refreshToken !== refreshToken) {
      throw new AppError('Invalid or expired refresh token.', 401);
    }

    const tokens = generateTokens(user);
    user.refreshToken = tokens.refreshToken;
    await user.save();

    return tokens;
  } catch (error) {
    throw new AppError('Invalid refresh token.', 401);
  }
};
