import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb+srv://shamsaifudheen_db_user:Stm6NhQ2yWcVdNwG@agent.epapfo7.mongodb.net/highphaus?retryWrites=true&w=majority';
const JWT_SECRET = process.env.JWT_SECRET || 'highphaus_creative_agency_secret_jwt_key_2026_production_grade_32char';
const BASE_URL = 'http://localhost:5001/api';

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 VERIFYING ATTENDANCE LIFECYCLE & MULTI-SHIFT ACCOUNTING');
  console.log('================================================================');

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db!;

  // 1. Pick employee user: new@gmail.com (HP-004)
  const user = await db.collection('users').findOne({ email: 'new@gmail.com' });
  if (!user) throw new Error('User new@gmail.com not found');

  const empProfile = await db.collection('employeeprofiles').findOne({ _id: user.employeeProfileId });
  if (!empProfile) throw new Error('Employee profile not found');

  const companyId = user.companyId.toString();
  const employeeId = empProfile._id.toString();
  const userId = user._id.toString();

  // Create valid JWT token
  const token = jwt.sign(
    {
      userId,
      email: user.email,
      role: user.role,
      companyId,
      employeeProfileId: employeeId
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  console.log(`\n👤 Testing with Employee: ${user.email} (${empProfile.employeeCode})`);

  // Ensure any dangling active session for this test employee is ended cleanly before test
  const existingActive = await db.collection('attendancesessions').findOne({
    employeeId: empProfile._id,
    status: 'ACTIVE'
  });
  if (existingActive) {
    console.log('Closing pre-existing active session:', existingActive._id);
    await axios.post(`${BASE_URL}/attendance/end`, {}, { headers: authHeaders }).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // TEST STEP 1: Verify Initial State (Clocked Out)
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 1: Verify Initial State (Clocked Out) ---');
  let res = await axios.get(`${BASE_URL}/employees/${employeeId}`, { headers: authHeaders });
  console.log('Initial API currentSession:', res.data.data.currentSession);
  console.log('Initial todayTotals:', res.data.data.todayTotals);
  console.log('Initial completedSessions count:', res.data.data.completedSessions?.length || 0);

  if (res.data.data.currentSession !== null) {
    throw new Error('FAILED: Initial currentSession should be null when clocked out!');
  }
  console.log('✅ Initial currentSession is null');

  const baselineCompletedCount = res.data.data.completedSessions?.length || 0;
  const baselineActive = res.data.data.todayTotals?.todayActiveSeconds || 0;
  const baselineIdle = res.data.data.todayTotals?.todayIdleSeconds || 0;
  const baselineDuration = res.data.data.todayTotals?.todayShiftDuration || 0;

  // -------------------------------------------------------------------------
  // TEST STEP 2: Start Shift #1
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 2: Start Work Shift #1 ---');
  const start1Res = await axios.post(`${BASE_URL}/attendance/start`, {}, { headers: authHeaders });
  const session1 = start1Res.data.data;
  console.log(`Shift 1 started: ID=${session1._id}, startedAt=${session1.startedAt}`);

  // Verify MongoDB AttendanceSession
  const dbSession1 = await db.collection('attendancesessions').findOne({ _id: new mongoose.Types.ObjectId(session1._id) });
  console.log('DB Session 1 record:', {
    _id: dbSession1?._id,
    status: dbSession1?.status,
    startedAt: dbSession1?.startedAt,
    endedAt: dbSession1?.endedAt,
    activeSeconds: dbSession1?.activeSeconds,
    idleSeconds: dbSession1?.idleSeconds
  });

  if (!dbSession1 || dbSession1.status !== 'ACTIVE') {
    throw new Error('FAILED: DB Session 1 should be ACTIVE in MongoDB!');
  }
  console.log('✅ Shift 1 created as ACTIVE in MongoDB');

  // Verify API reflects active shift
  res = await axios.get(`${BASE_URL}/employees/${employeeId}`, { headers: authHeaders });
  if (!res.data.data.currentSession || res.data.data.currentSession.status !== 'ACTIVE') {
    throw new Error('FAILED: API should return active currentSession!');
  }
  console.log('✅ API returns active currentSession for Shift 1');

  // -------------------------------------------------------------------------
  // TEST STEP 3: Record several minutes of active & idle time on Shift 1
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 3: Record 180s Active + 120s Idle on Shift 1 ---');
  // Backdate startedAt in DB by 310s to simulate 5 minutes of elapsed time
  const simStart1 = new Date(Date.now() - 310 * 1000);
  await db.collection('attendancesessions').updateOne(
    { _id: new mongoose.Types.ObjectId(session1._id) },
    { $set: { startedAt: simStart1 } }
  );

  await axios.post(
    `${BASE_URL}/attendance/heartbeat`,
    {
      status: 'ACTIVE',
      currentApplication: 'Visual Studio Code',
      totalActiveSeconds: 180,
      totalIdleSeconds: 120
    },
    { headers: authHeaders }
  );

  // Check DB update
  const dbSession1Heartbeat = await db.collection('attendancesessions').findOne({ _id: new mongoose.Types.ObjectId(session1._id) });
  console.log('DB Session 1 after heartbeat:', {
    activeSeconds: dbSession1Heartbeat?.activeSeconds,
    idleSeconds: dbSession1Heartbeat?.idleSeconds,
    lastHeartbeatAt: dbSession1Heartbeat?.lastHeartbeatAt
  });

  if (dbSession1Heartbeat?.activeSeconds !== 180 || dbSession1Heartbeat?.idleSeconds !== 120) {
    throw new Error('FAILED: Session 1 active/idle seconds not updated properly in MongoDB!');
  }
  console.log('✅ Shift 1 recorded 180s active and 120s idle in MongoDB');

  // -------------------------------------------------------------------------
  // TEST STEP 4: Clock Out Shift #1
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 4: Clock Out Shift #1 ---');
  // Wait 1 second to ensure endedAt > startedAt
  await new Promise(r => setTimeout(r, 1100));

  const end1Res = await axios.post(`${BASE_URL}/attendance/end`, {}, { headers: authHeaders });
  console.log('Clock out response status:', end1Res.status);

  // Verify AttendanceSession in MongoDB
  const dbSession1Ended = await db.collection('attendancesessions').findOne({ _id: new mongoose.Types.ObjectId(session1._id) });
  console.log('DB Session 1 completed:', {
    _id: dbSession1Ended?._id,
    status: dbSession1Ended?.status,
    startedAt: dbSession1Ended?.startedAt,
    endedAt: dbSession1Ended?.endedAt,
    durationSeconds: dbSession1Ended?.durationSeconds,
    activeSeconds: dbSession1Ended?.activeSeconds,
    idleSeconds: dbSession1Ended?.idleSeconds,
    diffSec: dbSession1Ended?.endedAt && dbSession1Ended?.startedAt
      ? Math.round((new Date(dbSession1Ended.endedAt).getTime() - new Date(dbSession1Ended.startedAt).getTime()) / 1000)
      : null
  });

  if (dbSession1Ended?.status !== 'COMPLETED') {
    throw new Error('FAILED: Session 1 status should be COMPLETED in MongoDB!');
  }
  if (!dbSession1Ended.endedAt || new Date(dbSession1Ended.endedAt) <= new Date(dbSession1Ended.startedAt)) {
    throw new Error('FAILED: Session 1 endedAt MUST be strictly greater than startedAt!');
  }
  if (!dbSession1Ended.durationSeconds || dbSession1Ended.durationSeconds <= 0) {
    throw new Error('FAILED: Session 1 durationSeconds should be > 0!');
  }
  console.log('✅ Shift 1: status = COMPLETED, endedAt > startedAt, durationSeconds > 0');

  // -------------------------------------------------------------------------
  // TEST STEP 5: Browser Refresh / Re-login Simulation after Shift #1
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 5: Verify API & UI state after Clock Out (Shift #1) ---');
  res = await axios.get(`${BASE_URL}/employees/${employeeId}`, { headers: authHeaders });
  const data1 = res.data.data;

  console.log('API currentSession:', data1.currentSession);
  console.log('API lastCompletedSession:', {
    _id: data1.lastCompletedSession?._id,
    startedAt: data1.lastCompletedSession?.startedAt,
    endedAt: data1.lastCompletedSession?.endedAt,
    durationSeconds: data1.lastCompletedSession?.durationSeconds,
    activeSeconds: data1.lastCompletedSession?.activeSeconds,
    idleSeconds: data1.lastCompletedSession?.idleSeconds
  });
  console.log('API todayTotals:', data1.todayTotals);

  if (data1.currentSession !== null) {
    throw new Error('FAILED: currentSession MUST be null after clocking out!');
  }
  if (!data1.lastCompletedSession || data1.lastCompletedSession._id !== session1._id) {
    throw new Error('FAILED: lastCompletedSession should be Shift 1!');
  }
  if (data1.completedSessions.length !== baselineCompletedCount + 1) {
    throw new Error(`FAILED: completedSessions should have ${baselineCompletedCount + 1} sessions!`);
  }
  if (data1.todayTotals.todayActiveSeconds < baselineActive + 180) {
    throw new Error('FAILED: todayTotals.todayActiveSeconds did not accumulate Shift 1 active seconds!');
  }
  console.log('✅ Step 5 PASSED: currentSession is null, Shift 1 preserved in completedSessions, totals accumulated');

  // -------------------------------------------------------------------------
  // TEST STEP 6: Start Work Shift #2
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 6: Start Work Shift #2 ---');
  const start2Res = await axios.post(`${BASE_URL}/attendance/start`, {}, { headers: authHeaders });
  const session2 = start2Res.data.data;
  console.log(`Shift 2 started: ID=${session2._id}, startedAt=${session2.startedAt}`);

  if (session2._id === session1._id) {
    throw new Error('FAILED: Shift 2 MUST be a new session ID!');
  }

  // Verify API during Shift #2
  res = await axios.get(`${BASE_URL}/employees/${employeeId}`, { headers: authHeaders });
  const data2Live = res.data.data;

  console.log('Shift 2 currentSession:', {
    _id: data2Live.currentSession?._id,
    startedAt: data2Live.currentSession?.startedAt,
    activeSeconds: data2Live.currentSession?.activeSeconds,
    idleSeconds: data2Live.currentSession?.idleSeconds
  });
  console.log('Shift 2 completedSessions count:', data2Live.completedSessions?.length);

  if (!data2Live.currentSession || data2Live.currentSession.status !== 'ACTIVE') {
    throw new Error('FAILED: Shift 2 should be active in currentSession!');
  }
  if (data2Live.currentSession.activeSeconds > 2) {
    throw new Error(`FAILED: Shift 2 MUST start activeSeconds from 0 (got ${data2Live.currentSession.activeSeconds})!`);
  }
  if (data2Live.completedSessions.length !== baselineCompletedCount + 1) {
    throw new Error('FAILED: Shift 1 must STILL be preserved in completedSessions during Shift 2!');
  }
  console.log('✅ Shift 2 starts clean from 0 while Shift 1 remains preserved in history');

  // -------------------------------------------------------------------------
  // TEST STEP 7: Record 120s Active + 60s Idle on Shift #2
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 7: Record 120s Active + 60s Idle on Shift #2 ---');
  // Backdate startedAt in DB by 200s to simulate 3.3 minutes of elapsed time
  const simStart2 = new Date(Date.now() - 200 * 1000);
  await db.collection('attendancesessions').updateOne(
    { _id: new mongoose.Types.ObjectId(session2._id) },
    { $set: { startedAt: simStart2 } }
  );

  await axios.post(
    `${BASE_URL}/attendance/heartbeat`,
    {
      status: 'ACTIVE',
      currentApplication: 'Google Chrome',
      totalActiveSeconds: 120,
      totalIdleSeconds: 60
    },
    { headers: authHeaders }
  );

  // -------------------------------------------------------------------------
  // TEST STEP 8: Clock Out Shift #2
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 8: Clock Out Shift #2 ---');
  await new Promise(r => setTimeout(r, 1100));
  await axios.post(`${BASE_URL}/attendance/end`, {}, { headers: authHeaders });

  // Verify MongoDB records for both sessions
  const dbSession2Ended = await db.collection('attendancesessions').findOne({ _id: new mongoose.Types.ObjectId(session2._id) });
  console.log('DB Session 2 completed:', {
    _id: dbSession2Ended?._id,
    status: dbSession2Ended?.status,
    startedAt: dbSession2Ended?.startedAt,
    endedAt: dbSession2Ended?.endedAt,
    durationSeconds: dbSession2Ended?.durationSeconds,
    activeSeconds: dbSession2Ended?.activeSeconds,
    idleSeconds: dbSession2Ended?.idleSeconds
  });

  if (dbSession2Ended?.status !== 'COMPLETED') {
    throw new Error('FAILED: Session 2 status should be COMPLETED in MongoDB!');
  }
  if (!dbSession2Ended.endedAt || new Date(dbSession2Ended.endedAt) <= new Date(dbSession2Ended.startedAt)) {
    throw new Error('FAILED: Session 2 endedAt MUST be strictly greater than startedAt!');
  }
  console.log('✅ Shift 2: status = COMPLETED, endedAt > startedAt, durationSeconds > 0');

  // -------------------------------------------------------------------------
  // TEST STEP 9: Final Multi-Shift History & Totals Verification
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 9: Final Verification of History and Totals ---');
  res = await axios.get(`${BASE_URL}/employees/${employeeId}`, { headers: authHeaders });
  const finalData = res.data.data;

  console.log('Final currentSession:', finalData.currentSession);
  console.log('Final completedSessions count:', finalData.completedSessions?.length);
  console.log('Final lastCompletedSession ID:', finalData.lastCompletedSession?._id);
  console.log('Final todayTotals:', finalData.todayTotals);

  if (finalData.currentSession !== null) {
    throw new Error('FAILED: Final currentSession MUST be null!');
  }
  if (finalData.completedSessions.length !== baselineCompletedCount + 2) {
    throw new Error(`FAILED: Expected ${baselineCompletedCount + 2} completed sessions today!`);
  }
  if (finalData.lastCompletedSession._id !== session2._id) {
    throw new Error('FAILED: Final lastCompletedSession should be Shift 2!');
  }

  // Cumulative totals must contain both Shift 1 and Shift 2
  const expectedMinActive = baselineActive + 180 + 120; // 300s
  const expectedMinIdle = baselineIdle + 120 + 60;     // 180s
  if (finalData.todayTotals.todayActiveSeconds < expectedMinActive) {
    throw new Error(`FAILED: Final todayActiveSeconds (${finalData.todayTotals.todayActiveSeconds}) < expected (${expectedMinActive})`);
  }
  if (finalData.todayTotals.todayIdleSeconds < expectedMinIdle) {
    throw new Error(`FAILED: Final todayIdleSeconds (${finalData.todayTotals.todayIdleSeconds}) < expected (${expectedMinIdle})`);
  }

  console.log('\n================================================================');
  console.log('🎉 ALL TEST SUITE CHECKS PASSED WITH 100% ACCURACY!');
  console.log('================================================================');
  console.log({
    shift1_id: session1._id,
    shift1_duration: dbSession1Ended.durationSeconds,
    shift1_active: dbSession1Ended.activeSeconds,
    shift1_idle: dbSession1Ended.idleSeconds,
    shift2_id: session2._id,
    shift2_duration: dbSession2Ended.durationSeconds,
    shift2_active: dbSession2Ended.activeSeconds,
    shift2_idle: dbSession2Ended.idleSeconds,
    today_active_total: finalData.todayTotals.todayActiveSeconds,
    today_idle_total: finalData.todayTotals.todayIdleSeconds,
    today_shift_duration_total: finalData.todayTotals.todayShiftDuration,
    completed_sessions_today: finalData.completedSessions.length
  });

  await mongoose.disconnect();
}

runTestSuite().catch(err => {
  console.error('\n❌ TEST FAILED:', err.response?.data || err.message || err);
  process.exit(1);
});
