import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb+srv://shamsaifudheen_db_user:Stm6NhQ2yWcVdNwG@agent.epapfo7.mongodb.net/highphaus?retryWrites=true&w=majority';

async function main() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db!;

  // Let's get company timezone
  const company = await db.collection('companies').findOne({});
  console.log('Company:', company?.name, 'Timezone:', company?.config?.allowedTrackingHours?.timezone);

  // Find all sessions for 2026-10-05
  const startOfToday = new Date('2026-10-04T18:30:00.000Z'); // 00:00 IST on Oct 5
  const endOfToday = new Date('2026-10-05T18:29:59.999Z'); // 23:59:59 IST on Oct 5

  console.log('\n=== ALL SESSIONS TODAY (Oct 5 IST) ===');
  const sessions = await db.collection('attendancesessions').find({
    startedAt: { $gte: startOfToday, $lte: endOfToday }
  }).sort({ startedAt: 1 }).toArray();

  for (const s of sessions) {
    const emp = await db.collection('employeeprofiles').findOne({ _id: s.employeeId });
    console.log({
      sessionId: s._id,
      empCode: emp?.employeeCode,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      activeSeconds: s.activeSeconds,
      idleSeconds: s.idleSeconds,
      breakSeconds: s.breakSeconds,
      endReason: s.endReason,
      diffSec: s.endedAt ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000) : null
    });
  }

  console.log('\n=== ACTIVITY EVENTS TODAY ===');
  const eventCount = await db.collection('activityevents').countDocuments({
    startedAt: { $gte: startOfToday, $lte: endOfToday }
  });
  console.log('Total ActivityEvents today:', eventCount);

  const sampleEvents = await db.collection('activityevents').find({
    startedAt: { $gte: startOfToday, $lte: endOfToday }
  }).limit(5).toArray();
  for (const e of sampleEvents) {
    console.log({
      type: e.type,
      appName: e.applicationName,
      dur: e.durationSeconds,
      startedAt: e.startedAt,
      endedAt: e.endedAt
    });
  }

  await mongoose.disconnect();
}

main().catch(console.error);
