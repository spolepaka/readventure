#!/usr/bin/env bun
import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

async function getToken() {
  const { clientId, clientSecret } = await getTimebackCredentials();
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  });
  return (await res.json()).access_token;
}

const token = await getToken();

const people = [
  { name: 'Campbell Cao', email: 'campbell.cao@superbuilders.school' },
  { name: 'Renee Parnell', email: 'renee.parnell@2hourlearning.com' }
];

console.log('📊 Comparing November Results\n');
console.log('='.repeat(100));

for (const person of people) {
  const userRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${person.email}'`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const user = (await userRes.json()).users?.[0];
  
  if (!user) continue;
  
  const resultsRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${user.sourcedId}'&limit=1000`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const results = (await resultsRes.json()).assessmentResults || [];
  
  // November only
  const novResults = results.filter((r: any) => r.scoreDate.substring(0, 7) === '2025-11');
  
  console.log(`\n👤 ${person.name}`);
  console.log('-'.repeat(100));
  console.log(`Total November results: ${novResults.length}\n`);
  
  // Sort by date
  novResults.sort((a, b) => a.scoreDate.localeCompare(b.scoreDate));
  
  // Show all
  novResults.forEach((r: any) => {
    const date = r.scoreDate.substring(0, 10);
    const time = r.scoreDate.substring(11, 16);
    const app = r.metadata?.appName || r.metadata?.subject || 'Unknown';
    const lineItem = r.assessmentLineItem?.sourcedId || 'none';
    const isFastMath = lineItem.includes('fastmath');
    const score = r.score;
    const correct = r.metadata?.correct;
    const attempts = r.metadata?.attempts;
    
    const scoreStr = correct && attempts ? `${correct}/${attempts}` : `${score}`;
    const tag = isFastMath ? '⭐ SPEED SCORE' : '   ';
    
    console.log(`${date} ${time}  ${tag}  ${app.padEnd(20)} ${scoreStr.toString().padStart(8)}  ${lineItem.substring(0, 40)}`);
  });
}

console.log('\n' + '='.repeat(100));

