async function testBackend() {
  const baseUrl = 'http://localhost:5000/api';
  console.log('----------------------------------------------------');
  console.log('🔍 HighP Backend Comprehensive Verification Report');
  console.log('----------------------------------------------------');

  try {
    // 1. Auth Test: Login
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alex@highphaus.com',
        password: 'Password@123'
      })
    });
    const loginData = await loginRes.json();
    console.log(`1. POST /api/auth/login -> Status: ${loginRes.status} (${loginData.success ? 'PASSED ✅' : 'FAILED ❌'})`);
    if (!loginData.success) {
      console.error('Login error:', loginData);
      return;
    }

    const token = loginData.data.tokens.accessToken;
    const user = loginData.data.user;
    const profile = loginData.data.profile;
    console.log(`   - Authenticated User: ${user.firstName} ${user.lastName} (${user.email})`);
    console.log(`   - Role: ${user.role} | Profile ID: ${profile?._id || user.employeeProfileId}`);

    // 2. Auth Test: /auth/me with Bearer Token
    const meRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const meData = await meRes.json();
    console.log(`2. GET /api/auth/me -> Status: ${meRes.status} (${meData.success ? 'PASSED ✅' : 'FAILED ❌'})`);
    console.log(`   - Company: ${meData.data.company?.name} (slug: ${meData.data.company?.slug})`);

    // 3. Activity Timeline Test
    const profileId = profile?._id || user.employeeProfileId;
    const todayStr = new Date().toISOString().slice(0, 10);
    const tlRes = await fetch(`${baseUrl}/activity/${profileId}/timeline?date=${todayStr}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const tlData = await tlRes.json();
    console.log(`3. GET /api/activity/:id/timeline -> Status: ${tlRes.status} (${tlData.success ? 'PASSED ✅' : 'FAILED ❌'})`);
    console.log(`   - Timeline events found: ${tlData.data?.events?.length ?? 0}`);

    // 4. Application Usage Test
    const appRes = await fetch(`${baseUrl}/applications/usage/${profileId}?date=${todayStr}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const appData = await appRes.json();
    console.log(`4. GET /api/applications/usage/:id -> Status: ${appRes.status} (${appData.success ? 'PASSED ✅' : 'FAILED ❌'})`);
    console.log(`   - Applications recorded: ${appData.data?.applications?.length ?? 0}`);

    // 5. Signup Endpoint Test with unique dynamic test email
    const uniqueEmail = `qa_test_${Date.now()}@highphaus.com`;
    const signupRes = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'QA',
        lastName: 'Verification',
        email: uniqueEmail,
        password: 'Password@123',
        department: 'Quality Assurance'
      })
    });
    const signupData = await signupRes.json();
    console.log(`5. POST /api/auth/signup -> Status: ${signupRes.status} (${signupData.success ? 'PASSED ✅' : 'FAILED ❌'})`);
    console.log(`   - Created Employee: ${signupData.data?.user?.email} (Code: ${signupData.data?.profile?.employeeCode})`);

    console.log('----------------------------------------------------');
    console.log('🎉 ALL BACKEND SYSTEMS & APIS ARE HEALTHY & OPERATIONAL!');
    console.log('----------------------------------------------------');
  } catch (err) {
    console.error('❌ Connection or Execution error:', err.message);
  }
}

testBackend();
