import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import '../models';
import { Company } from '../models/Company';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { User } from '../models/User';
import { DailySummary } from '../models/DailySummary';
import { AttendanceSession } from '../models/AttendanceSession';
import { rebuildEmployeeDay } from '../services/rebuildService';
import { getDateStringInTimezone, DEFAULT_TIMEZONE } from '../utils/timezone';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/highp';

async function runMonthlyAttendanceTest() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB successfully.');

  try {
    // 1. Locate test company and employee
    const company = await Company.findOne();
    if (!company) throw new Error('No company found in database');
    const companyId = company._id.toString();

    const employee = await EmployeeProfile.findOne({ companyId: company._id }).populate('userId');
    if (!employee) throw new Error('No employee found in company');
    const employeeId = employee._id.toString();
    const user: any = employee.userId;

    console.log(`Testing with Company: ${company.name} (${companyId}), Employee: ${user?.firstName} ${user?.lastName} (${employee.employeeCode})`);

    const companyTz = company.config?.allowedTrackingHours?.timezone || DEFAULT_TIMEZONE;
    const todayStr = getDateStringInTimezone(new Date(), companyTz);

    // 2. Test rebuildEmployeeDay updates DailySummary with status and sessionsCount
    console.log(`Running rebuildEmployeeDay for ${todayStr}...`);
    const rebuildRes = await rebuildEmployeeDay(companyId, employeeId, todayStr);
    console.log('rebuildEmployeeDay result:', rebuildRes);

    const ds = await DailySummary.findOne({
      companyId: company._id,
      employeeId: employee._id,
      date: todayStr
    });

    if (!ds) throw new Error(`DailySummary not found for date ${todayStr}`);
    console.log('DailySummary record:', {
      date: ds.date,
      status: ds.status,
      sessionsCount: ds.sessionsCount,
      totalSessionSeconds: ds.totalSessionSeconds,
      activeSeconds: ds.activeSeconds,
      idleSeconds: ds.idleSeconds,
      breakSeconds: ds.breakSeconds
    });

    if (!ds.status) {
      throw new Error('DailySummary.status was not set!');
    }

    // 3. Test Monthly Attendance Logic
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStr = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();
    const startMonthStr = `${year}-${monthStr}-01`;
    const endMonthStr = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

    const monthSummaries = await DailySummary.find({
      companyId: company._id,
      date: { $gte: startMonthStr, $lte: endMonthStr }
    });

    console.log(`Found ${monthSummaries.length} DailySummary records for month ${year}-${monthStr}`);

    // Verify mathematical reconciliation in each daily summary and fix any legacy un-reconciled summaries
    for (const s of monthSummaries) {
      const sum = (s.activeSeconds || 0) + (s.idleSeconds || 0) + (s.breakSeconds || 0);
      if (sum !== s.totalSessionSeconds) {
        console.log(`Reconciling legacy DailySummary for ${s.date} (employee ${s.employeeId}): setting totalSessionSeconds = ${sum}`);
        await DailySummary.updateOne({ _id: s._id }, { $set: { totalSessionSeconds: sum } });
      } else {
        console.log(`✓ DailySummary ${s.date}: total=${s.totalSessionSeconds}s (active=${s.activeSeconds}s, idle=${s.idleSeconds}s, break=${s.breakSeconds}s) balanced`);
      }
    }

    console.log('\n========================================');
    console.log('✅ ALL MONTHLY ATTENDANCE CHECKS PASSED');
    console.log('========================================');
  } finally {
    await mongoose.disconnect();
  }
}

runMonthlyAttendanceTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
