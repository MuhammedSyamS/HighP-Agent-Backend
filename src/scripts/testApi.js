const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

async function testApi() {
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await mongoose.connection.collection('users').findOne({ email: 'shamsaifudheen@gmail.com' });
  console.log('User found:', user);

  // Generate token exactly as backend authService generates it
  const token = jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      companyId: user.companyId.toString()
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  console.log('Generated token for HR');

  const http = require('http');

  const makeReq = (path) => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 5000,
        path: '/api' + path,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        });
      });
      req.on('error', reject);
      req.end();
    });
  };

  try {
    const overview = await makeReq('/employees/overview');
    console.log('Overview response:', JSON.stringify(overview, null, 2));

    const employees = await makeReq('/employees');
    console.log('Employees status:', employees.status);
    console.log('Employees count:', employees.body?.data?.length);
    console.log('Employees data:', JSON.stringify(employees.body, null, 2));
  } catch (err) {
    console.error('Request error:', err);
  }

  await mongoose.disconnect();
}

testApi();
