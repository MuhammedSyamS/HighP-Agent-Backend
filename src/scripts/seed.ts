import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Company } from '../models/Company';
import { User } from '../models/User';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { Break } from '../models/Break';
import { ActivityEvent } from '../models/ActivityEvent';
import { ApplicationUsage } from '../models/ApplicationUsage';
import { Device } from '../models/Device';
import { Subscription } from '../models/Subscription';
import {
  UserRole,
  UserStatus,
  ActivityState,
  SessionStatus,
  ActivityEventType,
  BreakReason,
  DeviceStatus,
  SubscriptionTier,
  SubscriptionStatus,
  DEFAULT_APP_CATEGORIES
} from '@highp/shared';
import { v4 as uuidv4 } from 'uuid';

export const seedDatabase = async () => {
  await connectDatabase();
  console.log('[Seed] Clearing existing collections...');

  await Promise.all([
    Company.deleteMany({}),
    User.deleteMany({}),
    EmployeeProfile.deleteMany({}),
    AttendanceSession.deleteMany({}),
    Break.deleteMany({}),
    ActivityEvent.deleteMany({}),
    ApplicationUsage.deleteMany({}),
    Device.deleteMany({}),
    Subscription.deleteMany({})
  ]);

  console.log('[Seed] Creating Highphaus Creative Digital Marketing Agency...');
  const highphaus = await Company.create({
    name: 'Highphaus Creative Agency',
    slug: 'highphaus',
    config: {
      idleThresholdMinutes: 5,
      heartbeatIntervalSeconds: 30,
      offlineSyncBatchLimit: 100,
      retentionDays: 365,
      allowManualBreaks: true,
      appCategories: DEFAULT_APP_CATEGORIES
    }
  });

  // Dedicated Agency Subscription
  await Subscription.create({
    companyId: highphaus._id,
    tier: SubscriptionTier.ENTERPRISE,
    status: SubscriptionStatus.ACTIVE,
    maxEmployees: 1000,
    features: ['all']
  });

  // Highphaus Internal Team Members
  const highphausTeam = [
    {
      email: 'admin@highphaus.com',
      firstName: 'Admin',
      lastName: 'Highphaus',
      role: UserRole.OWNER,
      code: 'HP-001',
      dept: 'Executive & Leadership',
      title: 'Managing Director / Founder',
      status: ActivityState.ACTIVE,
      app: 'Slack'
    },
    {
      email: 'manager@highphaus.com',
      firstName: 'Priya',
      lastName: 'Sharma',
      role: UserRole.MANAGER,
      code: 'HP-002',
      dept: 'Operations & Strategy',
      title: 'Operations Director',
      status: ActivityState.ACTIVE,
      app: 'Notion'
    },
    {
      email: 'alex@highphaus.com',
      firstName: 'Alex',
      lastName: 'Rivers',
      role: UserRole.EMPLOYEE,
      code: 'HP-003',
      dept: 'Development & Engineering',
      title: 'Lead Full-Stack Developer',
      status: ActivityState.ACTIVE,
      app: 'VS Code'
    },
    {
      email: 'maya@highphaus.com',
      firstName: 'Maya',
      lastName: 'Patel',
      role: UserRole.EMPLOYEE,
      code: 'HP-004',
      dept: 'Creative & UI/UX Design',
      title: 'Senior UI/UX Designer',
      status: ActivityState.ACTIVE,
      app: 'Figma'
    },
    {
      email: 'rohan@highphaus.com',
      firstName: 'Rohan',
      lastName: 'Mehta',
      role: UserRole.EMPLOYEE,
      code: 'HP-005',
      dept: 'Digital Marketing & SEO',
      title: 'Growth Marketing & SEO Lead',
      status: ActivityState.IDLE,
      app: 'Google Chrome'
    },
    {
      email: 'ananya@highphaus.com',
      firstName: 'Ananya',
      lastName: 'Iyer',
      role: UserRole.EMPLOYEE,
      code: 'HP-006',
      dept: 'Content & Social Media',
      title: 'Content Strategist',
      status: ActivityState.OFFLINE,
      app: ''
    }
  ];

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const sessionStartTime = new Date(now.getTime() - 4.5 * 60 * 60 * 1000);

  for (const item of highphausTeam) {
    const user = new User({
      email: item.email,
      passwordHash: 'Password@123',
      firstName: item.firstName,
      lastName: item.lastName,
      role: item.role,
      companyId: highphaus._id,
      status: UserStatus.ACTIVE
    });
    await user.save();

    const profile = await EmployeeProfile.create({
      companyId: highphaus._id,
      userId: user._id,
      employeeCode: item.code,
      department: item.dept,
      designation: item.title,
      currentStatus: item.status,
      currentApplication: item.app,
      lastActiveAt: item.status !== ActivityState.OFFLINE ? now : undefined,
      lastHeartbeatAt: item.status !== ActivityState.OFFLINE ? now : undefined,
      todayActiveSeconds: item.status === ActivityState.OFFLINE ? 0 : 3.8 * 3600,
      todayIdleSeconds: item.status === ActivityState.OFFLINE ? 0 : 800,
      todayBreakSeconds: item.status === ActivityState.OFFLINE ? 0 : 1800,
      lastDateReset: todayStr
    });

    user.employeeProfileId = profile._id;
    await user.save();

    if (item.email === 'admin@highphaus.com') {
      highphaus.ownerId = user._id;
      await highphaus.save();
    }

    // Workstation Device
    const device = await Device.create({
      companyId: highphaus._id,
      employeeId: profile._id,
      deviceId: `DEV-${item.code}-WIN`,
      deviceName: `${item.firstName}-Workstation`,
      osInfo: {
        platform: 'win32',
        release: '10.0.22631',
        arch: 'x64',
        hostname: `${item.firstName.toLowerCase()}-pc`
      },
      agentVersion: '1.0.0',
      status: DeviceStatus.ACTIVE,
      lastHeartbeatAt: now,
      lastIpAddress: '192.168.1.50'
    });

    if (item.status !== ActivityState.OFFLINE) {
      const session = await AttendanceSession.create({
        companyId: highphaus._id,
        employeeId: profile._id,
        deviceId: device._id,
        startedAt: sessionStartTime,
        activeSeconds: 3.8 * 3600,
        idleSeconds: 800,
        breakSeconds: 1800,
        status: SessionStatus.ACTIVE
      });

      profile.currentSessionId = session._id;
      profile.currentDeviceId = device._id;
      await profile.save();

      // Lunch break
      await Break.create({
        companyId: highphaus._id,
        employeeId: profile._id,
        sessionId: session._id,
        startedAt: new Date(sessionStartTime.getTime() + 2.5 * 3600 * 1000),
        endedAt: new Date(sessionStartTime.getTime() + 3 * 3600 * 1000),
        durationSeconds: 1800,
        reason: BreakReason.LUNCH,
        note: 'Afternoon lunch break'
      });

      // Tailored activity events for agency apps
      const defaultApps = [
        { name: 'VS Code', proc: 'Code.exe', dur: 5400, cat: 'Development & Engineering' },
        { name: 'Figma', proc: 'Figma.exe', dur: 3600, cat: 'Design & Creative' },
        { name: 'Slack', proc: 'slack.exe', dur: 2400, cat: 'Agency Communication' },
        { name: 'Google Chrome', proc: 'chrome.exe', dur: 1800, cat: 'Browsing & Research' },
        { name: 'Notion', proc: 'Notion.exe', dur: 1200, cat: 'Project Management & Docs' }
      ];

      // Use a distinct set of apps per employee
      const apps = defaultApps.filter(a => a.name !== item.app);
      if (item.app) {
        apps.unshift({
          name: item.app,
          proc: `${item.app.toLowerCase().replace(/\s+/g, '')}.exe`,
          dur: 6000,
          cat: item.dept.includes('Creative') ? 'Design & Creative' :
               item.dept.includes('Marketing') ? 'Digital Marketing & SEO' :
               item.dept.includes('Leadership') ? 'Agency Communication' :
               item.dept.includes('Operations') ? 'Project Management & Docs' : 'Development & Engineering'
        });
      }

      let runningTime = new Date(sessionStartTime.getTime());
      for (const app of apps.slice(0, 4)) {
        const endTime = new Date(runningTime.getTime() + app.dur * 1000);
        await ActivityEvent.create({
          eventId: uuidv4(),
          companyId: highphaus._id,
          employeeId: profile._id,
          sessionId: session._id,
          deviceId: device._id,
          type: ActivityEventType.APPLICATION_FOCUS,
          applicationName: app.name,
          processName: app.proc,
          startedAt: runningTime,
          endedAt: endTime,
          durationSeconds: app.dur
        });
        runningTime = endTime;

        await ApplicationUsage.findOneAndUpdate(
          {
            companyId: highphaus._id,
            employeeId: profile._id,
            date: todayStr,
            applicationName: app.name
          },
          {
            $set: {
              category: app.cat,
              lastUsedAt: endTime
            },
            $inc: {
              totalSeconds: app.dur
            }
          },
          { upsert: true, new: true }
        );
      }
    }
  }

  console.log('[Seed] Highphaus Internal Agency Database seeded successfully!');
  console.log('==================================================');
  console.log('Highphaus Agency Credentials:');
  console.log('  Admin/Owner: admin@highphaus.com / Password@123');
  console.log('  Manager:     manager@highphaus.com / Password@123');
  console.log('  Developer:   alex@highphaus.com / Password@123');
  console.log('  Designer:    maya@highphaus.com / Password@123');
  console.log('==================================================');

  await disconnectDatabase();
};

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed] Error seeding database:', err);
      process.exit(1);
    });
}
