import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb+srv://shamsaifudheen_db_user:Stm6NhQ2yWcVdNwG@agent.epapfo7.mongodb.net/highphaus?retryWrites=true&w=majority';

async function main() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db!;

  console.log('--- ALL DAILY SUMMARIES ---');
  const summaries = await db.collection('dailysummaries').find({}).toArray();
  for (const s of summaries) {
    console.log({
      date: s.date,
      empId: s.employeeId,
      totalSessionSeconds: s.totalSessionSeconds,
      activeSeconds: s.activeSeconds,
      idleSeconds: s.idleSeconds,
      breakSeconds: s.breakSeconds,
      totalShiftDurFormatted: `${Math.floor(s.totalSessionSeconds / 3600)}h ${Math.floor((s.totalSessionSeconds % 3600) / 60)}m`,
      activeFormatted: `${Math.floor(s.activeSeconds / 3600)}h ${Math.floor((s.activeSeconds % 3600) / 60)}m`,
      idleFormatted: `${Math.floor(s.idleSeconds / 3600)}h ${Math.floor((s.idleSeconds % 3600) / 60)}m`,
      firstSessionStart: s.firstSessionStart,
      lastSessionEnd: s.lastSessionEnd
    });
  }

  console.log('--- PAST SESSIONS WITH IDLE > 1000s OR DURATION > 10000s ---');
  const sessions = await db.collection('attendancesessions').find({
    $or: [
      { idleSeconds: { $gt: 1000 } },
      { activeSeconds: { $gt: 1000 } }
    ]
  }).toArray();
  for (const s of sessions) {
    const diffSec = s.endedAt ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000) : 0;
    console.log({
      id: s._id,
      empId: s.employeeId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      activeSeconds: s.activeSeconds,
      idleSeconds: s.idleSeconds,
      diffSec,
      activeFmt: `${Math.floor((s.activeSeconds || 0) / 3600)}h ${Math.floor(((s.activeSeconds || 0) % 3600) / 60)}m`,
      idleFmt: `${Math.floor((s.idleSeconds || 0) / 3600)}h ${Math.floor(((s.idleSeconds || 0) % 3600) / 60)}m`,
      diffFmt: `${Math.floor(diffSec / 3600)}h ${Math.floor((diffSec % 3600) / 60)}m`,
      endReason: s.endReason
    });
  }

  await mongoose.disconnect();
}

main().catch(console.error);
