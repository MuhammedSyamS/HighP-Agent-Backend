import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app';
import { registerCompany, loginUser } from '../src/services/authService';
import { UserRole, BreakReason, ActivityState, SessionStatus } from '@highp/shared';

let mongoServer: MongoMemoryServer;
let app: any;

let adminToken: string;
let employeeToken: string;
let employeeId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  app = createApp();

  const res = await registerCompany({
    companyName: 'Highphaus Session Agency',
    firstName: 'Session',
    lastName: 'Admin',
    email: 'admin@sessionagency.com',
    password: 'Password@123'
  });
  adminToken = res.tokens.accessToken;

  const empRes = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      email: 'alex@sessionagency.com',
      firstName: 'Alex',
      lastName: 'Designer',
      password: 'Password@123',
      role: UserRole.EMPLOYEE,
      employeeCode: 'EMP-ALEX',
      department: 'Creative',
      designation: 'Lead Designer'
    });
  employeeId = empRes.body.data.profile._id;

  const empLogin = await loginUser({ email: 'alex@sessionagency.com', password: 'Password@123' });
  employeeToken = empLogin.tokens.accessToken;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Work Session & Break Lifecycle', () => {
  it('should start a new work session', async () => {
    const res = await request(app)
      .post('/api/attendance/start')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(SessionStatus.ACTIVE);
    expect(res.body.data.startedAt).toBeDefined();
  });

  it('should start an official lunch break', async () => {
    const res = await request(app)
      .post('/api/breaks/start')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ reason: BreakReason.LUNCH });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reason).toBe(BreakReason.LUNCH);
    expect(res.body.data.endedAt).toBeFalsy();
  });

  it('should reject starting another break while a break is active', async () => {
    const res = await request(app)
      .post('/api/breaks/start')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ reason: BreakReason.COFFEE });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should end the active break', async () => {
    const res = await request(app)
      .post('/api/breaks/end')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.endedAt).toBeDefined();
    expect(res.body.data.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('should process agent heartbeat and update live presence status', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        deviceId: 'TEST-WIN-PC',
        sessionId: 'dummy-session-id',
        timestamp: new Date().toISOString(),
        status: ActivityState.ACTIVE,
        currentApplication: 'VS Code',
        idleSeconds: 0
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe(ActivityState.ACTIVE);
  });

  it('should end the work session and calculate authoritative totals', async () => {
    const res = await request(app)
      .post('/api/attendance/end')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(SessionStatus.COMPLETED);
    expect(res.body.data.endedAt).toBeDefined();
  });
});

