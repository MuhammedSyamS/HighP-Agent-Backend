const mongoose = require('mongoose');
require('dotenv').config();

async function checkReaperQuery() {
  await mongoose.connect(process.env.MONGODB_URI);
  const cutoff = new Date(Date.now() - 90000);
  console.log('Cutoff:', cutoff);

  const matched = await mongoose.connection.collection('employeeprofiles').find({
    currentStatus: { $in: ['ACTIVE', 'IDLE'] },
    lastHeartbeatAt: { $lt: cutoff }
  }).toArray();

  console.log('Profiles matching reaper query:', matched.length);
  matched.forEach(p => console.log('Matched:', p.employeeCode, 'currentStatus:', p.currentStatus, 'lastHeartbeatAt:', p.lastHeartbeatAt));

  await mongoose.disconnect();
}

checkReaperQuery();
