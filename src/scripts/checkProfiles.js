const mongoose = require('mongoose');
require('dotenv').config();

async function checkProfiles() {
  await mongoose.connect(process.env.MONGODB_URI);
  const profiles = await mongoose.connection.collection('employeeprofiles').find({}).toArray();
  for (const p of profiles) {
    console.log(`Code: ${p.employeeCode}, currentStatus: ${p.currentStatus}, currentSessionId: ${p.currentSessionId}, lastActiveAt: ${p.lastActiveAt}, lastHeartbeatAt: ${p.lastHeartbeatAt}`);
  }
  await mongoose.disconnect();
}

checkProfiles();
