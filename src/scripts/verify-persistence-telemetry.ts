import mongoose from 'mongoose';
import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';

const MONGODB_URI = 'mongodb+srv://shamsaifudheen_db_user:Stm6NhQ2yWcVdNwG@agent.epapfo7.mongodb.net/highphaus?retryWrites=true&w=majority';
const API_BASE = 'http://localhost:5000/api';

async function runVerification() {
  console.log('================================================================');
  console.log('HIGHP PRODUCTION TELEMETRY & PERSISTENCE FULL VERIFICATION TEST');
  console.log('================================================================');

  // 1. Connect to MongoDB
  console.log('\n--- 1. DIRECT MONGODB PERSISTENCE CHECK ---');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB Atlas: highphaus database');

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const EmployeeProfile = mongoose.model('EmployeeProfile', new mongoose.Schema({}, { strict: false }));
  const ActivityEvent = mongoose.model('ActivityEvent', new mongoose.Schema({}, { strict: false }));
  const ApplicationUsage = mongoose.model('ApplicationUsage', new mongoose.Schema({}, { strict: false }));

  const users = await User.find({}).lean();
  console.log(`Found ${users.length} registered users in DB:`);
  for (const u of users) {
    console.log(` - User ID: ${u._id}, Email: ${u.email}, Role: ${u.role}, ProfileID: ${u.employeeProfileId}, CompanyID: ${u.companyId}`);
  }

  const profiles = await EmployeeProfile.find({}).lean();
  console.log(`\nFound ${profiles.length} employee profiles in DB:`);
  for (const p of profiles) {
    console.log(` - Profile ID: ${p._id}, Code: ${p.employeeCode}, Dept: ${p.department}, Status: ${p.currentStatus}, App: ${p.currentApplication}, ActiveSec: ${p.todayActiveSeconds}`);
  }

  const eventCount = await ActivityEvent.countDocuments();
  console.log(`\nTotal ActivityEvent records in MongoDB: ${eventCount}`);

  const distinctAppsInEvents = await ActivityEvent.distinct('applicationName');
  console.log('Distinct Applications in ActivityEvent records:', distinctAppsInEvents);

  const usageCount = await ApplicationUsage.countDocuments();
  console.log(`\nTotal ApplicationUsage records in MongoDB: ${usageCount}`);
  const usages = await ApplicationUsage.find({}).sort({ totalSeconds: -1 }).lean();
  console.log('ApplicationUsage breakdown:');
  for (const u of usages) {
    console.log(` - App: ${u.applicationName.padEnd(25)} Date: ${u.date} TotalSeconds: ${u.totalSeconds}s (${Math.round(u.totalSeconds/60)}m) Employee: ${u.employeeId}`);
  }

  // 2. Test API Rehydration & Endpoints
  console.log('\n--- 2. API AUTH & REHYDRATION VERIFICATION ---');
  let token = null;
  try {
    const loginRes = await axios.post(`${API_BASE}/auth/login`, {
      email: 'shamsaifudheen@gmail.com',
      password: 'Password@123'
    });
    console.log('Login Status:', loginRes.status, '- Login Success:', loginRes.data.success);
    token = loginRes.data.data.tokens.accessToken;
    const user = loginRes.data.data.user;
    const profile = loginRes.data.data.profile;
    console.log('Returned User:', { id: user.id, email: user.email, role: user.role, companyId: user.companyId, employeeProfileId: user.employeeProfileId });
    console.log('Returned Profile ID:', profile?._id, 'Code:', profile?.employeeCode, 'ActiveSec:', profile?.todayActiveSeconds);

    // Call /auth/me to simulate page reload rehydration
    console.log('\nTesting /auth/me after simulated page reload...');
    const meRes = await axios.get(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('/auth/me Status:', meRes.status);
    const meUser = meRes.data.data.user;
    const meProfile = meRes.data.data.profile;
    console.log('Rehydrated User:', { id: meUser.id, email: meUser.email, companyId: meUser.companyId, employeeProfileId: meUser.employeeProfileId });
    console.log('Rehydrated Profile ID:', meProfile?._id, 'Status:', meProfile?.currentStatus, 'SessionId:', meProfile?.currentSessionId);

    // Call GET /api/activity
    const actRes = await axios.get(`${API_BASE}/activity?limit=5`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('GET /api/activity Status:', actRes.status, 'Results:', actRes.data.data.length);

    // Call GET /api/applications/usage
    const appRes = await axios.get(`${API_BASE}/applications/usage`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('GET /api/applications/usage Status:', appRes.status, 'TotalTimeOverall:', appRes.data.data.totalTimeOverall, 'AppCount:', appRes.data.data.applications.length);

    // Call employee timeline
    if (meProfile?._id) {
      const today = new Date().toISOString().slice(0, 10);
      const timeRes = await axios.get(`${API_BASE}/activity/${meProfile._id}/timeline?date=${today}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log(`GET /api/activity/${meProfile._id}/timeline Status:`, timeRes.status, 'Events today:', timeRes.data.data.events.length);
    }
  } catch (apiErr) {
    console.error('API Verification error:', apiErr.response?.data || apiErr.message);
  }

  // 3. Test Native Bridge Executable
  console.log('\n--- 3. WIN32 NATIVE BRIDGE STREAM / MULTI-APP TEST ---');
  const exePath = path.resolve(__dirname, '../../desktop-agent/bin/HighPTelemetryNative.exe');
  console.log('Testing native binary at:', exePath);

  await new Promise((resolve) => {
    const child = spawn(exePath, ['--stream'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let readyReceived = false;
    let sampleCount = 0;

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.includes('READY')) {
          readyReceived = true;
          console.log('Native bridge stream READY received. Requesting snapshots...');
          child.stdin.write('\n');
        } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            const parsed = JSON.parse(trimmed);
            console.log(`Snapshot #${++sampleCount}: hwnd=${parsed.hwnd}, pid=${parsed.processId}, executable="${parsed.executable}", title="${parsed.windowTitle?.slice(0, 40)}", idle=${parsed.idleSeconds}s`);
            if (sampleCount >= 2) {
              child.stdin.write('exit\n');
              child.kill();
              resolve(true);
            } else {
              setTimeout(() => {
                try { child.stdin.write('\n'); } catch {}
              }, 500);
            }
          } catch (e) {
            console.log('Parse err:', trimmed);
          }
        }
      }
    });

    child.stderr.on('data', (d) => console.error('Native stderr:', d.toString()));
    child.on('error', (e) => {
      console.error('Native bridge spawn error:', e);
      resolve(false);
    });

    setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(false);
    }, 4000);
  });

  await mongoose.disconnect();
  console.log('\n--- VERIFICATION COMPLETED ---');
}

runVerification().catch(console.error);
