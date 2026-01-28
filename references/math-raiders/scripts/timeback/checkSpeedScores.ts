#!/usr/bin/env bun
import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

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

const students = [
  { name: 'Seth Anders', email: 'seth.anders@2hourlearning.com', grade: 5 },
  { name: 'De\'Marcus Collins', email: 'demarcus.collins@2hourlearning.com', grade: 3 },
  { name: 'Renee Parnell', email: 'renee.parnell@2hourlearning.com', grade: 2 },
  { name: 'Peini Jiang', email: 'peini.jiang@2hourlearning.com', grade: 4 },
  { name: 'Xiaoheng Jiang', email: 'xiaoheng.jiang@2hourlearning.com', grade: 4 },
];

console.log('📊 Speed Score Test History\n');
console.log('='.repeat(80));

for (const student of students) {
  // Get user
  const userRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${student.email}'`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const userData = await userRes.json();
  const user = userData.users?.[0];
  
  if (!user) {
    console.log(`\n👤 ${student.name} - NOT FOUND`);
    continue;
  }
  
  // Get all assessment results
  const resultsRes = await fetch(
    `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${user.sourcedId}'&limit=500`, 
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  
  const resultsData = await resultsRes.json();
  const allResults = resultsData.assessmentResults || [];
  
  // Filter for Speed Score tests (have assessmentLineItem with track in name)
  const speedScoreTests = allResults.filter((r: any) => {
    const lineItem = r.assessmentLineItem?.sourcedId || '';
    return lineItem.includes('track') && r.metadata?.cqpm !== undefined;
  });
  
  console.log(`\n👤 ${student.name} (Grade ${student.grade})`);
  console.log('-'.repeat(80));
  
  if (speedScoreTests.length === 0) {
    console.log('   No Speed Score tests found');
    continue;
  }
  
  // Sort by date
  speedScoreTests.sort((a, b) => 
    new Date(a.scoreDate).getTime() - new Date(b.scoreDate).getTime()
  );
  
  console.log(`   ${speedScoreTests.length} Speed Score tests:\n`);
  
  speedScoreTests.forEach((test: any, i: number) => {
    const date = test.scoreDate.substring(0, 10);
    const cqpm = test.metadata?.cqpm || test.score || 0;
    const operation = test.assessmentLineItem?.title || 'Unknown';
    const lineItem = test.assessmentLineItem?.sourcedId || '';
    
    // Extract operation from line item (track7 = mult, track5 = div for G4, etc.)
    let op = 'Unknown';
    if (lineItem.includes('track7') || operation.toLowerCase().includes('mult')) op = 'Mult';
    if (lineItem.includes('track5') || operation.toLowerCase().includes('div')) op = 'Div';
    if (lineItem.includes('track3') || operation.toLowerCase().includes('add')) op = 'Add';
    if (lineItem.includes('track4') || operation.toLowerCase().includes('sub')) op = 'Sub';
    
    const delta = i > 0 && speedScoreTests[i-1].metadata?.cqpm 
      ? ` (${cqpm >= speedScoreTests[i-1].metadata.cqpm ? '+' : ''}${(cqpm - speedScoreTests[i-1].metadata.cqpm).toFixed(1)})`
      : '';
    
    console.log(`   ${date}  ${op.padEnd(4)}  ${cqpm.toFixed(1).padStart(5)} CQPM${delta}`);
  });
  
  // Show improvement if multiple tests
  if (speedScoreTests.length >= 2) {
    const first = speedScoreTests[0].metadata?.cqpm || 0;
    const last = speedScoreTests[speedScoreTests.length - 1].metadata?.cqpm || 0;
    const improvement = last - first;
    console.log(`\n   📈 Overall: ${first.toFixed(1)} → ${last.toFixed(1)} CQPM (${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)})`);
  }
}

console.log('\n' + '='.repeat(80));

