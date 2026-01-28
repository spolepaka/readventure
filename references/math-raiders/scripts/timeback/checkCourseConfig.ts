#!/usr/bin/env bun

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = Bun.env.TIMEBACKCLIENTID || Bun.env.TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = Bun.env.TIMEBACKSECRET || Bun.env.TIMEBACK_CLIENT_SECRET;

const COURSE_ID = "fe15be0a-9f8d-4251-b000-402c6581617f"; // Math Raiders K-5

async function fetchAccessToken(): Promise<string> {
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch token (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error('No access_token in response');
  return data.access_token;
}

async function checkCourseConfig() {
  console.log('🔍 Checking Math Raiders course configuration...\n');
  
  const token = await fetchAccessToken();
  const endpoint = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/${COURSE_ID}`;
  
  console.log(`Fetching: ${endpoint}\n`);
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch course (${response.status}): ${text}`);
  }
  
  const data = await response.json();
  
  console.log('✅ Course Retrieved:\n');
  console.log(JSON.stringify(data, null, 2));
  
  console.log('\n📊 Key Configuration:');
  console.log('   Course ID:', data.course?.sourcedId || 'N/A');
  console.log('   Title:', data.course?.title || 'N/A');
  console.log('   Grades:', data.course?.grades || 'N/A');
  console.log('   Metadata:', data.course?.metadata || 'N/A');
  
  // Verify grade-specific configuration
  if (data.course?.metadata) {
    const meta = data.course.metadata;
    
    console.log('\n✅ GRADE-SPECIFIC CONFIGURATION:');
    if (meta.gradeUnits) {
      console.log('\n   Grade Units (for percent_complete):');
      Object.entries(meta.gradeUnits).forEach(([grade, units]) => {
        const gradeLabel = grade === '0' ? 'K' : `G${grade}`;
        const xp = meta.gradeXP?.[grade] || 'N/A';
        console.log(`     ${gradeLabel}: ${units} facts, ${xp} minutes`);
      });
    } else {
      console.log('   ⚠️  No gradeUnits configured');
    }
    
    console.log('\n🎯 FOR GRADE 4 PILOT:');
    console.log(`   Total Facts: ${meta.gradeUnits?.['4'] || 'NOT SET'}`);
    console.log(`   Total XP: ${meta.gradeXP?.['4'] || 'NOT SET'} minutes`);
    console.log(`   Expected: 313 facts, ~1000 minutes`);
    
    const g4Match = meta.gradeUnits?.['4'] === 313;
    console.log(`   Status: ${g4Match ? '✅ CORRECT' : '❌ NEEDS UPDATE'}`);
  }
}

checkCourseConfig().catch(error => {
  console.error('❌ Error:', error.message);
  process.exitCode = 1;
});

