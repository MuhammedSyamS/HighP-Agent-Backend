import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { ActivityState, ActivityEventType, SessionStatus, UserRole } from '../shared';
import { Company } from '../models/Company';
import { User } from '../models/User';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { WebsiteActivity } from '../models/WebsiteActivity';
import { TrackedApplication } from '../models/TrackedApplication';
import { DiscoveredApplication } from '../models/DiscoveredApplication';
import { Device } from '../models/Device';
import { startWorkSession, endWorkSession } from '../services/sessionService';
import { processHeartbeat } from '../services/heartbeatService';
import { ingestActivityEvents } from '../services/activityService';
import { checkStaleSessions } from '../services/reaperService';
import { BrowserBridge } from '../../../desktop-agent/src/main/browser/browserBridge';
import { resolveApplication, TrackedApplicationEntry } from '../../../desktop-agent/src/main/tracker/appResolver';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/highp-test-tracking-fix';

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function recordTest(category: string, name: string, passed: boolean, error?: string) {
  results.push({ category, name, passed, error });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${category}] ${name}${error ? ` - ${error}` : ''}`);
}

async function runComprehensiveVerification() {
  console.log('================================================================');
  console.log('🧪 HIGH P AGENT — COMPLETE TRACKING SYSTEM COMPREHENSIVE VERIFICATION');
  console.log('================================================================\n');

  try {
    await mongoose.connect(MONGO_URI);
    console.log('[Database] Connected to MongoDB');

    // 1. Setup Test Tenant & Employee
    const testSuffix = Date.now().toString().slice(-6);
    const company = await Company.create({
      name: `Test Tenant ${testSuffix}`,
      slug: `tenant-${testSuffix}`,
      config: {
        heartbeatIntervalSeconds: 15,
        idleThresholdMinutes: 5,
        allowedTrackingHours: { timezone: 'Asia/Kolkata', start: '00:00', end: '23:59' }
      }
    });

    const user = await User.create({
      email: `engineer-${testSuffix}@highphaus.com`,
      passwordHash: 'hashed_password_sample',
      firstName: 'Alex',
      lastName: 'Engineer',
      role: UserRole.EMPLOYEE,
      companyId: company._id
    });

    const profile = await EmployeeProfile.create({
      companyId: company._id,
      userId: user._id,
      employeeCode: `HP-TST-${testSuffix}`,
      department: 'Engineering',
      designation: 'Software Developer',
      currentStatus: ActivityState.OFFLINE
    });

    const device = await Device.create({
      companyId: company._id,
      employeeId: profile._id,
      deviceId: `device-win-${testSuffix}`,
      deviceName: 'WIN11-DEV-STATION',
      osInfo: { platform: 'win32', release: '10.0.22631', arch: 'x64', hostname: 'WIN11-DEV' },
      agentVersion: '1.0.0'
    });

    // Seed Tracked Apps
    const registryEntries: TrackedApplicationEntry[] = [
      { name: 'Brave', category: 'Browsers', executableNames: ['brave.exe'], tracked: true, ignored: false },
      { name: 'Google Chrome', category: 'Browsers', executableNames: ['chrome.exe'], tracked: true, ignored: false },
      { name: 'Microsoft Edge', category: 'Browsers', executableNames: ['msedge.exe'], tracked: true, ignored: false },
      { name: 'Visual Studio Code', category: 'Development', executableNames: ['code.exe'], tracked: true, ignored: false },
      { name: 'Spotify', category: 'Media', executableNames: ['spotify.exe'], tracked: false, ignored: true }
    ];

    for (const r of registryEntries) {
      await TrackedApplication.create({
        companyId: company._id,
        name: r.name,
        category: r.category,
        executableNames: r.executableNames,
        tracked: r.tracked,
        ignored: r.ignored
      });
    }

    // ------------------------------------------------------------------------
    // TEST 1: WORK SESSION INITIALIZATION (START WORK)
    // ------------------------------------------------------------------------
    console.log('\n--- 1. WORK SESSION INITIALIZATION ---');
    const workSession = await startWorkSession(company._id.toString(), profile._id.toString(), device.deviceId);
    const sessionDoc = await AttendanceSession.findById(workSession._id);
    const pass1 = !!sessionDoc && sessionDoc.status === SessionStatus.ACTIVE && !sessionDoc.endedAt;
    recordTest('WorkSession', 'Explicit Start Work creates OPEN session without endedAt', pass1);

    // ------------------------------------------------------------------------
    // TEST 2: PRIVACY-SAFE DOMAIN NORMALIZATION (SECTION 8)
    // ------------------------------------------------------------------------
    console.log('\n--- 2. PRIVACY-SAFE DOMAIN NORMALIZATION ---');
    const bridge = new BrowserBridge(41795); // Test port
    const testUrls = [
      { input: 'https://notion.so/workspace/private-doc?token=secret123#heading', expected: 'notion.so' },
      { input: 'https://www.github.com/company/repo/issues/456?search=pass', expected: 'github.com' },
      { input: 'https://highphaus.com:8080/dashboard', expected: 'highphaus.com' },
      { input: 'http://localhost:3000/settings', expected: 'localhost' },
      { input: 'chrome://settings', expected: null }, // Internal browser schemes dropped
      { input: 'brave://extensions', expected: null },
      { input: 'about:blank', expected: null }
    ];

    let normPass = true;
    for (const t of testUrls) {
      const res = bridge.normalizeDomain(t.input);
      if (res !== t.expected) {
        normPass = false;
        console.error(`Normalization failed for: ${t.input} -> got: ${res}, expected: ${t.expected}`);
      }
    }
    recordTest('PrivacyNormalization', 'Strips query params, tokens, paths, schemes; preserves root domain only', normPass);

    // ------------------------------------------------------------------------
    // TEST 3: BROWSER DETECTIONS & WEBSITE CORRELATION
    // ------------------------------------------------------------------------
    console.log('\n--- 3. BROWSER TELEMETRY & WEBSITE CORRELATION ---');
    // Simulate browser extension reporting active tab on localhost
    bridge.start();
    const testPostRes = await axios.post('http://127.0.0.1:41795/api/browser/activity', {
      browser: 'Brave',
      domain: 'notion.so',
      tabActivatedAt: new Date().toISOString()
    });

    const activeInBrave = bridge.getActiveWebsite('brave.exe');
    const activeInChrome = bridge.getActiveWebsite('chrome.exe');
    const activeInVSCode = bridge.getActiveWebsite('code.exe'); // Non-browser app

    const pass3 =
      testPostRes.status === 200 &&
      activeInBrave?.domain === 'notion.so' &&
      activeInChrome?.domain === 'notion.so' &&
      activeInVSCode === null; // VS Code must NEVER have a website domain!

    recordTest('Correlation', 'Browser bridge correlates active domain with browser processes and NULL for non-browsers', pass3);

    // ------------------------------------------------------------------------
    // TEST 4: BROWSER TAB SWITCHING WITHIN SAME APPLICATION (SECTION 11)
    // ------------------------------------------------------------------------
    console.log('\n--- 4. BROWSER TAB SWITCHING INSIDE SAME BROWSER ---');
    // Tab 1: Brave -> notion.so (12m / 720s)
    const t0 = new Date('2026-10-04T10:00:00Z');
    const t1 = new Date('2026-10-04T10:12:00Z');
    const evt1Id = uuidv4();

    await ingestActivityEvents(company._id.toString(), profile._id.toString(), workSession._id.toString(), device.deviceId, [
      {
        eventId: evt1Id,
        type: ActivityEventType.APPLICATION_FOCUS,
        applicationName: 'Brave',
        processName: 'brave.exe',
        startedAt: t0.toISOString(),
        endedAt: t1.toISOString(),
        durationSeconds: 720,
        domain: 'notion.so'
      }
    ]);

    // Tab 2: User switches tab to Brave -> github.com (8m / 480s)
    const t2 = new Date('2026-10-04T10:20:00Z');
    const evt2Id = uuidv4();

    await ingestActivityEvents(company._id.toString(), profile._id.toString(), workSession._id.toString(), device.deviceId, [
      {
        eventId: evt2Id,
        type: ActivityEventType.APPLICATION_FOCUS,
        applicationName: 'Brave',
        processName: 'brave.exe',
        startedAt: t1.toISOString(),
        endedAt: t2.toISOString(),
        durationSeconds: 480,
        domain: 'github.com'
      }
    ]);

    const braveAppUsage = await ApplicationUsage.findOne({
      companyId: company._id,
      employeeId: profile._id,
      applicationName: 'Brave'
    });

    const notionWebUsage = await WebsiteActivity.findOne({
      companyId: company._id,
      employeeId: profile._id,
      domain: 'notion.so'
    });

    const githubWebUsage = await WebsiteActivity.findOne({
      companyId: company._id,
      employeeId: profile._id,
      domain: 'github.com'
    });

    const pass4 =
      braveAppUsage?.totalSeconds === 1200 && // 720 + 480 = 1200s total Brave time
      notionWebUsage?.totalSeconds === 720 &&
      githubWebUsage?.totalSeconds === 480;

    recordTest('TabSwitching', 'Brave application remains continuous (1200s) while website intervals are separated (720s & 480s)', pass4);

    // ------------------------------------------------------------------------
    // TEST 5: WORK SESSION REMAINS OPEN DURING APPLICATION SWITCHES
    // ------------------------------------------------------------------------
    console.log('\n--- 5. APPLICATION SWITCHES DO NOT CLOSE SESSION ---');
    // Switch to VS Code
    await processHeartbeat({
      companyId: company._id.toString(),
      employeeId: profile._id.toString(),
      deviceId: device.deviceId,
      sessionId: workSession._id.toString(),
      timestamp: new Date().toISOString(),
      status: ActivityState.ACTIVE,
      currentApplication: 'Visual Studio Code',
      executable: 'code.exe',
      idleSeconds: 0
    });

    // Switch to Spotify (Ignored app)
    await processHeartbeat({
      companyId: company._id.toString(),
      employeeId: profile._id.toString(),
      deviceId: device.deviceId,
      sessionId: workSession._id.toString(),
      timestamp: new Date().toISOString(),
      status: ActivityState.ACTIVE,
      currentApplication: 'Spotify',
      executable: 'spotify.exe',
      idleSeconds: 0
    });

    const sessionAfterSwitches = await AttendanceSession.findById(workSession._id);
    const pass5 = sessionAfterSwitches?.status === SessionStatus.ACTIVE && !sessionAfterSwitches?.endedAt;
    recordTest('WorkSession', 'Session remains OPEN across application switches (Brave -> VS Code -> Spotify)', pass5);

    // ------------------------------------------------------------------------
    // TEST 6: WORK SESSION REMAINS OPEN DURING IDLE STATE
    // ------------------------------------------------------------------------
    console.log('\n--- 6. IDLE STATE DOES NOT CLOSE SESSION ---');
    await processHeartbeat({
      companyId: company._id.toString(),
      employeeId: profile._id.toString(),
      deviceId: device.deviceId,
      sessionId: workSession._id.toString(),
      timestamp: new Date().toISOString(),
      status: ActivityState.IDLE,
      currentApplication: '',
      idleSeconds: 600
    });

    const sessionAfterIdle = await AttendanceSession.findById(workSession._id);
    const pass6 = sessionAfterIdle?.status === SessionStatus.ACTIVE && !sessionAfterIdle?.endedAt;
    recordTest('WorkSession', 'Session remains OPEN when employee becomes IDLE (idle duration does NOT end work session)', pass6);

    // ------------------------------------------------------------------------
    // TEST 7: REAPER SERVICE DISCONNECT PREVENTS AUTOMATIC TERMINATION (SECTION 19)
    // ------------------------------------------------------------------------
    console.log('\n--- 7. REAPER SERVICE DISCONNECT TEST ---');
    // Simulate employee having an old heartbeat > 15 minutes ago
    await EmployeeProfile.updateOne(
      { _id: profile._id },
      {
        $set: {
          lastHeartbeatAt: new Date(Date.now() - 15 * 60 * 1000),
          currentStatus: ActivityState.ACTIVE
        }
      }
    );

    // Run reaper check
    await checkStaleSessions(company._id.toString());

    const updatedProfile = await EmployeeProfile.findById(profile._id);
    const sessionAfterReaper = await AttendanceSession.findById(workSession._id);

    const pass7 =
      updatedProfile?.currentStatus === ActivityState.OFFLINE && // Presence status updated to OFFLINE
      sessionAfterReaper?.status === SessionStatus.ACTIVE &&     // WORK SESSION STILL OPEN!
      !sessionAfterReaper?.endedAt;

    recordTest('ReaperSemantics', 'Reaper updates presence to OFFLINE but NEVER terminates active AttendanceSession', pass7);

    // ------------------------------------------------------------------------
    // TEST 8: AGENT RESTART RESUMES EXISTING WORK SESSION (SECTION 18)
    // ------------------------------------------------------------------------
    console.log('\n--- 8. AGENT RESTART SESSION RESUMPTION ---');
    // When agent restarts, it queries active session and calls startWorkSession
    const resumedSession = await startWorkSession(company._id.toString(), profile._id.toString(), device.deviceId);

    const pass8 =
      resumedSession._id.toString() === workSession._id.toString() &&
      resumedSession.status === SessionStatus.ACTIVE &&
      !resumedSession.endedAt;

    recordTest('AgentRestart', 'Agent restart reuses existing open session without creating duplicate or ending work', pass8);

    // ------------------------------------------------------------------------
    // TEST 9: WEBSITE TRACKING FAILURE MUST NOT BREAK APPLICATION TRACKING (SECTION 25)
    // ------------------------------------------------------------------------
    console.log('\n--- 9. EXTENSION UNAVAILABLE RESILIENCE ---');
    bridge.stop(); // Stop extension receiver

    const fallbackApp = bridge.getActiveWebsite('brave.exe'); // Returns null for website
    const resolvedBrave = resolveApplication('brave.exe', 'C:\\Program Files\\BraveSoftware\\brave.exe', 1234, registryEntries);

    const pass9 =
      fallbackApp === null &&
      resolvedBrave.name === 'Brave' &&
      resolvedBrave.tracked === true;

    recordTest('Resilience', 'If browser extension is unavailable, application tracking for Brave continues 100% unaffected', pass9);

    // ------------------------------------------------------------------------
    // TEST 10: EXPLICIT END WORK CLOSES THE SESSION (SECTION 2)
    // ------------------------------------------------------------------------
    console.log('\n--- 10. EXPLICIT END WORK ---');
    const closedSession = await endWorkSession(company._id.toString(), profile._id.toString(), workSession._id.toString(), 'User Explicit End Work');

    const finalSession = await AttendanceSession.findById(workSession._id);
    const finalProfile = await EmployeeProfile.findById(profile._id);

    const pass10 =
      finalSession?.status === SessionStatus.COMPLETED &&
      !!finalSession?.endedAt &&
      finalSession?.endReason === 'User Explicit End Work' &&
      finalProfile?.currentSessionId === undefined;

    recordTest('ExplicitEndWork', 'Session closes ONLY upon explicit End Work invocation with authoritative endedAt', pass10);

    // Cleanup
    await Company.deleteOne({ _id: company._id });
    await User.deleteOne({ _id: user._id });
    await EmployeeProfile.deleteOne({ _id: profile._id });
    await AttendanceSession.deleteOne({ _id: workSession._id });
    await Device.deleteOne({ _id: device._id });
    await ApplicationUsage.deleteMany({ companyId: company._id });
    await WebsiteActivity.deleteMany({ companyId: company._id });
    await ActivityEvent.deleteMany({ companyId: company._id });
    await TrackedApplication.deleteMany({ companyId: company._id });

    await mongoose.disconnect();

    console.log('\n======================================================');
    console.log('                   TEST SUMMARY                       ');
    console.log('======================================================');
    const passedCount = results.filter(r => r.passed).length;
    console.log(`Total: ${results.length} | Passed: ${passedCount} | Failed: ${results.length - passedCount}`);

    if (passedCount === results.length) {
      console.log('\n🎉 ALL 10 ARCHITECTURAL & COMPLIANCE REQUIREMENTS PASSED PERFECTLY!\n');
    } else {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

runComprehensiveVerification();
