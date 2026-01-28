#!/usr/bin/env bun
import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

// Usage: bun checkAssessment.ts <email> <date>
// Example: bun checkAssessment.ts renee.parnell@2hourlearning.com 2025-11-11
// Shows ONLY Speed Score tests (AMF assessments)

const email = process.argv[2];
const targetDate = process.argv[3];

if (!email || !targetDate) {
  console.log('Usage: bun checkAssessment.ts <email> <date>');
  console.log('Example: bun checkAssessment.ts renee.parnell@2hourlearning.com 2025-11-11');
  console.log('\nShows Speed Score tests only (not practice, not Math Raiders)');
  process.exit(1);
}

async function getToken() {
  const { clientId, clientSecret } = await getTimebackCredentials();
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  return (await res.json()).access_token;
}

const token = await getToken();

// Get user
const userRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`, {
  headers: { 'Authorization': `Bearer ${token}` }
});

const userData = await userRes.json();
const user = userData.users?.[0];

if (!user) {
  console.log(`❌ User not found: ${email}`);
  process.exit(1);
}

console.log(`📊 Assessment Results for ${targetDate}\n`);
console.log('='.repeat(100));
console.log(`👤 ${user.givenName} ${user.familyName} (${email})`);
console.log(`   TimeBack ID: ${user.sourcedId}\n`);

// Get recent assessment results sorted newest-first
// For recent dates, 1000 is plenty; for historical, may need more
const resultsRes = await fetch(
  `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${user.sourcedId}'&limit=1000&sort=scoreDate&orderBy=desc`, 
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

const resultsData = await resultsRes.json();
const allResults = resultsData.assessmentResults || [];

console.log(`   Fetched ${allResults.length} recent results (for historical dates, increase limit)\n`);

// Filter for Speed Score tests on target date
const speedScoreTests = allResults.filter((r: any) => {
  const date = r.scoreDate.substring(0, 10);
  const lineItem = r.assessmentLineItem?.sourcedId || '';
  return date === targetDate && lineItem.includes('fastmath');
});

if (speedScoreTests.length === 0) {
  console.log(`❌ No Speed Score tests found for ${targetDate}\n`);
  console.log('(This is JUST Speed Score tests - excludes practice, Math Raiders, other apps)');
} else {
  console.log(`✅ Found ${speedScoreTests.length} Speed Score test(s):\n`);
  
  speedScoreTests.sort((a, b) => a.scoreDate.localeCompare(b.scoreDate));
  
  speedScoreTests.forEach((r: any) => {
    const time = r.scoreDate.substring(11, 16);
    const correct = r.metadata?.correct || '?';
    const attempts = r.metadata?.attempts || '?';
    const cqpm = r.metadata?.cqpm || r.score || 0;
    const acc = r.metadata?.accuracyRate || 0;
    const lineItem = r.assessmentLineItem?.sourcedId;
    
    // Parse operation from lineItem
    let operation = 'Unknown';
    if (lineItem.includes('track7') || lineItem.toLowerCase().includes('mult')) operation = 'Multiplication';
    if (lineItem.includes('track5') || lineItem.toLowerCase().includes('div')) operation = 'Division';
    if (lineItem.includes('track3') || lineItem.toLowerCase().includes('add')) operation = 'Addition';
    if (lineItem.includes('track4') || lineItem.toLowerCase().includes('sub')) operation = 'Subtraction';
    if (lineItem.includes('track9') || lineItem.includes('track10')) operation = 'Mixed';
    
    console.log(`   ${time}  ${operation.padEnd(15)} ${String(correct).padStart(3)}/${String(attempts).padStart(3)} (${acc.toFixed(0)}%)  ${cqpm.toFixed(1)} CQPM`);
    console.log(`          ${lineItem}`);
  });
}

console.log('\n' + '='.repeat(100));

