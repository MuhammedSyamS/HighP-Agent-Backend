"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshAccessToken = exports.loginUser = exports.registerEmployee = exports.registerCompany = exports.generateTokens = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const shared_1 = require("@highp/shared");
const config_1 = require("../config");
const User_1 = require("../models/User");
const Company_1 = require("../models/Company");
const EmployeeProfile_1 = require("../models/EmployeeProfile");
const Subscription_1 = require("../models/Subscription");
const errorHandler_1 = require("../middleware/errorHandler");
const generateTokens = (user) => {
    const payload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        companyId: user.companyId.toString(),
        employeeProfileId: user.employeeProfileId?.toString(),
        type: 'access'
    };
    const accessToken = jsonwebtoken_1.default.sign(payload, config_1.config.jwt.secret, {
        expiresIn: config_1.config.jwt.expiresIn
    });
    const refreshPayload = {
        ...payload,
        type: 'refresh'
    };
    const refreshToken = jsonwebtoken_1.default.sign(refreshPayload, config_1.config.jwt.refreshSecret, {
        expiresIn: config_1.config.jwt.refreshExpiresIn
    });
    return { accessToken, refreshToken };
};
exports.generateTokens = generateTokens;
const registerCompany = async (data) => {
    const existingUser = await User_1.User.findOne({ email: data.email.toLowerCase() });
    if (existingUser) {
        throw new errorHandler_1.AppError('An account with this email address already exists.', 409);
    }
    // Generate unique slug
    let baseSlug = data.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    if (baseSlug.length < 2)
        baseSlug = 'company';
    let slug = baseSlug;
    let counter = 1;
    while (await Company_1.Company.findOne({ slug })) {
        slug = `${baseSlug}-${counter++}`;
    }
    // Create Company
    const company = await Company_1.Company.create({
        name: data.companyName,
        slug
    });
    // Create Owner User
    const user = new User_1.User({
        email: data.email.toLowerCase(),
        passwordHash: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        role: shared_1.UserRole.OWNER,
        companyId: company._id,
        status: shared_1.UserStatus.ACTIVE
    });
    await user.save();
    // Link Owner to Company
    company.ownerId = user._id;
    await company.save();
    // Create Owner Employee Profile
    const profile = await EmployeeProfile_1.EmployeeProfile.create({
        companyId: company._id,
        userId: user._id,
        employeeCode: 'EMP-001',
        department: 'Executive',
        designation: 'Company Owner / Founder'
    });
    user.employeeProfileId = profile._id;
    await user.save();
    // Create Default Trial Subscription
    await Subscription_1.Subscription.create({
        companyId: company._id,
        tier: shared_1.SubscriptionTier.TRIAL,
        status: shared_1.SubscriptionStatus.TRIALING,
        maxEmployees: 25,
        features: ['live_dashboard', 'application_tracking', 'reports', 'csv_export', 'device_management']
    });
    const tokens = (0, exports.generateTokens)(user);
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
exports.registerCompany = registerCompany;
const registerEmployee = async (data) => {
    const existingUser = await User_1.User.findOne({ email: data.email.toLowerCase() });
    if (existingUser) {
        throw new errorHandler_1.AppError('An account with this email address already exists.', 409);
    }
    let company = null;
    if (data.companySlug) {
        company = await Company_1.Company.findOne({ slug: data.companySlug.toLowerCase() });
    }
    if (!company) {
        company = await Company_1.Company.findOne().sort({ createdAt: 1 });
    }
    if (!company) {
        company = await Company_1.Company.create({
            name: 'Highphaus Creative Agency',
            slug: 'highphaus'
        });
    }
    const count = await EmployeeProfile_1.EmployeeProfile.countDocuments({ companyId: company._id });
    const employeeCode = `HP-${String(count + 1).padStart(3, '0')}`;
    const user = new User_1.User({
        email: data.email.toLowerCase(),
        passwordHash: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        role: shared_1.UserRole.EMPLOYEE,
        companyId: company._id,
        status: shared_1.UserStatus.ACTIVE
    });
    await user.save();
    const profile = await EmployeeProfile_1.EmployeeProfile.create({
        companyId: company._id,
        userId: user._id,
        employeeCode,
        department: data.department || 'General',
        designation: data.designation || 'Team Member'
    });
    user.employeeProfileId = profile._id;
    await user.save();
    const tokens = (0, exports.generateTokens)(user);
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
exports.registerEmployee = registerEmployee;
const loginUser = async (data) => {
    const user = await User_1.User.findOne({ email: data.email.toLowerCase() }).select('+passwordHash +refreshToken');
    if (!user) {
        throw new errorHandler_1.AppError('Invalid email or password.', 401);
    }
    if (user.status === shared_1.UserStatus.SUSPENDED || user.status === shared_1.UserStatus.INACTIVE) {
        throw new errorHandler_1.AppError('Account is inactive or suspended. Please contact administrator.', 403);
    }
    const isMatch = await user.comparePassword(data.password);
    if (!isMatch) {
        throw new errorHandler_1.AppError('Invalid email or password.', 401);
    }
    const company = await Company_1.Company.findById(user.companyId);
    if (!company) {
        throw new errorHandler_1.AppError('Associated company not found.', 404);
    }
    const tokens = (0, exports.generateTokens)(user);
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
            slug: company.slug,
            config: company.config
        },
        tokens
    };
};
exports.loginUser = loginUser;
const refreshAccessToken = async (refreshToken) => {
    try {
        const decoded = jsonwebtoken_1.default.verify(refreshToken, config_1.config.jwt.refreshSecret);
        const user = await User_1.User.findById(decoded.userId).select('+refreshToken');
        if (!user || user.refreshToken !== refreshToken) {
            throw new errorHandler_1.AppError('Invalid or expired refresh token.', 401);
        }
        const tokens = (0, exports.generateTokens)(user);
        user.refreshToken = tokens.refreshToken;
        await user.save();
        return tokens;
    }
    catch (error) {
        throw new errorHandler_1.AppError('Invalid refresh token.', 401);
    }
};
exports.refreshAccessToken = refreshAccessToken;
