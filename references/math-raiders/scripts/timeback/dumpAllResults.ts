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
const email = 'campbell.cao@superbuilders.school';

// Get user
const userRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`, {
  headers: { 'Authorization': `Bearer ${token}` }
});

const userData = await userRes.json();
const user = userData.users?.[0];

console.log(`Fetching all assessment results for: ${email}\n`);

// Get ALL results
const resultsRes = await fetch(
  `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${user.sourcedId}'&limit=500`, 
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

const resultsData = await resultsRes.json();
const allResults = resultsData.assessmentResults || [];

console.log(`Total results: ${allResults.length}\n`);
console.log('='.repeat(100));

// Sort by date (newest first)
allResults.sort((a, b) => new Date(b.scoreDate).getTime() - new Date(a.scoreDate).getTime());

// Print ALL with index
allResults.forEach((r: any, i: number) => {
  const date = r.scoreDate.substring(0, 16);
  const app = r.metadata?.appName || r.metadata?.subject || 'Unknown';
  const score = r.score;
  const lineItem = (r.assessmentLineItem?.sourcedId || 'No line item').substring(0, 50);
  const correct = r.metadata?.correct;
  const attempts = r.metadata?.attempts;
  const cqpm = r.metadata?.cqpm;
  
  const scoreStr = correct && attempts ? `${correct}/${attempts}` : `Score: ${score}`;
  const cqpmStr = cqpm ? `${cqpm} CQPM` : '';
  
  console.log(`[${(i+1).toString().padStart(3)}] ${date}  ${app.padEnd(20)} ${scoreStr.padEnd(15)} ${cqpmStr}`);
  console.log(`      ${lineItem}`);
});

console.log('\n' + '='.repeat(100));
console.log('\n👆 Tell me which numbers are your FastMath Speed Score tests (the 38/40 format ones)');

