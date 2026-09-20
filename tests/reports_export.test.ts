import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { registerCompany, loginUser } from '../src/services/authService';
import { UserRole } from '../src/shared';
import { setupTestDatabase, teardownTestDatabase } from './testDb';

let app: any;
let adminToken: string;
let employeeToken: string;

beforeAll(async () => {
  await setupTestDatabase();
  app = createApp();

  const res = await registerCompany({
    companyName: 'Highphaus Report Agency',
    firstName: 'Report',
    lastName: 'Admin',
    email: 'admin@reportagency.com',
    password: 'Password@123'
  });
  adminToken = res.tokens.accessToken;

  await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      email: 'maya@reportagency.com',
      firstName: 'Maya',
      lastName: 'Strategist',
      password: 'Password@123',
      role: UserRole.EMPLOYEE,
      employeeCode: 'EMP-MAYA',
      department: 'Marketing',
      designation: 'Campaign Strategist'
    });

  const empLogin = await loginUser({ email: 'maya@reportagency.com', password: 'Password@123' });
  employeeToken = empLogin.tokens.accessToken;
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe('Reports & CSV Export Security', () => {
  it('Manager/Admin can retrieve daily reports', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reports/daily?date=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Employees cannot retrieve reports (403 Forbidden)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reports/daily?date=${today}`)
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('Manager/Admin can export daily reports as CSV', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reports/export?type=daily&date=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Employee Code,Employee Name,Department');
  });

  it('Employees cannot export CSV reports (403 Forbidden)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reports/export?type=daily&date=${today}`)
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(403);
  });
});
