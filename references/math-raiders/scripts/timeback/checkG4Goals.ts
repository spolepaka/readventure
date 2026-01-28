#!/usr/bin/env bun

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

async function check() {
  const token = await fetchAccessToken();
  
  const res = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/math-raiders-grade-4`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const data = await res.json();
  const meta = data.course.metadata;
  
  console.log('Math Raiders Grade 4 - Goals Configuration:\n');
  console.log('goals.dailyXp:', meta.goals?.dailyXp);
  console.log('AlphaLearn.DailyXPGoal:', meta.AlphaLearn?.DailyXPGoal);
  console.log('Weekly (5 days × daily):', (meta.goals?.dailyXp || 0) * 5);
  console.log('\n📊 Dashboard shows: 25 daily, 125 weekly');
  console.log('📝 We configured: 20 daily, 100 weekly');
  console.log('\n❓ Timeback might be:');
  console.log('   - Using defaults (ignoring our goals)');
  console.log('   - Using different calculation');
  console.log('   - Using different metadata field');
  console.log('\nFull metadata:');
  console.log(JSON.stringify(meta, null, 2));
}

check().catch(console.error);
