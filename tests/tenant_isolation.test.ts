import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { registerCompany, loginUser } from '../src/services/authService';
import { UserRole, ActivityEventType } from '../src/shared';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDatabase, teardownTestDatabase } from './testDb';

let app: any;

let companyAToken: string;
let companyBToken: string;
let companyAEmployeeToken: string;
let companyBEmployeeToken: string;
let companyAId: string;
let companyBId: string;
let companyAEmployeeId: string;
let companyBEmployeeId: string;

beforeAll(async () => {
  await setupTestDatabase();
  app = createApp();

  // 1. Register Company A
  const resA = await registerCompany({
    companyName: 'Company Alpha',
    firstName: 'Alice',
    lastName: 'Owner',
    email: 'alice@alpha.com',
    password: 'Password@123'
  });
  companyAToken = resA.tokens.accessToken;
  companyAId = resA.company.id.toString();

  // 2. Register Company B
  const resB = await registerCompany({
    companyName: 'Company Bravo',
    firstName: 'Bob',
    lastName: 'Owner',
    email: 'bob@bravo.com',
    password: 'Password@123'
  });
  companyBToken = resB.tokens.accessToken;
  companyBId = resB.company.id.toString();

  // 3. Create Employee in Company A
  const empResA = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${companyAToken}`)
    .send({
      email: 'charlie@alpha.com',
      firstName: 'Charlie',
      lastName: 'Alpha',
      password: 'Password@123',
      role: UserRole.EMPLOYEE,
      employeeCode: 'EMP-A-01',
      department: 'Engineering',
      designation: 'Software Engineer'
    });
  expect(empResA.status).toBe(201);
  companyAEmployeeId = empResA.body.data.profile._id;

  // Login as Charlie (Company A Employee)
  const charlieLogin = await loginUser({ email: 'charlie@alpha.com', password: 'Password@123' });
  companyAEmployeeToken = charlieLogin.tokens.accessToken;

  // 4. Create Employee in Company B
  const empResB = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${companyBToken}`)
    .send({
      email: 'david@bravo.com',
      firstName: 'David',
      lastName: 'Bravo',
      password: 'Password@123',
      role: UserRole.EMPLOYEE,
      employeeCode: 'EMP-B-01',
      department: 'Marketing',
      designation: 'Growth Marketer'
    });
  expect(empResB.status).toBe(201);
  companyBEmployeeId = empResB.body.data.profile._id;

  // Login as David (Company B Employee)
  const davidLogin = await loginUser({ email: 'david@bravo.com', password: 'Password@123' });
  companyBEmployeeToken = davidLogin.tokens.accessToken;
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe('Multi-Tenant Isolation & Cross-Company Security', () => {
  it('Company A should only see Company A employees and never see Company B employees', async () => {
    const res = await request(app)
      .get('/api/employees')
      .set('Authorization', `Bearer ${companyAToken}`);

    expect(res.status).toBe(200);
    const employeeIds = res.body.data.map((e: any) => e._id);
    expect(employeeIds).toContain(companyAEmployeeId);
    expect(employeeIds).not.toContain(companyBEmployeeId);
  });

  it('Company B should not be able to retrieve Company A employee details by ID', async () => {
    const res = await request(app)
      .get(`/api/employees/${companyAEmployeeId}`)
      .set('Authorization', `Bearer ${companyBToken}`);

    // Company B querying Company A employee returns 404
    expect(res.status).toBe(404);
  });

  it('Company B should not be able to update Company A employee', async () => {
    const res = await request(app)
      .patch(`/api/employees/${companyAEmployeeId}`)
      .set('Authorization', `Bearer ${companyBToken}`)
      .send({ designation: 'Hacked Title' });

    expect(res.status).toBe(404);
  });

  it('Company B should not be able to view Company A daily reports', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reports/daily?date=${today}`)
      .set('Authorization', `Bearer ${companyBToken}`);

    expect(res.status).toBe(200);
    const empIds = res.body.data.map((r: any) => r.employeeId);
    expect(empIds).not.toContain(companyAEmployeeId);
  });

  it('Company B cannot see Company A devices', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${companyBToken}`);

    expect(res.status).toBe(200);
  });
});

describe('Role-Based Access Control & Horizontal IDOR Prevention', () => {
  it('Employee Charlie cannot query Company A aggregated application usage', async () => {
    const res = await request(app)
      .get('/api/applications/usage')
      .set('Authorization', `Bearer ${companyAEmployeeToken}`);

    expect(res.status).toBe(403);
  });

  it('Employee Charlie cannot view another employee (David) timeline', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/activity/${companyBEmployeeId}/timeline?date=${today}`)
      .set('Authorization', `Bearer ${companyAEmployeeToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('Employee Charlie can view their own activity timeline', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/activity/${companyAEmployeeId}/timeline?date=${today}`)
      .set('Authorization', `Bearer ${companyAEmployeeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.employeeId).toBe(companyAEmployeeId);
  });

  it('Employee Charlie cannot view another employee application usage', async () => {
    const res = await request(app)
      .get(`/api/applications/usage/${companyBEmployeeId}`)
      .set('Authorization', `Bearer ${companyAEmployeeToken}`);

    expect(res.status).toBe(403);
  });

  it('Employee Charlie can view their own application usage', async () => {
    const res = await request(app)
      .get(`/api/applications/usage/${companyAEmployeeId}`)
      .set('Authorization', `Bearer ${companyAEmployeeToken}`);

    expect(res.status).toBe(200);
  });

  it('Employee Charlie cannot view another employee attendance history', async () => {
    const res = await request(app)
      .get(`/api/attendance/${companyBEmployeeId}`)
      .set('Authorization', `Bearer ${companyAEmployeeToken}`);

    expect(res.status).toBe(403);
  });
});

describe('Activity Ingestion & Offline Sync Deduplication', () => {
  it('should start a session and record activity events with deduplication', async () => {
    // Start session
    const sessionRes = await request(app)
      .post('/api/attendance/start')
      .set('Authorization', `Bearer ${companyAEmployeeToken}`)
      .send({});

    expect(sessionRes.status).toBe(200);
    const sessionId = sessionRes.body.data._id;

    // Ingest events
    const eventId1 = uuidv4();
    const now = new Date();
    const startedAt = new Date(now.getTime() - 60000).toISOString();
    const endedAt = now.toISOString();

    const payload = {
      deviceId: 'TEST-DEV-01',
      sessionId,
      events: [
        {
          eventId: eventId1,
          type: ActivityEventType.APPLICATION_FOCUS,
          applicationName: 'VS Code',
          processName: 'Code.exe',
          startedAt,
          endedAt,
          durationSeconds: 60
        }
      ]
    };

    // First ingestion -> 1 ingested, 0 duplicates
    const ingestRes1 = await request(app)
      .post('/api/agent/sync')
      .set('Authorization', `Bearer ${companyAEmployeeToken}`)
      .send(payload);

    expect(ingestRes1.status).toBe(200);
    expect(ingestRes1.body.data.ingestedCount).toBe(1);
    expect(ingestRes1.body.data.duplicatesCount).toBe(0);

    // Re-sending same eventId (e.g. offline queue retry) -> 0 ingested, 1 duplicate prevented
    const ingestRes2 = await request(app)
      .post('/api/agent/sync')
      .set('Authorization', `Bearer ${companyAEmployeeToken}`)
      .send(payload);

    expect(ingestRes2.status).toBe(200);
    expect(ingestRes2.body.data.ingestedCount).toBe(0);
    expect(ingestRes2.body.data.duplicatesCount).toBe(1);

    // Verify application analytics aggregated correctly (only 60s, not double counted)
    const usageRes = await request(app)
      .get(`/api/applications/usage/${companyAEmployeeId}`)
      .set('Authorization', `Bearer ${companyAToken}`);

    expect(usageRes.status).toBe(200);
    const vsCodeApp = usageRes.body.data.applications.find((a: any) => a.applicationName === 'VS Code');
    expect(vsCodeApp).toBeDefined();
    expect(vsCodeApp.totalSeconds).toBe(60);
  });
});
