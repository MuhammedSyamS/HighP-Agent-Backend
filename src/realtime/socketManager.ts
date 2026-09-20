import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UserRole, ActivityState } from '@highp/shared';

interface AuthenticatedSocket extends Socket {
  user?: {
    userId: string;
    email: string;
    role: UserRole;
    companyId: string;
    employeeProfileId?: string;
  };
}

let ioInstance: SocketIOServer | null = null;

export const initializeSocket = (httpServer: HttpServer): SocketIOServer => {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*', // Controlled by environment in production
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingInterval: 25000,
    pingTimeout: 20000
  });

  // Socket Authentication Middleware
  io.use((socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, config.jwt.secret) as {
        userId: string;
        email: string;
        role: UserRole;
        companyId: string;
        employeeProfileId?: string;
      };

      socket.user = decoded;
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
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

export const getSocketServer = (): SocketIOServer | null => {
  return ioInstance;
};

export const emitToCompany = (companyId: string, event: string, data: any): void => {
  if (ioInstance) {
    ioInstance.to(`company:${companyId}`).emit(event, data);
  }
};

export const emitToEmployee = (employeeId: string, event: string, data: any): void => {
  if (ioInstance) {
    ioInstance.to(`employee:${employeeId}`).emit(event, data);
  }
};
