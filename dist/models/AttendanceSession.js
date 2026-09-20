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
exports.AttendanceSession = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const shared_1 = require("@highp/shared");
const AttendanceSessionSchema = new mongoose_1.Schema({
    companyId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employeeId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true },
    deviceId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Device' },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date },
    activeSeconds: { type: Number, default: 0 },
    idleSeconds: { type: Number, default: 0 },
    breakSeconds: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(shared_1.SessionStatus), default: shared_1.SessionStatus.ACTIVE },
    endReason: { type: String }
}, { timestamps: true });
AttendanceSessionSchema.index({ companyId: 1, employeeId: 1, startedAt: -1 });
AttendanceSessionSchema.index({ companyId: 1, status: 1 });
exports.AttendanceSession = mongoose_1.default.model('AttendanceSession', AttendanceSessionSchema);
