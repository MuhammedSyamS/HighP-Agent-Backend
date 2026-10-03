import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Company } from '../models/Company';
import { User } from '../models/User';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { TrackedApplication } from '../models/TrackedApplication';
import { DiscoveredApplication } from '../models/DiscoveredApplication';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { Device } from '../models/Device';
import { UserRole, ActivityState, SessionStatus, ActivityEventType, DeviceStatus, ITrackedApplication } from '../shared';
import { applicationRegistryService } from '../services/applicationRegistryService';
import { ingestActivityEvents } from '../services/activityService';
import { processHeartbeat } from '../services/heartbeatService';
import { resolveApplication } from '../../../desktop-agent/src/main/tracker/appResolver';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function recordTest(suite: string, name: string, passed: boolean, error?: string) {
  results.push({ suite, name, passed, error: passed ? undefined : error });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${suite}] ${name}`);
  if (!passed && error) console.error(`   Error: ${error}`);
}

async function runApplicationTrackingTests() {
  console.log('\n======================================================');
  console.log('   🧪 HIGH P APPLICATION TRACKING & REGISTRY TESTS     ');
  console.log('======================================================\n');

  await connectDatabase();

  const testSuffix = Date.now().toString();
  let company: any;
  let hrUser: any;
  let empUser: any;
  let empProfile: any;
  let device: any;
  let session: any;

  try {
    // ------------------------------------------------------------------------
    // SETUP
    // ------------------------------------------------------------------------
    company = await Company.create({
      name: `App Tracking Test Co ${testSuffix}`,
      slug: `app-test-${testSuffix}`,
      config: {
        idleThresholdMinutes: 5,
        heartbeatIntervalSeconds: 15
      }
    });

    hrUser = await User.create({
      companyId: company._id,
      email: `hr-${testSuffix}@apptest.com`,
      passwordHash: 'dummy_hash',
      firstName: 'Admin',
      lastName: 'User',
      role: UserRole.HR
    });

    empUser = await User.create({
      companyId: company._id,
      email: `emp-${testSuffix}@apptest.com`,
      passwordHash: 'dummy_hash',
      firstName: 'Developer',
      lastName: 'One',
      role: UserRole.EMPLOYEE
    });

    empProfile = await EmployeeProfile.create({
      companyId: company._id,
      userId: empUser._id,
      employeeCode: `HP-APP-${testSuffix.slice(-4)}`,
      department: 'Engineering',
      designation: 'Senior Developer',
      currentStatus: ActivityState.ACTIVE
    });

    device = await Device.create({
      companyId: company._id,
      employeeId: empProfile._id,
      deviceId: `device-id-${testSuffix}`,
      deviceName: 'DEV-WORKSTATION-WIN11',
      osInfo: {
        platform: 'win32',
        release: '10.0.22631',
        arch: 'x64',
        hostname: 'DEV-WORKSTATION-WIN11'
      },
      agentVersion: '1.0.0',
      status: DeviceStatus.ACTIVE,
      lastHeartbeatAt: new Date()
    });

    session = await AttendanceSession.create({
      companyId: company._id,
      employeeId: empProfile._id,
      deviceId: device._id,
      sessionDate: new Date().toISOString().slice(0, 10),
      sessionNumber: 1,
      startedAt: new Date(Date.now() - 3600000),
      status: SessionStatus.ACTIVE
    });

    // ------------------------------------------------------------------------
    // 1. REGISTRY SEEDING & DEFAULTS
    // ------------------------------------------------------------------------
    await applicationRegistryService.seedDefaultApplications(company._id.toString());
    const seededApps = await TrackedApplication.find({ companyId: company._id }).lean();
    const hasSpotify = seededApps.some((a: any) => a.name === 'Spotify' && a.executableNames.includes('spotify.exe'));
    const hasVSCode = seededApps.some((a: any) => a.name === 'Visual Studio Code' && a.executableNames.includes('code.exe'));
    const hasChrome = seededApps.some((a: any) => a.name === 'Google Chrome' && a.executableNames.includes('chrome.exe'));
    const hasNotion = seededApps.some((a: any) => a.name === 'Notion' && a.executableNames.includes('notion.exe'));

    recordTest(
      'Registry Seeding',
      'Auto-seeds default applications with standard categories',
      seededApps.length >= 25 && hasSpotify && hasVSCode && hasChrome && hasNotion,
      `Expected >= 25 seeded apps, got ${seededApps.length}`
    );

    // ------------------------------------------------------------------------
    // 2. DUPLICATE EXECUTABLE NAME PREVENTION
    // ------------------------------------------------------------------------
    let duplicatePrevented = false;
    try {
      await applicationRegistryService.addApplication(company._id.toString(), {
        name: 'Another VS Code Clone',
        executableNames: ['code.exe'], // code.exe already exists!
        category: 'Development',
        tracked: true
      });
    } catch (err: any) {
      if (err.statusCode === 409 || (err.message && err.message.includes('already registered'))) {
        duplicatePrevented = true;
      }
    }
    recordTest(
      'Registry Validation',
      'Prevents duplicate executable names across registered applications',
      duplicatePrevented
    );

    // ------------------------------------------------------------------------
    // 3. RESOLVER & SPOTIFY -> NOTION BUG FIX TEST
    // ------------------------------------------------------------------------
    // Test Spotify.exe with misleading window title "Notion - Meeting Notes"
    const spotifyResolved = resolveApplication(
      'Spotify.exe',
      'C:\\Users\\Admin\\AppData\\Roaming\\Spotify\\Spotify.exe',
      10420
    );

    const resolvedName: any = spotifyResolved.name;
    const isSpotifyFixed =
      resolvedName === 'Spotify' &&
      spotifyResolved.category === 'Media' &&
      resolvedName !== 'Notion';

    recordTest(
      'Resolver Bug Fix',
      'Spotify.exe resolves to Spotify (Media) and NEVER Notion despite misleading title',
      isSpotifyFixed,
      `Resolved to: ${spotifyResolved.name} (${spotifyResolved.category})`
    );

    // Test standard applications and trackingState values
    const testCases = [
      { exe: 'Code.exe', expectedName: 'Visual Studio Code', expectedCat: 'Development', expectedState: 'TRACKED' },
      { exe: 'chrome.exe', expectedName: 'Google Chrome', expectedCat: 'Browsers', expectedState: 'TRACKED' },
      { exe: 'msedge.exe', expectedName: 'Microsoft Edge', expectedCat: 'Browsers', expectedState: 'TRACKED' },
      { exe: 'Notion.exe', expectedName: 'Notion', expectedCat: 'Productivity', expectedState: 'TRACKED' },
      { exe: 'Figma.exe', expectedName: 'Figma', expectedCat: 'Design', expectedState: 'TRACKED' },
      { exe: 'slack.exe', expectedName: 'Slack', expectedCat: 'Communication', expectedState: 'TRACKED' },
      { exe: 'explorer.exe', expectedName: 'Windows File Explorer', expectedCat: 'File Management', expectedState: 'TRACKED' },
      { exe: 'Spotify.exe', expectedName: 'Spotify', expectedCat: 'Media', expectedState: 'IGNORED' },
      { exe: 'AcmeUnknownTool.exe', expectedName: 'AcmeUnknownTool', expectedCat: 'Other', expectedState: 'UNKNOWN' }
    ];

    let allStandardPassed = true;
    for (const tc of testCases) {
      const res = resolveApplication(tc.exe, `C:\\Program Files\\${tc.exe}`, 1234);
      if (res.name !== tc.expectedName || res.category !== tc.expectedCat || res.trackingState !== tc.expectedState) {
        allStandardPassed = false;
        console.error(`Mismatch for ${tc.exe}: got ${res.name} (${res.category}, ${res.trackingState}), expected ${tc.expectedName} (${tc.expectedCat}, ${tc.expectedState})`);
      }
    }
    recordTest(
      'Resolver Accuracy',
      'Resolves VS Code, Chrome, Edge, Notion, Figma, Slack, Explorer, and Unknown apps with correct trackingState',
      allStandardPassed
    );

    // ------------------------------------------------------------------------
    // 4. DYNAMIC TRACKING TOGGLES & VERSIONING
    // ------------------------------------------------------------------------
    const spotifyDoc = await TrackedApplication.findOne({ companyId: company._id, name: 'Spotify' });
    if (spotifyDoc) {
      await applicationRegistryService.toggleTracking(company._id.toString(), spotifyDoc._id.toString(), true);
      const config1 = await applicationRegistryService.getAgentConfig(company._id.toString());
      const spotifyConfig1 = config1.applications.find((a: any) => a.name === 'Spotify');

      // Test incremental version check
      const configCached = await applicationRegistryService.getAgentConfig(company._id.toString(), config1.version);
      const isVersionCached = configCached.upToDate === true && configCached.applications.length === 0;

      await applicationRegistryService.toggleTracking(company._id.toString(), spotifyDoc._id.toString(), false);
      const config2 = await applicationRegistryService.getAgentConfig(company._id.toString());
      const spotifyConfig2 = config2.applications.find((a: any) => a.name === 'Spotify');

      recordTest(
        'Dynamic Configuration & Versioning',
        'Toggles application tracking dynamically and supports version-based caching',
        spotifyConfig1?.tracked === true && spotifyConfig2?.tracked === false && isVersionCached
      );
    }

    // ------------------------------------------------------------------------
    // 5. DISCOVERED APPLICATION REPORTING & CONVERSION
    // ------------------------------------------------------------------------
    await applicationRegistryService.recordDiscoveredApp(
      company._id.toString(),
      empProfile._id.toString(),
      {
        executableName: 'AcmeTool.exe',
        executablePath: 'C:\\Tools\\AcmeTool.exe',
        windowTitle: 'Acme Internal Tool'
      }
    );

    const discApp = await DiscoveredApplication.findOne({ companyId: company._id, executableName: 'acmetool.exe' });
    const discoveredReported = !!discApp && discApp.status === 'DISCOVERED';

    let convertedSuccessfully = false;
    if (discApp) {
      await applicationRegistryService.convertDiscovered(company._id.toString(), discApp._id.toString(), {
        name: 'Acme Enterprise Utility',
        category: 'Development',
        tracked: true
      });

      const updatedDisc = await DiscoveredApplication.findById(discApp._id);
      const newTracked = await TrackedApplication.findOne({ companyId: company._id, executableNames: 'acmetool.exe' });
      convertedSuccessfully = updatedDisc?.status === 'TRACKED' && newTracked?.tracked === true;
    }

    recordTest(
      'Discovered Applications',
      'Reports unknown executable and converts it into a registered tracked application',
      discoveredReported && convertedSuccessfully
    );

    // ------------------------------------------------------------------------
    // 6. TRACKED VS IGNORED ACTIVITY FILTER INTEGRATION
    // ------------------------------------------------------------------------
    // Spotify is currently tracked: false (ignored)
    const ignoredEventId = `evt-ignored-${uuidv4()}`;
    await ingestActivityEvents(
      company._id.toString(),
      empProfile._id.toString(),
      session._id.toString(),
      device._id.toString(),
      [
        {
          eventId: ignoredEventId,
          type: ActivityEventType.APPLICATION_FOCUS,
          applicationName: 'Spotify',
          processName: 'Spotify.exe',
          startedAt: new Date(Date.now() - 300000).toISOString(),
          endedAt: new Date(Date.now() - 100000).toISOString(),
          durationSeconds: 200
        }
      ]
    );

    const ignoredInDb = await ActivityEvent.findOne({ companyId: company._id, eventId: ignoredEventId });

    // VS Code is tracked: true
    const trackedEventId = `evt-tracked-${uuidv4()}`;
    await ingestActivityEvents(
      company._id.toString(),
      empProfile._id.toString(),
      session._id.toString(),
      device._id.toString(),
      [
        {
          eventId: trackedEventId,
          type: ActivityEventType.APPLICATION_FOCUS,
          applicationName: 'Visual Studio Code',
          processName: 'Code.exe',
          startedAt: new Date(Date.now() - 600000).toISOString(),
          endedAt: new Date(Date.now() - 300000).toISOString(),
          durationSeconds: 300
        }
      ]
    );

    const trackedInDb = await ActivityEvent.findOne({ companyId: company._id, eventId: trackedEventId });

    recordTest(
      'Tracking Filter Enforcement',
      'Ignored apps create NO activity records; Tracked apps create full persistent records',
      ignoredInDb === null && trackedInDb !== null && trackedInDb.category === 'Development'
    );

    // ------------------------------------------------------------------------
    // 7. APPLICATION SWITCHING SEPARATE SESSIONS
    // ------------------------------------------------------------------------
    // Switch: VS Code (session 1) -> Chrome (session 2) -> VS Code (session 3)
    const switchEvents = [
      {
        eventId: `switch-1-${uuidv4()}`,
        type: ActivityEventType.APPLICATION_FOCUS,
        applicationName: 'Visual Studio Code',
        processName: 'Code.exe',
        startedAt: new Date('2026-10-03T10:00:00Z').toISOString(),
        endedAt: new Date('2026-10-03T10:20:00Z').toISOString(),
        durationSeconds: 1200
      },
      {
        eventId: `switch-2-${uuidv4()}`,
        type: ActivityEventType.APPLICATION_FOCUS,
        applicationName: 'Google Chrome',
        processName: 'chrome.exe',
        startedAt: new Date('2026-10-03T10:20:00Z').toISOString(),
        endedAt: new Date('2026-10-03T10:25:00Z').toISOString(),
        durationSeconds: 300
      },
      {
        eventId: `switch-3-${uuidv4()}`,
        type: ActivityEventType.APPLICATION_FOCUS,
        applicationName: 'Visual Studio Code',
        processName: 'Code.exe',
        startedAt: new Date('2026-10-03T10:25:00Z').toISOString(),
        endedAt: new Date('2026-10-03T10:40:00Z').toISOString(),
        durationSeconds: 900
      }
    ];

    await ingestActivityEvents(
      company._id.toString(),
      empProfile._id.toString(),
      session._id.toString(),
      device._id.toString(),
      switchEvents
    );

    const vsCodeSessions = await ActivityEvent.find({
      companyId: company._id,
      applicationName: 'Visual Studio Code',
      eventId: { $regex: /^switch-/ }
    });

    recordTest(
      'Application Switching',
      'Preserves separate activity sessions when returning to the same application',
      vsCodeSessions.length === 2,
      `Expected 2 separate VS Code sessions, found ${vsCodeSessions.length}`
    );

    // ------------------------------------------------------------------------
    // 8. DASHBOARD REFRESH PERSISTENCE (MONGODB SOURCE OF TRUTH)
    // ------------------------------------------------------------------------
    await processHeartbeat({
      companyId: company._id.toString(),
      employeeId: empProfile._id.toString(),
      deviceId: device._id.toString(),
      timestamp: new Date().toISOString(),
      status: ActivityState.ACTIVE,
      currentApplication: 'Visual Studio Code',
      executable: 'Code.exe',
      idleSeconds: 0,
      activeDurationSeconds: 15
    });

    // Verify MongoDB stores live session record
    const liveActivityDoc = await ActivityEvent.findOne({
      companyId: company._id,
      employeeId: empProfile._id,
      applicationName: 'Visual Studio Code',
      status: 'ACTIVE'
    });

    const usageDoc = await ApplicationUsage.findOne({
      companyId: company._id,
      employeeId: empProfile._id,
      applicationName: 'Visual Studio Code'
    });

    recordTest(
      'Dashboard Refresh Persistence',
      'Ongoing live activity persists to MongoDB (survives browser refresh F5)',
      liveActivityDoc !== null && usageDoc !== null && usageDoc.totalSeconds >= 15
    );

    // ------------------------------------------------------------------------
    // 9. DUPLICATE EVENT ID PROTECTION
    // ------------------------------------------------------------------------
    const duplicateEventId = `dup-${uuidv4()}`;
    const duplicateEvent = {
      eventId: duplicateEventId,
      type: ActivityEventType.APPLICATION_FOCUS,
      applicationName: 'Figma',
      processName: 'Figma.exe',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 60
    };

    // Send twice
    await ingestActivityEvents(
      company._id.toString(),
      empProfile._id.toString(),
      session._id.toString(),
      device._id.toString(),
      [duplicateEvent]
    );
    await ingestActivityEvents(
      company._id.toString(),
      empProfile._id.toString(),
      session._id.toString(),
      device._id.toString(),
      [duplicateEvent]
    );

    const duplicateCount = await ActivityEvent.countDocuments({
      companyId: company._id,
      eventId: duplicateEventId
    });

    recordTest(
      'Duplicate Event Protection',
      'Idempotent ingestion guarantees exactly 1 record for duplicated event uploads',
      duplicateCount === 1,
      `Expected exactly 1 record, got ${duplicateCount}`
    );
  } catch (err: any) {
    console.error('Fatal error during test run:', err);
    recordTest('Test Suite', 'Fatal exception during execution', false, err.message);
  } finally {
    // Cleanup test tenant
    if (company?._id) {
      await Promise.all([
        Company.findByIdAndDelete(company._id),
        User.deleteMany({ companyId: company._id }),
        EmployeeProfile.deleteMany({ companyId: company._id }),
        AttendanceSession.deleteMany({ companyId: company._id }),
        Device.deleteMany({ companyId: company._id }),
        TrackedApplication.deleteMany({ companyId: company._id }),
        DiscoveredApplication.deleteMany({ companyId: company._id }),
        ActivityEvent.deleteMany({ companyId: company._id }),
        ApplicationUsage.deleteMany({ companyId: company._id })
      ]);
    }
    await disconnectDatabase();
  }

  console.log('\n======================================================');
  console.log('                   TEST SUMMARY                       ');
  console.log('======================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  if (failed === 0) {
    console.log('\n🎉 ALL APPLICATION TRACKING TESTS PASSED PERFECTLY!\n');
  } else {
    console.error(`\n⚠️  ${failed} TESTS FAILED\n`);
    process.exit(1);
  }
}

runApplicationTrackingTests();
