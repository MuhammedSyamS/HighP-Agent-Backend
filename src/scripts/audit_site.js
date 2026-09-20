const http = require('http');

async function testUrl(url, method = 'GET', headers = {}, body = null) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const elapsed = Date.now() - start;
    return { status: res.status, size: text.length, elapsed, ok: res.ok, text };
  } catch (err) {
    return { status: 0, size: 0, elapsed: Date.now() - start, ok: false, error: err.message };
  }
}

async function runAudit() {
  console.log('====================================================');
  console.log('🔍 HIGHPHAUS WORKFORCE PLATFORM - COMPREHENSIVE AUDIT');
  console.log('====================================================');

  const BASE_WEB = 'http://127.0.0.1:3000';
  const BASE_API = 'http://127.0.0.1:5000/api';

  // 1. Audit Web Routes
  console.log('\n[1/3] Auditing Web Portal Routes (Next.js):');
  const routes = [
    '/',
    '/login',
    '/dashboard',
    '/dashboard/applications',
    '/dashboard/reports',
    '/dashboard/devices',
    '/dashboard/settings',
    '/employee',
    '/employee/monitoring'
  ];

  for (const route of routes) {
    const r = await testUrl(BASE_WEB + route);
    const label = route.padEnd(25);
    if (r.ok) {
      console.log(`  ✅ ${label} -> HTTP ${r.status} (${(r.size / 1024).toFixed(1)} KB) in ${r.elapsed}ms`);
    } else {
      console.log(`  ❌ ${label} -> HTTP ${r.status} (${r.error || 'Error'}) in ${r.elapsed}ms`);
    }
  }

  // 2. Audit Auth Flow
  console.log('\n[2/3] Auditing Authentication & Tokens:');
  const loginRes = await testUrl(BASE_API + '/auth/login', 'POST', { 'Content-Type': 'application/json' }, {
    email: 'admin@highphaus.com',
    password: 'Password@123'
  });

  if (!loginRes.ok) {
    console.log(`  ❌ Admin Login Failed: ${loginRes.text}`);
    return;
  }

  const loginData = JSON.parse(loginRes.text);
  console.log(`  ✅ Admin Login Successful in ${loginRes.elapsed}ms (User: ${loginData.data.user.email}, Role: ${loginData.data.user.role})`);
  const token = loginData.data.tokens.accessToken;
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 3. Audit REST API Endpoints
  console.log('\n[3/3] Auditing API Endpoints:');
  const apiEndpoints = [
    { name: 'GET /api/auth/me', url: '/auth/me' },
    { name: 'GET /api/employees', url: '/employees' },
    { name: 'GET /api/employees/overview', url: '/employees/overview' },
    { name: 'GET /api/applications/usage', url: '/applications/usage' },
    { name: 'GET /api/reports/daily', url: '/reports/daily' },
    { name: 'GET /api/reports/weekly', url: '/reports/weekly' },
    { name: 'GET /api/reports/monthly', url: '/reports/monthly' },
    { name: 'GET /api/reports/export (CSV)', url: '/reports/export?type=daily' },
    { name: 'GET /api/devices', url: '/devices' },
    { name: 'GET /api/company', url: '/company' },
    { name: 'GET /api/settings', url: '/settings' },
    { name: 'GET /api/audit-logs', url: '/audit-logs' },
    { name: 'GET /api/attendance', url: '/attendance' },
    { name: 'GET /api/breaks', url: '/breaks' }
  ];

  for (const ep of apiEndpoints) {
    const r = await testUrl(BASE_API + ep.url, 'GET', authHeaders);
    const label = ep.name.padEnd(30);
    if (r.ok) {
      console.log(`  ✅ ${label} -> HTTP ${r.status} (${(r.size / 1024).toFixed(1)} KB) in ${r.elapsed}ms`);
    } else {
      console.log(`  ❌ ${label} -> HTTP ${r.status} in ${r.elapsed}ms: ${r.text}`);
    }
  }

  console.log('\n====================================================');
  console.log('🎉 AUDIT COMPLETE: ALL CHECKS FINISHED');
  console.log('====================================================\n');
}

runAudit();
