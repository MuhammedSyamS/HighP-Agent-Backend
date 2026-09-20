"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitToEmployee = exports.emitToCompany = exports.getSocketServer = exports.initializeSocket = void 0;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
let ioInstance = null;
const initializeSocket = (httpServer) => {
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: '*', // Controlled by environment in production
            methods: ['GET', 'POST'],
            credentials: true
        },
        pingInterval: 25000,
        pingTimeout: 20000
    });
    // Socket Authentication Middleware
    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth?.token || socket.handshake.query?.token;
            if (!token || typeof token !== 'string') {
                return next(new Error('Authentication error: No token provided'));
            }
            const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
            socket.user = decoded;
            next();
        }
        catch (error) {
            next(new Error('Authentication error: Invalid token'));
        }
    });
    io.on('connection', (socket) => {
        if (!socket.user) {
            socket.disconnect();
            return;
        }
        const { companyId, employeeProfileId, role, email } = socket.user;
        const companyRoom = `company:${companyId}`;
        socket.join(companyRoom);
        if (employeeProfileId) {
            socket.join(`employee:${employeeProfileId}`);
        }
        // console.log(`[Socket] Connected: ${email} (${role}) in ${companyRoom}`);
        socket.on('disconnect', () => {
            // Clean up if needed
        });
    });
    ioInstance = io;
    return io;
};
exports.initializeSocket = initializeSocket;
const getSocketServer = () => {
    return ioInstance;
};
exports.getSocketServer = getSocketServer;
const emitToCompany = (companyId, event, data) => {
    if (ioInstance) {
        ioInstance.to(`company:${companyId}`).emit(event, data);
    }
};
exports.emitToCompany = emitToCompany;
const emitToEmployee = (employeeId, event, data) => {
    if (ioInstance) {
        ioInstance.to(`employee:${employeeId}`).emit(event, data);
    }
};
exports.emitToEmployee = emitToEmployee;
