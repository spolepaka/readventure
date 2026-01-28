#!/usr/bin/env bun
import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

// Usage: bun checkDashboardXP.ts <email> <date>
// Example: bun checkDashboardXP.ts campbell.cao@superbuilders.school 2025-11-12
// Uses the SAME API the dashboard uses (/edubridge/analytics/activity)

const email = process.argv[2] || 'campbell.cao@superbuilders.school';
const targetDate = process.argv[3] || '2025-11-12';

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

console.log(`📊 Dashboard XP (EduBridge Analytics API) for ${targetDate}\n`);
console.log('='.repeat(100));
console.log(`👤 ${user.givenName} ${user.familyName}`);
console.log(`   Email: ${email}`);
console.log(`   TimeBack ID: ${user.sourcedId}\n`);

// Call the ANALYTICS API (same as dashboard uses)
const url = `${TIMEBACK_API_BASE}/edubridge/analytics/activity?studentId=${user.sourcedId}&startDate=${targetDate}T00:00:00Z&endDate=${targetDate}T23:59:59Z&timezone=America/Chicago`;

const analyticsRes = await fetch(url, {
  method: 'GET',
  headers: { 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

if (!analyticsRes.ok) {
  console.log(`❌ Analytics API error: ${analyticsRes.status} ${analyticsRes.statusText}`);
  console.log(await analyticsRes.text());
  process.exit(1);
}

const analyticsData = await analyticsRes.json();
console.log('Raw API response:');
console.log(JSON.stringify(analyticsData, null, 2));

// Parse the facts structure
const facts = analyticsData.facts || {};
const dateData = facts[targetDate];

if (!dateData) {
  console.log(`\n❌ No data for ${targetDate}`);
} else {
  console.log(`\n✅ Data found for ${targetDate}:\n`);
  
  // Show XP by subject
  for (const [subject, data] of Object.entries(dateData)) {
    const metrics = (data as any)?.activityMetrics || {};
    const xp = metrics.xpEarned || 0;
    const time = metrics.timeSpent || 0;
    
    if (xp > 0) {
      console.log(`   ${subject.padEnd(20)} ${xp.toFixed(2)} XP (${time.toFixed(1)} min)`);
    }
  }
}

console.log('\n' + '='.repeat(100));
console.log('\n💡 This is the SAME API the dashboard uses to show daily XP circles!');

