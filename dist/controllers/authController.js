"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.logout = exports.getMe = exports.refresh = exports.login = exports.signup = exports.register = void 0;
const authService_1 = require("../services/authService");
const User_1 = require("../models/User");
const Company_1 = require("../models/Company");
const EmployeeProfile_1 = require("../models/EmployeeProfile");
const auditService_1 = require("../services/auditService");
const shared_1 = require("@highp/shared");
const register = async (req, res, next) => {
    try {
        const result = await (0, authService_1.registerCompany)(req.body);
        await (0, auditService_1.logAudit)({
            companyId: result.company.id.toString(),
            userId: result.user.id.toString(),
            action: shared_1.AuditAction.USER_LOGIN,
            resource: 'Auth',
            details: { email: result.user.email, type: 'registration' },
            ipAddress: req.ip
        });
        res.status(201).json({
            success: true,
            message: 'Company workspace registered successfully.',
            data: result
        });
    }
    catch (error) {
        next(error);
    }
};
exports.register = register;
const signup = async (req, res, next) => {
    try {
        const { registerEmployee } = await Promise.resolve().then(() => __importStar(require('../services/authService')));
        const result = await registerEmployee(req.body);
        await (0, auditService_1.logAudit)({
            companyId: result.company.id.toString(),
            userId: result.user.id.toString(),
            action: shared_1.AuditAction.USER_LOGIN,
            resource: 'Auth',
            details: { email: result.user.email, type: 'employee_signup' },
            ipAddress: req.ip
        });
        res.status(201).json({
            success: true,
            message: 'Employee account created successfully.',
            data: result
        });
    }
    catch (error) {
        next(error);
    }
};
exports.signup = signup;
const login = async (req, res, next) => {
    try {
        const result = await (0, authService_1.loginUser)(req.body);
        await (0, auditService_1.logAudit)({
            companyId: result.company.id.toString(),
            userId: result.user.id.toString(),
            action: shared_1.AuditAction.USER_LOGIN,
            resource: 'Auth',
            details: { email: result.user.email },
            ipAddress: req.ip
        });
        res.status(200).json({
            success: true,
            message: 'Login successful.',
            data: result
        });
    }
    catch (error) {
        next(error);
    }
};
exports.login = login;
const refresh = async (req, res, next) => {
    try {
        const tokens = await (0, authService_1.refreshAccessToken)(req.body.refreshToken);
        res.status(200).json({
            success: true,
            message: 'Token refreshed.',
            data: tokens
        });
    }
    catch (error) {
        next(error);
    }
};
exports.refresh = refresh;
const getMe = async (req, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }
        const user = await User_1.User.findById(req.user.userId);
        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }
        const company = await Company_1.Company.findById(user.companyId);
        let profile = null;
        if (user.employeeProfileId) {
            profile = await EmployeeProfile_1.EmployeeProfile.findById(user.employeeProfileId);
        }
        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    status: user.status
                },
                company: company
                    ? {
                        id: company._id,
                        name: company.name,
                        slug: company.slug,
                        config: company.config
                    }
                    : null,
                profile
            }
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getMe = getMe;
const logout = async (req, res, next) => {
    try {
        if (req.user) {
            await User_1.User.updateOne({ _id: req.user.userId }, { $unset: { refreshToken: 1 } });
            await (0, auditService_1.logAudit)({
                companyId: req.user.companyId,
                userId: req.user.userId,
                action: shared_1.AuditAction.USER_LOGOUT,
                resource: 'Auth',
                ipAddress: req.ip
            });
        }
        res.status(200).json({
            success: true,
            message: 'Logged out successfully.'
        });
    }
    catch (error) {
        next(error);
    }
};
exports.logout = logout;
