"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateAgent = exports.requireRoles = exports.authenticateUser = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
            return;
        }
        const token = authHeader.split(' ')[1];
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
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
    }
    catch (error) {
        res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
};
exports.authenticateUser = authenticateUser;
const requireRoles = (roles) => {
    return (req, res, next) => {
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
exports.requireRoles = requireRoles;
const authenticateAgent = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ success: false, message: 'Agent authorization required.' });
            return;
        }
        const token = authHeader.split(' ')[1];
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
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
    }
    catch (error) {
        res.status(401).json({ success: false, message: 'Invalid or expired agent token.' });
    }
};
exports.authenticateAgent = authenticateAgent;
