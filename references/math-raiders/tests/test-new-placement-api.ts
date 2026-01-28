const TIMEBACK_BASE_URL = 'https://api.alpha-1edtech.com';
const AUTH_URL = 'https://alpha-auth-production-idp.auth.us-west-2.amazoncognito.com/oauth2/token';
const CLIENT_ID = '10pa2e6nmf9cqq7umpg36rmfba';
const CLIENT_SECRET = '1gqp57138tacmj3gdnlqtiodqlkj8q6g8be6lft042jkovkgr8t1';

async function fetchAccessToken(): Promise<string> {
  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!response.ok) throw new Error(`OAuth failed: ${response.status}`);
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error('No access_token');
  return data.access_token;
}

async function testNewPlacementAPI() {
  const timebackId = process.argv[2] || 'b9a646b7-990c-4876-8568-de6b4da6e28b';
  
  console.log('🆕 Testing NEW Placement API\n');
  console.log(`GET /powerpath/placement/{studentId}\n`);
  console.log(`TimeBack ID: ${timebackId}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const token = await fetchAccessToken();
  
  const url = `${TIMEBACK_BASE_URL}/powerpath/placement/${timebackId}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  });
  
  if (!response.ok) {
    console.log(`❌ Failed: ${response.status}`);
    console.log(await response.text());
    return;
  }
  
  const data = await response.json();
  
  console.log('✅ Full Response:');
  console.log(JSON.stringify(data, null, 2));
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Extract Math subject data
  if (data.Math) {
    console.log('📚 Math Subject Data:');
    console.log(`   Current Grade: ${data.Math.currentGrade}`);
    console.log(`   Starting Grade: ${data.Math.startingGrade}`);
    console.log(`   Status: ${data.Math.status}`);
    console.log(`   Lowest Grade: ${data.Math.subjectLowestGrade}`);
    console.log(`   Highest Grade: ${data.Math.subjectHighestGrade}\n`);
    
    if (data.Math.results && data.Math.results.length > 0) {
      console.log('   Test Results:');
      data.Math.results.forEach((result: any) => {
        console.log(`     Grade ${result.grade}: Score ${result.score}/${result.maxScore} (Source: ${result.source})`);
      });
    }
  } else {
    console.log('⚠️  No Math subject data found\n');
  }
}

testNewPlacementAPI().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
