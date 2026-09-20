import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { registerCompany, loginUser } from '../src/services/authService';
import { UserRole } from '../src/shared';
import { setupTestDatabase, teardownTestDatabase } from './testDb';

let app: any;

let adminToken: string;
let employee1Token: string;
let employee2Token: string;
let employee1Id: string;
let employee2Id: string;

beforeAll(async () => {
  await setupTestDatabase();
  app = createApp();

  // Register company with Owner/Admin
  const res = await registerCompany({
    companyName: 'Highphaus Test Agency',
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@testagency.com',
    password: 'Password@123'
  });
  adminToken = res.tokens.accessToken;

  // Create Employee 1
  const emp1Res = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      email: 'emp1@testagency.com',
      firstName: 'Emp',
      lastName: 'One',
      password: 'Password@123',
      role: UserRole.EMPLOYEE,
      employeeCode: 'EMP-01',
      department: 'Design',
      designation: 'UI/UX Designer'
    });
  employee1Id = emp1Res.body.data.profile._id;

  const emp1Login = await loginUser({ email: 'emp1@testagency.com', password: 'Password@123' });
  employee1Token = emp1Login.tokens.accessToken;

  // Create Employee 2
  const emp2Res = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      email: 'emp2@testagency.com',
      firstName: 'Emp',
      lastName: 'Two',
      password: 'Password@123',
      role: UserRole.EMPLOYEE,
      employeeCode: 'EMP-02',
      department: 'Engineering',
      designation: 'Full Stack Engineer'
    });
  employee2Id = emp2Res.body.data.profile._id;

  const emp2Login = await loginUser({ email: 'emp2@testagency.com', password: 'Password@123' });
  employee2Token = emp2Login.tokens.accessToken;
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe('Authentication & Access Control (RBAC)', () => {
  it('should successfully log in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@testagency.com', password: 'Password@123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    expect(res.body.data.user.role).toBe(UserRole.OWNER);
  });

  it('should reject login with invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@testagency.com', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should reject access to protected routes without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should reject access with a malformed/invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token-sample');
    expect(res.status).toBe(401);
  });

  it('Employee should NOT be allowed to access admin-only settings', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('Authorization', `Bearer ${employee1Token}`)
      .send({ idleThresholdMinutes: 10 });

    expect(res.status).toBe(403);
  });

  it('Employee should NOT be allowed to view company audit logs', async () => {
    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${employee1Token}`);

    expect(res.status).toBe(403);
  });

  it('Employee should NOT be able to view another employee profile directly', async () => {
    const res = await request(app)
      .get(`/api/employees/${employee2Id}`)
      .set('Authorization', `Bearer ${employee1Token}`);

    // Non-manager employee accessing another employee returns 403 Forbidden
    expect(res.status).toBe(403);
  });

  it('Employee CAN view their own profile and authenticated info', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${employee1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('emp1@testagency.com');
  });
});
