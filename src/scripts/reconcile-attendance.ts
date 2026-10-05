import mongoose from 'mongoose';
import { config } from '../config';
import { AttendanceSession } from '../models/AttendanceSession';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { rebuildEmployeeDay } from '../services/rebuildService';
import { getDateStringInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';
import { Company } from '../models/Company';

async function reconcile() {
  await mongoose.connect(config.mongoUri);
  console.log('Connected to MongoDB.');

  const profiles = await EmployeeProfile.find({}).lean();
  for (const p of profiles) {
    const company = await Company.findById(p.companyId).lean();
    const companyTz = company?.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
    const todayStr = getDateStringInTimezone(new Date(), companyTz);

    // Clean up negative activeSeconds on all sessions
    const badSessions = await AttendanceSession.find({
      employeeId: p._id,
      $or: [{ activeSeconds: { $lt: 0 } }, { idleSeconds: { $lt: 0 } }, { breakSeconds: { $lt: 0 } }]
    });

    for (const s of badSessions) {
      console.log(`Fixing negative counters on session ${s._id}: active=${s.activeSeconds}, idle=${s.idleSeconds}`);
      s.activeSeconds = Math.max(0, s.activeSeconds || 0);
      s.idleSeconds = Math.max(0, s.idleSeconds || 0);
      s.breakSeconds = Math.max(0, s.breakSeconds || 0);
      await s.save();
    }

    // Authoritative rebuild of today's stats
    console.log(`Rebuilding today (${todayStr}) for employee ${p.employeeCode || p._id}...`);
    const result = await rebuildEmployeeDay(p.companyId.toString(), p._id.toString(), todayStr);
    console.log('Rebuild result:', result);

    const refreshed = await EmployeeProfile.findById(p._id).lean();
    console.log(`Refreshed Profile: todayActive=${refreshed?.todayActiveSeconds}s, todayIdle=${refreshed?.todayIdleSeconds}s, todayBreak=${refreshed?.todayBreakSeconds}s`);
  }

  await mongoose.disconnect();
  console.log('Reconciliation complete.');
}

reconcile().catch(console.error);
