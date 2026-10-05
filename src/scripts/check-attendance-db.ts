import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb+srv://shamsaifudheen_db_user:Stm6NhQ2yWcVdNwG@agent.epapfo7.mongodb.net/highphaus?retryWrites=true&w=majority';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;

  console.log('\n=== RECENT 10 ATTENDANCE SESSIONS ===');
  const sessions = await db.collection('attendancesessions').find({}).sort({ startedAt: -1 }).limit(10).toArray();
  for (const s of sessions) {
    console.log(JSON.stringify({
      _id: s._id,
      employeeId: s.employeeId,
      companyId: s.companyId,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      activeSeconds: s.activeSeconds,
      idleSeconds: s.idleSeconds,
      breakSeconds: s.breakSeconds,
      endReason: s.endReason,
      diffSec: s.endedAt && s.startedAt ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000) : null
    }, null, 2));
  }

  console.log('\n=== EMPLOYEE PROFILES ===');
  const profiles = await db.collection('employeeprofiles').find({}).toArray();
  for (const p of profiles) {
    console.log(JSON.stringify({
      _id: p._id,
      employeeCode: p.employeeCode,
      currentStatus: p.currentStatus,
      currentSessionId: p.currentSessionId,
      todayActiveSeconds: p.todayActiveSeconds,
      todayIdleSeconds: p.todayIdleSeconds,
      todayBreakSeconds: p.todayBreakSeconds,
      todayShiftStartedAt: p.todayShiftStartedAt,
      todayShiftEndedAt: p.todayShiftEndedAt,
      todayAttendanceStatus: p.todayAttendanceStatus,
      lastDateReset: p.lastDateReset
    }, null, 2));
  }

  console.log('\n=== RECENT 5 DAILY SUMMARIES ===');
  const summaries = await db.collection('dailysummaries').find({}).sort({ date: -1 }).limit(5).toArray();
  for (const sum of summaries) {
    console.log(JSON.stringify({
      _id: sum._id,
      employeeId: sum.employeeId,
      date: sum.date,
      totalSessionSeconds: sum.totalSessionSeconds,
      activeSeconds: sum.activeSeconds,
      idleSeconds: sum.idleSeconds,
      breakSeconds: sum.breakSeconds,
      firstSessionStart: sum.firstSessionStart,
      lastSessionEnd: sum.lastSessionEnd
    }, null, 2));
  }

  await mongoose.disconnect();
}

main().catch(console.error);
