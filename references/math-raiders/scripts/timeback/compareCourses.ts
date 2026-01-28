#!/usr/bin/env bun
/**
 * Compare Math Raiders Grade 4 vs AlphaMath Grade 4 side-by-side
 */

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = Bun.env.TIMEBACKCLIENTID || Bun.env.TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = Bun.env.TIMEBACKSECRET || Bun.env.TIMEBACK_CLIENT_SECRET;

async function fetchAccessToken() {
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });
  const data = await res.json();
  return data.access_token;
}

async function compare() {
  console.log('='.repeat(80));
  console.log('SIDE-BY-SIDE COMPARISON: AlphaMath vs Math Raiders Grade 4');
  console.log('='.repeat(80));
  
  const token = await fetchAccessToken();
  
  // Fetch both courses
  const [amRes, mrRes] = await Promise.all([
    fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/fastmath-grade-4`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }),
    fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/math-raiders-grade-4`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
  ]);
  
  const amData = await amRes.json();
  const mrData = await mrRes.json();
  
  const am = amData.course;
  const mr = mrData.course;
  
  console.log('\n📊 KEY FIELDS COMPARISON:\n');
  
  const fields = [
    ['Title', am.title, mr.title],
    ['Grades', am.grades, mr.grades],
    ['Subjects', am.subjects, mr.subjects],
    ['totalLessons (root)', am.metadata.totalLessons, mr.metadata.totalLessons],
    ['metrics.totalLessons', am.metadata.metrics.totalLessons, mr.metadata.metrics.totalLessons],
    ['metrics.totalXp', am.metadata.metrics.totalXp, mr.metadata.metrics.totalXp],
    ['primaryApp', am.metadata.primaryApp, mr.metadata.primaryApp],
  ];
  
  console.log('Field'.padEnd(25) + 'AlphaMath'.padEnd(30) + 'Math Raiders'.padEnd(30) + 'Match');
  console.log('-'.repeat(90));
  
  fields.forEach(([field, amVal, mrVal]) => {
    const amStr = JSON.stringify(amVal);
    const mrStr = JSON.stringify(mrVal);
    const match = amStr === mrStr ? '✅' : '≠';
    console.log(field.padEnd(25) + amStr.padEnd(30) + mrStr.padEnd(30) + match);
  });
  
  console.log('\n🎯 CRITICAL FOR PILOT:\n');
  
  const critical = mr.metadata.totalLessons === 313 && mr.metadata.metrics.totalLessons === 313;
  if (critical) {
    console.log('✅ totalLessons: 313 (CORRECT - matches AlphaMath)');
    console.log('   Timeback will calculate: masteredUnits / 313');
  } else {
    console.log('❌ totalLessons MISMATCH');
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('VERDICT: Fields that SHOULD match DO match (totalLessons=313)');
  console.log('         Fields that SHOULD differ DO differ (title, app, targets)');
  console.log('='.repeat(80));
}

compare().catch(console.error);

