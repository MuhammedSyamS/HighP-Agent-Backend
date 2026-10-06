import mongoose from 'mongoose';
import { config } from '../config';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { EmployeeProfile } from '../models/EmployeeProfile';
import { AttendanceSession } from '../models/AttendanceSession';

async function checkShamData() {
  await mongoose.connect(config.mongoUri);
  const user = await User.findOne({ email: 'shamsaifudheen@gmail.com' }).lean();
  console.log('Sham User:', user);

  if (user) {
    const profile = await EmployeeProfile.findOne({ userId: user._id }).lean();
    console.log('Sham Profile:', profile);

    const sessions = await AttendanceSession.find({ employeeId: profile?._id }).lean();
    console.log(`Sham Sessions count: ${sessions.length}`);
  }

  await mongoose.disconnect();
}

checkShamData().catch(console.error);
