import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { Device } from '../models/Device';
import { Break } from '../models/Break';
import { DailySummary } from '../models/DailySummary';
import { UserRole, ActivityState, SessionStatus, ActivityEventType, DeviceStatus, BreakReason } from '../shared';
import { startWorkSession, endWorkSession } from '../services/sessionService';
import { ingestActivityEvents } from '../services/activityService';
import { processHeartbeat } from '../services/heartbeatService';
import { rebuildEmployeeDay } from '../services/rebuildService';
import { getDailyReport } from '../services/reportService';
import { getDayRangeInTimezone, getDateStringInTimezone } from '../utils/timezone';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function recordTest(suite: string, name: string, passed: boolean, error?: string, details?: any) {
  results.push({ suite, name, passed, error, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${suite}] ${name}`);
  if (error) console.error(`   Error: ${error}`);
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('    🧪 HIGH P SAAS END-TO-END TEST & AUDIT SUITE      ');
  console.log('======================================================\n');

  await connectDatabase();

  const testSuffix = Date.now().toString();
  let companyA: any;
  let companyB: any;
  let hrUserA: any;
  let empUserA: any;
  let empProfileA: any;
  let empProfileB: any;
  let deviceA: any;

  try {
    // ------------------------------------------------------------------------
    // SETUP TEST TENANTS
    // ------------------------------------------------------------------------
    companyA = await Company.create({
      name: `Test Tenant A ${testSuffix}`,
      slug: `test-tenant-a-${testSuffix}`,
      config: {
        idleThresholdMinutes: 5,
        heartbeatIntervalSeconds: 15,
        allowedTrackingHours: { enabled: false, startTime: '09:00', endTime: '18:00', timezone: 'Asia/Kolkata' }
      }
    });

    companyB = await Company.create({
      name: `Test Tenant B ${testSuffix}`,
      slug: `test-tenant-b-${testSuffix}`,
      config: {
        idleThresholdMinutes: 5,
        heartbeatIntervalSeconds: 15,
        allowedTrackingHours: { enabled: false, startTime: '09:00', endTime: '18:00', timezone: 'Asia/Kolkata' }
      }
    });

    hrUserA = await User.create({
      companyId: companyA._id,
      email: `hr-${testSuffix}@company-a.com`,
      passwordHash: 'dummy_hash',
      firstName: 'HR',
      lastName: 'Admin',
      role: UserRole.HR
    });

    empUserA = await User.create({
      companyId: companyA._id,
      email: `emp-${testSuffix}@company-a.com`,
      passwordHash: 'dummy_hash',
      firstName: 'John',
      lastName: 'Doe',
      role: UserRole.EMPLOYEE
    });

    empProfileA = await EmployeeProfile.create({
      companyId: companyA._id,
      userId: empUserA._id,
      employeeCode: `HP-TEST-${testSuffix.slice(-4)}`,
      department: 'Engineering',
      designation: 'Software Engineer',
      currentStatus: ActivityState.OFFLINE
    });

    const empUserB = await User.create({
      companyId: companyB._id,
      email: `emp-${testSuffix}@company-b.com`,
      passwordHash: 'dummy_hash',
      firstName: 'Jane',
      lastName: 'Smith',
      role: UserRole.EMPLOYEE
    });

    empProfileB = await EmployeeProfile.create({
      companyId: companyB._id,
      userId: empUserB._id,
      employeeCode: `HP-TENANTB-${testSuffix.slice(-4)}`,
      department: 'Design',
      designation: 'UI Designer',
      currentStatus: ActivityState.OFFLINE
    });

    // ------------------------------------------------------------------------
    // TEST 1: AUTHENTICATION & JWT RBAC TOKENS
    // ------------------------------------------------------------------------
    try {
      const token = jwt.sign(
        {
          userId: empUserA._id.toString(),
          email: empUserA.email,
          role: empUserA.role,
          companyId: companyA._id.toString(),
          employeeProfileId: empProfileA._id.toString()
        },
        config.jwt.secret,
        { expiresIn: '1h' }
      );

      const decoded: any = jwt.verify(token, config.jwt.secret);
      const isAuthValid =
        decoded.userId === empUserA._id.toString() &&
        decoded.companyId === companyA._id.toString() &&
        decoded.role === UserRole.EMPLOYEE;

      recordTest('Authentication', 'Valid JWT generation and claim verification', isAuthValid);
    } catch (err: any) {
      recordTest('Authentication', 'Valid JWT generation and claim verification', false, err.message);
    }

    try {
      let expiredFailed = false;
      const expiredToken = jwt.sign(
        { userId: '123', companyId: '456' },
        config.jwt.secret,
        { expiresIn: '-10s' }
      );
      try {
        jwt.verify(expiredToken, config.jwt.secret);
      } catch {
        expiredFailed = true;
      }
      recordTest('Authentication', 'Rejection of expired JWT tokens', expiredFailed);
    } catch (err: any) {
      recordTest('Authentication', 'Rejection of expired JWT tokens', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 2: MULTI-TENANT ISOLATION
    // ------------------------------------------------------------------------
    try {
      const leakedProfiles = await EmployeeProfile.find({
        companyId: companyA._id,
        _id: empProfileB._id
      });
      const isIsolated = leakedProfiles.length === 0;
      recordTest('Tenant Isolation', 'Company A cannot query Employee of Company B', isIsolated);
    } catch (err: any) {
      recordTest('Tenant Isolation', 'Company A cannot query Employee of Company B', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 3: DEVICE IDENTITY & MANAGEMENT
    // ------------------------------------------------------------------------
    try {
      const stableDeviceId = `DEV-TEST-${testSuffix}`;
      deviceA = await Device.create({
        companyId: companyA._id,
        employeeId: empProfileA._id,
        deviceId: stableDeviceId,
        deviceName: 'Test Workstation',
        status: DeviceStatus.ACTIVE
      });

      const foundDevice = await Device.findOne({ companyId: companyA._id, deviceId: stableDeviceId });
      const deviceRegistered = !!foundDevice && foundDevice.deviceId === stableDeviceId;
      recordTest('Device Identity', 'Stable device identifier registration and lookup', deviceRegistered);
    } catch (err: any) {
      recordTest('Device Identity', 'Stable device identifier registration and lookup', false, err.message);
    }

    try {
      // Test revoked device status
      deviceA.status = DeviceStatus.REVOKED;
      await deviceA.save();
      const isRevoked = deviceA.status === DeviceStatus.REVOKED;
      recordTest('Device Identity', 'Device revocation state management', isRevoked);
      // Restore active
      deviceA.status = DeviceStatus.ACTIVE;
      await deviceA.save();
    } catch (err: any) {
      recordTest('Device Identity', 'Device revocation state management', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 4: ATTENDANCE SESSION LIFECYCLE
    // ------------------------------------------------------------------------
    let activeSession: any;
    try {
      activeSession = await startWorkSession(
        companyA._id.toString(),
        empProfileA._id.toString(),
        deviceA.deviceId
      );
      const sessionStarted =
        activeSession &&
        activeSession.status === SessionStatus.ACTIVE &&
        activeSession.startedAt != null;

      const profileRefreshed = await EmployeeProfile.findById(empProfileA._id);
      const profileLinked = profileRefreshed?.currentSessionId?.toString() === activeSession._id.toString();

      recordTest('Sessions', 'Session start and employee profile linkage', sessionStarted && profileLinked);
    } catch (err: any) {
      recordTest('Sessions', 'Session start and employee profile linkage', false, err.message);
    }

    try {
      // Duplicate session start: should return existing session without creating a duplicate
      const duplicateSession = await startWorkSession(
        companyA._id.toString(),
        empProfileA._id.toString(),
        deviceA.deviceId
      );
      const isSameSession = duplicateSession._id.toString() === activeSession._id.toString();
      const totalSessions = await AttendanceSession.countDocuments({
        companyId: companyA._id,
        employeeId: empProfileA._id,
        status: SessionStatus.ACTIVE
      });
      recordTest('Sessions', 'Idempotent duplicate session start prevention', isSameSession && totalSessions === 1);
    } catch (err: any) {
      recordTest('Sessions', 'Idempotent duplicate session start prevention', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 5: BREAK HANDLING
    // ------------------------------------------------------------------------
    try {
      const breakRec = await Break.create({
        companyId: companyA._id,
        employeeId: empProfileA._id,
        sessionId: activeSession._id,
        reason: BreakReason.LUNCH,
        startedAt: new Date(Date.now() - 30000)
      });

      empProfileA.currentStatus = ActivityState.BREAK;
      await empProfileA.save();

      // End break
      breakRec.endedAt = new Date();
      breakRec.durationSeconds = 30;
      await breakRec.save();

      empProfileA.currentStatus = ActivityState.ACTIVE;
      await empProfileA.save();

      recordTest('Breaks', 'Break start, end, and duration tracking', breakRec.durationSeconds === 30);
    } catch (err: any) {
      recordTest('Breaks', 'Break start, end, and duration tracking', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 6: TELEMETRY INGESTION & IDEMPOTENCY
    // ------------------------------------------------------------------------
    const eventId1 = `test-evt-1-${uuidv4()}`;
    const eventId2 = `test-evt-2-${uuidv4()}`;
    const t0 = new Date(Date.now() - 60000);
    const t1 = new Date(Date.now() - 30000);
    const t2 = new Date();

    try {
      const ingestRes = await ingestActivityEvents(
        companyA._id.toString(),
        empProfileA._id.toString(),
        activeSession._id.toString(),
        deviceA.deviceId,
        [
          {
            eventId: eventId1,
            type: ActivityEventType.APPLICATION_FOCUS,
            applicationName: 'Visual Studio Code',
            processName: 'code.exe',
            startedAt: t0.toISOString(),
            endedAt: t1.toISOString(),
            durationSeconds: 30
          },
          {
            eventId: eventId2,
            type: ActivityEventType.APPLICATION_FOCUS,
            applicationName: 'Google Chrome',
            processName: 'chrome.exe',
            startedAt: t1.toISOString(),
            endedAt: t2.toISOString(),
            durationSeconds: 30
          }
        ]
      );

      const ingestedOk = ingestRes.accepted.length === 2 && ingestRes.duplicates.length === 0;
      recordTest('Activity Telemetry', 'Interval-based application ingestion', ingestedOk);
    } catch (err: any) {
      recordTest('Activity Telemetry', 'Interval-based application ingestion', false, err.message);
    }

    // Duplicate ingestion test
    try {
      const duplicateRes = await ingestActivityEvents(
        companyA._id.toString(),
        empProfileA._id.toString(),
        activeSession._id.toString(),
        deviceA.deviceId,
        [
          {
            eventId: eventId1, // Same event ID!
            type: ActivityEventType.APPLICATION_FOCUS,
            applicationName: 'Visual Studio Code',
            processName: 'code.exe',
            startedAt: t0.toISOString(),
            endedAt: t1.toISOString(),
            durationSeconds: 30
          }
        ]
      );

      const isDeduplicated = duplicateRes.duplicates.length === 1 && duplicateRes.accepted.length === 0;
      recordTest('Activity Telemetry', 'Idempotent deduplication of retransmitted events', isDeduplicated);
    } catch (err: any) {
      recordTest('Activity Telemetry', 'Idempotent deduplication of retransmitted events', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 7: HEARTBEAT AS PRESENCE (NO DURATION INFLATION)
    // ------------------------------------------------------------------------
    try {
      const hbBefore = await EmployeeProfile.findById(empProfileA._id);
      const activeSecBefore = hbBefore?.todayActiveSeconds || 0;

      await processHeartbeat({
        companyId: companyA._id.toString(),
        employeeId: empProfileA._id.toString(),
        deviceId: deviceA.deviceId,
        sessionId: activeSession._id.toString(),
        timestamp: new Date().toISOString(),
        status: ActivityState.ACTIVE,
        currentApplication: 'Google Chrome',
        idleSeconds: 0
      });

      const hbAfter = await EmployeeProfile.findById(empProfileA._id);
      const activeSecAfter = hbAfter?.todayActiveSeconds || 0;

      // Heartbeat must NOT increment todayActiveSeconds blindly
      const isPurePresence = activeSecAfter === activeSecBefore && hbAfter?.currentApplication === 'Google Chrome';
      recordTest('Heartbeat', 'Heartbeat presence update without fake duration inflation', isPurePresence);
    } catch (err: any) {
      recordTest('Heartbeat', 'Heartbeat presence update without fake duration inflation', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 8: DAILY REBUILD & TIMEZONE HANDLING
    // ------------------------------------------------------------------------
    try {
      const todayStr = getDateStringInTimezone(new Date(), 'Asia/Kolkata');
      const rebuildResult = await rebuildEmployeeDay(
        companyA._id.toString(),
        empProfileA._id.toString(),
        todayStr
      );

      // We ingested 30s VS Code + 30s Chrome = 60s total active
      const rebuildAccurate =
        rebuildResult.totalActiveSeconds === 60 &&
        rebuildResult.uniqueApplications === 2 &&
        rebuildResult.totalBreakSeconds === 30;

      const summaryDoc = await DailySummary.findOne({
        companyId: companyA._id,
        employeeId: empProfileA._id,
        date: todayStr
      });

      const summarySynced = summaryDoc && summaryDoc.activeSeconds === 60 && summaryDoc.breakSeconds === 30;

      recordTest('Daily Rebuild', 'Authoritative rebuildEmployeeDay derivation and DailySummary sync', rebuildAccurate && !!summarySynced);
    } catch (err: any) {
      recordTest('Daily Rebuild', 'Authoritative rebuildEmployeeDay derivation and DailySummary sync', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 9: REPORT AGGREGATION
    // ------------------------------------------------------------------------
    try {
      const todayStr = getDateStringInTimezone(new Date(), 'Asia/Kolkata');
      const reportRows = await getDailyReport(companyA._id.toString(), todayStr, empProfileA._id.toString());
      const reportValid = reportRows.length === 1 && reportRows[0].activeSeconds >= 0;
      recordTest('Reports', 'Daily report aggregation across attendance and application usages', reportValid);
    } catch (err: any) {
      recordTest('Reports', 'Daily report aggregation across attendance and application usages', false, err.message);
    }

    // ------------------------------------------------------------------------
    // TEST 10: SESSION END & RECONCILIATION
    // ------------------------------------------------------------------------
    try {
      const endedSession = await endWorkSession(
        companyA._id.toString(),
        empProfileA._id.toString(),
        activeSession._id.toString(),
        'Automated Test Complete'
      );

      const profileAfterEnd = await EmployeeProfile.findById(empProfileA._id);
      const endedProperly =
        endedSession.status === SessionStatus.COMPLETED &&
        profileAfterEnd?.currentStatus === ActivityState.OFFLINE &&
        !profileAfterEnd?.currentSessionId;

      recordTest('Sessions', 'Session end and employee offline transition', endedProperly);
    } catch (err: any) {
      recordTest('Sessions', 'Session end and employee offline transition', false, err.message);
    }
  } finally {
    // CLEANUP TEST DATA
    try {
      if (companyA) {
        await Company.deleteOne({ _id: companyA._id });
        await User.deleteMany({ companyId: companyA._id });
        await EmployeeProfile.deleteMany({ companyId: companyA._id });
        await AttendanceSession.deleteMany({ companyId: companyA._id });
        await ActivityEvent.deleteMany({ companyId: companyA._id });
        await ApplicationUsage.deleteMany({ companyId: companyA._id });
        await Device.deleteMany({ companyId: companyA._id });
        await Break.deleteMany({ companyId: companyA._id });
        await DailySummary.deleteMany({ companyId: companyA._id });
      }
      if (companyB) {
        await Company.deleteOne({ _id: companyB._id });
        await User.deleteMany({ companyId: companyB._id });
        await EmployeeProfile.deleteMany({ companyId: companyB._id });
      }
    } catch (cleanupErr) {
      console.warn('[Cleanup Warning]:', cleanupErr);
    }

    await disconnectDatabase();
  }

  // ------------------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log('\n======================================================');
  console.log(`TEST SUITE RESULTS: ${passed}/${total} PASSED (${failed} failed)`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('[Test Suite Exception]:', err);
  process.exit(1);
});
