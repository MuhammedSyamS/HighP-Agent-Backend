import mongoose from 'mongoose';
import { config } from '../config';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';
import { ActivityEvent } from '../models/ActivityEvent';
import { DailySummary } from '../models/DailySummary';
import { Break } from '../models/Break';
import { Otp } from '../models/Otp';

async function inspectData() {
  await mongoose.connect(config.mongoUri);
  console.log('Connected to MongoDB.');

  const users = await User.find({}, { email: 1, role: 1, companyId: 1, employeeProfileId: 1 }).lean();
  console.log('USERS IN DB:');
  console.log(JSON.stringify(users, null, 2));

  const companies = await Company.find({}, { name: 1, slug: 1 }).lean();
  console.log('\nCOMPANIES IN DB:');
  console.log(JSON.stringify(companies, null, 2));

  const profiles = await EmployeeProfile.find({}, { employeeCode: 1, userId: 1, department: 1 }).lean();
  console.log(`\nEmployeeProfiles count: ${profiles.length}`);

  const sessionsCount = await AttendanceSession.countDocuments();
  console.log(`AttendanceSessions count: ${sessionsCount}`);

  const eventsCount = await ActivityEvent.countDocuments();
  console.log(`ActivityEvents count: ${eventsCount}`);

  const summariesCount = await DailySummary.countDocuments();
  console.log(`DailySummaries count: ${summariesCount}`);

  const breaksCount = await BreakLog.countDocuments();
  console.log(`BreakLogs count: ${breaksCount}`);

  const otpsCount = await Otp.countDocuments();
  console.log(`Otps count: ${otpsCount}`);

  await mongoose.disconnect();
}

inspectData().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
