import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { Company } from '../models/Company';
import { User } from '../models/User';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { ActivityEvent } from '../models/ActivityEvent';
import { DailySummary } from '../models/DailySummary';
import { UserRole, ActivityState, SessionStatus, ActivityEventType } from '../shared';
import { startWorkSession, endWorkSession } from '../services/sessionService';
import { processHeartbeat } from '../services/heartbeatService';
import { ingestActivityEvents } from '../services/activityService';
import { rebuildEmployeeDay } from '../services/rebuildService';
import { getDateStringInTimezone } from '../utils/timezone';

async function runControlledAccountingTest() {
  console.log('\n===============================================================');
  console.log('  🧪 CONTROLLED TEST: ATTENDANCE DURATION ACCOUNTING ACCURACY  ');
  console.log('===============================================================\n');

  await mongoose.connect(config.mongoUri);

  const testSuffix = Date.now().toString();
  let company: any;
  let user: any;
  let profile: any;

  try {
    // 1. Setup isolated test tenant
    company = await Company.create({
      name: `Accounting Test Co ${testSuffix}`,
      slug: `accounting-test-${testSuffix}`,
      config: {
        idleThresholdMinutes: 1,
        heartbeatIntervalSeconds: 15,
        allowedTrackingHours: { enabled: false, startTime: '09:00', endTime: '18:00', timezone: 'Asia/Kolkata' }
      }
    });

    user = await User.create({
      companyId: company._id,
      email: `test-${testSuffix}@accounting.com`,
      passwordHash: 'dummy',
      firstName: 'Accounting',
      lastName: 'Tester',
      role: UserRole.EMPLOYEE
    });

    profile = await EmployeeProfile.create({
      companyId: company._id,
      userId: user._id,
      employeeCode: `ACC-${testSuffix.slice(-4)}`,
      currentStatus: ActivityState.OFFLINE,
      todayActiveSeconds: 0,
      todayIdleSeconds: 0,
      todayBreakSeconds: 0
    });

    const companyId = company._id.toString();
    const employeeId = profile._id.toString();
    const todayStr = getDateStringInTimezone(new Date(), 'Asia/Kolkata');

    console.log(`[TEST SETUP] Tenant: ${company.name}, Employee: ${profile.employeeCode}, Date: ${todayStr}`);

    // ------------------------------------------------------------------------
    // SHIFT 1: 5-MINUTE CONTROLLED SHIFT
    // 2m Active -> 2m Idle -> 1m Active
    // ------------------------------------------------------------------------
    console.log('\n--- STARTING SHIFT 1 ---');
    const session1 = await startWorkSession(companyId, employeeId, 'DEV-TEST-1');
    const sess1Id = session1._id.toString();

    // Base timeline: 5 minutes ago to now
    const t0 = new Date(Date.now() - 300 * 1000); // 5 mins ago (Start)
    const t1 = new Date(t0.getTime() + 120 * 1000); // +2 mins (Active 1 ends, Idle starts)
    const t2 = new Date(t1.getTime() + 120 * 1000); // +2 mins (Idle ends, Active 2 starts)
    const t3 = new Date(t2.getTime() + 60 * 1000);  // +1 min (Active 2 ends, Shift completes)

    // Set back session startedAt to t0 for exact elapsed calculation
    await AttendanceSession.updateOne({ _id: session1._id }, { $set: { startedAt: t0 } });

    // Step A: Ingest 2 minutes Active (VS Code)
    await ingestActivityEvents(companyId, employeeId, sess1Id, 'DEV-TEST-1', [
      {
        eventId: `evt-act1-${uuidv4()}`,
        type: ActivityEventType.APPLICATION_FOCUS,
        applicationName: 'Visual Studio Code',
        processName: 'code.exe',
        startedAt: t0.toISOString(),
        endedAt: t1.toISOString(),
        durationSeconds: 120
      }
    ]);

    // Step B: Ingest 2 minutes Idle (System Idle)
    await ingestActivityEvents(companyId, employeeId, sess1Id, 'DEV-TEST-1', [
      {
        eventId: `evt-idle1-${uuidv4()}`,
        type: ActivityEventType.IDLE_INTERVAL,
        applicationName: 'System Idle',
        processName: 'idle',
        startedAt: t1.toISOString(),
        endedAt: t2.toISOString(),
        durationSeconds: 120
      }
    ]);

    // Step C: Ingest 1 minute Active (Google Chrome)
    await ingestActivityEvents(companyId, employeeId, sess1Id, 'DEV-TEST-1', [
      {
        eventId: `evt-act2-${uuidv4()}`,
        type: ActivityEventType.APPLICATION_FOCUS,
        applicationName: 'Google Chrome',
        processName: 'chrome.exe',
        startedAt: t2.toISOString(),
        endedAt: t3.toISOString(),
        durationSeconds: 60
      }
    ]);

    // Heartbeat reporting current session state
    await processHeartbeat({
      companyId,
      employeeId,
      deviceId: 'DEV-TEST-1',
      sessionId: sess1Id,
      timestamp: t3.toISOString(),
      status: ActivityState.ACTIVE,
      currentApplication: 'Google Chrome',
      totalActiveSeconds: 180, // 120s + 60s
      totalIdleSeconds: 120,   // 120s
      idleSeconds: 0
    });

    // Check live state of Session 1
    const s1Live = await AttendanceSession.findById(session1._id).lean();
    console.log('\n[LIVE SHIFT 1 IN-PROGRESS STATE]');
    console.log({
      sessionId: s1Live?._id,
      startedAt: s1Live?.startedAt,
      activeSeconds: s1Live?.activeSeconds,
      idleSeconds: s1Live?.idleSeconds,
      breakSeconds: s1Live?.breakSeconds,
      totalShiftSeconds: (s1Live?.activeSeconds || 0) + (s1Live?.idleSeconds || 0) + (s1Live?.breakSeconds || 0)
    });

    const shift1Consistent =
      s1Live?.activeSeconds === 180 &&
      s1Live?.idleSeconds === 120 &&
      s1Live?.breakSeconds === 0 &&
      (s1Live?.activeSeconds + s1Live?.idleSeconds + s1Live?.breakSeconds) === 300;

    console.log(`\nASSERTION 1 (Shift 1 = 5m total, 3m active, 2m idle, 0m break): ${shift1Consistent ? '✅ PASS' : '❌ FAIL'}`);

    // End Shift 1
    console.log('\n--- ENDING SHIFT 1 ---');
    const endedS1 = await endWorkSession(companyId, employeeId, sess1Id, 'End Shift 1');
    console.log(`Shift 1 Ended at: ${endedS1.endedAt?.toISOString()}, status: ${endedS1.status}`);

    const pAfterS1 = await EmployeeProfile.findById(profile._id).lean();
    console.log(`[PROFILE AFTER SHIFT 1] todayActive=${pAfterS1?.todayActiveSeconds}s (3m), todayIdle=${pAfterS1?.todayIdleSeconds}s (2m), todayBreak=${pAfterS1?.todayBreakSeconds}s`);

    // ------------------------------------------------------------------------
    // SHIFT 2: SECOND SHIFT TODAY (3 Minutes Active)
    // ------------------------------------------------------------------------
    console.log('\n--- STARTING SHIFT 2 ---');
    const session2 = await startWorkSession(companyId, employeeId, 'DEV-TEST-1');
    const sess2Id = session2._id.toString();

    // Verify Session 2 starts clean from 0
    console.log(`Session 2 Initial State: activeSeconds=${session2.activeSeconds}, idleSeconds=${session2.idleSeconds}`);
    const sess2CleanStart = session2.activeSeconds === 0 && session2.idleSeconds === 0;
    console.log(`ASSERTION 2 (New session starts clean at 0s): ${sess2CleanStart ? '✅ PASS' : '❌ FAIL'}`);

    const s2_t0 = new Date();
    const s2_t1 = new Date(s2_t0.getTime() + 180 * 1000); // 3 mins active

    // Ingest 3 minutes Active for Shift 2
    await ingestActivityEvents(companyId, employeeId, sess2Id, 'DEV-TEST-1', [
      {
        eventId: `evt-s2-act-${uuidv4()}`,
        type: ActivityEventType.APPLICATION_FOCUS,
        applicationName: 'Figma',
        processName: 'figma.exe',
        startedAt: s2_t0.toISOString(),
        endedAt: s2_t1.toISOString(),
        durationSeconds: 180
      }
    ]);

    // Send heartbeat for Shift 2
    await processHeartbeat({
      companyId,
      employeeId,
      deviceId: 'DEV-TEST-1',
      sessionId: sess2Id,
      timestamp: s2_t1.toISOString(),
      status: ActivityState.ACTIVE,
      currentApplication: 'Figma',
      totalActiveSeconds: 180,
      totalIdleSeconds: 0,
      idleSeconds: 0
    });

    const s2Live = await AttendanceSession.findById(session2._id).lean();
    console.log('\n[LIVE SHIFT 2 IN-PROGRESS STATE]');
    console.log({
      sessionId: s2Live?._id,
      startedAt: s2Live?.startedAt,
      activeSeconds: s2Live?.activeSeconds,
      idleSeconds: s2Live?.idleSeconds,
      breakSeconds: s2Live?.breakSeconds,
      shiftDuration: (s2Live?.activeSeconds || 0) + (s2Live?.idleSeconds || 0) + (s2Live?.breakSeconds || 0)
    });

    const pAfterS2 = await EmployeeProfile.findById(profile._id).lean();
    console.log('\n[TODAY CUMULATIVE TOTALS DURING SHIFT 2]');
    console.log({
      todayActiveSeconds: pAfterS2?.todayActiveSeconds,
      todayIdleSeconds: pAfterS2?.todayIdleSeconds,
      todayBreakSeconds: pAfterS2?.todayBreakSeconds,
      todayTotalWorked: (pAfterS2?.todayActiveSeconds || 0) + (pAfterS2?.todayIdleSeconds || 0)
    });

    // Check assertions for Shift 2 and Today Cumulative
    // Current Shift 2: 180s active, 0s idle
    const shift2Accurate = s2Live?.activeSeconds === 180 && s2Live?.idleSeconds === 0;
    // Today cumulative: Shift 1 (180s active, 120s idle) + Shift 2 (180s active, 0s idle) = 360s active, 120s idle
    const todayCumulativeAccurate =
      pAfterS2?.todayActiveSeconds === 360 &&
      pAfterS2?.todayIdleSeconds === 120 &&
      pAfterS2?.todayBreakSeconds === 0;

    console.log(`ASSERTION 3 (Current Shift 2 = 3m active, 0m idle): ${shift2Accurate ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`ASSERTION 4 (Today Cumulative = 6m active [3m+3m], 2m idle [2m+0m]): ${todayCumulativeAccurate ? '✅ PASS' : '❌ FAIL'}`);

    // End Shift 2
    await endWorkSession(companyId, employeeId, sess2Id, 'End Shift 2');

    // Final Day Summary verification
    const dailySummary = await DailySummary.findOne({ companyId, employeeId, date: todayStr }).lean();
    console.log('\n[FINAL DAILY SUMMARY]');
    console.log({
      date: dailySummary?.date,
      activeSeconds: dailySummary?.activeSeconds,
      idleSeconds: dailySummary?.idleSeconds,
      breakSeconds: dailySummary?.breakSeconds,
      totalSessionSeconds: dailySummary?.totalSessionSeconds
    });

    const summaryAccurate =
      dailySummary?.activeSeconds === 360 &&
      dailySummary?.idleSeconds === 120 &&
      dailySummary?.breakSeconds === 0;

    console.log(`ASSERTION 5 (Daily Summary matches 360s active, 120s idle): ${summaryAccurate ? '✅ PASS' : '❌ FAIL'}`);

    const allPassed = shift1Consistent && sess2CleanStart && shift2Accurate && todayCumulativeAccurate && summaryAccurate;
    console.log('\n===============================================================');
    console.log(`  FINAL RESULT: ${allPassed ? '🎉 ALL 5 ACCOUNTING ASSERTIONS PASSED' : '❌ SOME ASSERTIONS FAILED'}`);
    console.log('===============================================================\n');

    if (!allPassed) {
      process.exit(1);
    }
  } finally {
    // Cleanup
    if (company) {
      await Company.deleteOne({ _id: company._id });
      await User.deleteMany({ companyId: company._id });
      await EmployeeProfile.deleteMany({ companyId: company._id });
      await AttendanceSession.deleteMany({ companyId: company._id });
      await ActivityEvent.deleteMany({ companyId: company._id });
      await DailySummary.deleteMany({ companyId: company._id });
    }
    await mongoose.disconnect();
  }
}

runControlledAccountingTest().catch(console.error);
