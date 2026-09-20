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
exports.EmployeeProfile = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const shared_1 = require("@highp/shared");
const EmployeeProfileSchema = new mongoose_1.Schema({
    companyId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    employeeCode: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    managerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'EmployeeProfile' },
    currentSessionId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AttendanceSession' },
    currentDeviceId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Device' },
    currentStatus: { type: String, enum: Object.values(shared_1.ActivityState), default: shared_1.ActivityState.OFFLINE },
    currentApplication: { type: String, default: '' },
    lastActiveAt: { type: Date },
    lastHeartbeatAt: { type: Date },
    todayActiveSeconds: { type: Number, default: 0 },
    todayIdleSeconds: { type: Number, default: 0 },
    todayBreakSeconds: { type: Number, default: 0 },
    lastDateReset: { type: String }
}, { timestamps: true });
EmployeeProfileSchema.index({ companyId: 1, employeeCode: 1 }, { unique: true });
EmployeeProfileSchema.index({ companyId: 1, currentStatus: 1 });
EmployeeProfileSchema.index({ companyId: 1, managerId: 1 });
exports.EmployeeProfile = mongoose_1.default.model('EmployeeProfile', EmployeeProfileSchema);
