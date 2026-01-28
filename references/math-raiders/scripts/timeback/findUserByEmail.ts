#!/usr/bin/env bun
/**
 * Find TimeBack user ID by email address
 */

import { join } from 'path';

// Load env vars from worker (has TimeBack credentials)
const envPath = join(import.meta.dir, '../../worker/.env');
const envFile = await Bun.file(envPath).text();
envFile.split('\n').forEach(line => {
  const match = line.match(/^(\w+)=(.*)$/);
  if (match) {
    const [, key, value] = match;
    process.env[key] = value;
  }
});

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = process.env.TIMEBACK_CLIENT_ID || process.env.VITE_TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = process.env.TIMEBACK_CLIENT_SECRET || process.env.VITE_TIMEBACK_CLIENT_SECRET;

const EMAIL = Bun.argv[2] || 'seth.anders@2hourlearning.com';

async function getToken() {
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });
  return (await response.json()).access_token;
}

console.log(`🔍 Searching for user: ${EMAIL}\n`);

const token = await getToken();

// Try searching for user by email
const searchUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${EMAIL}'`;

const res = await fetch(searchUrl, {
  headers: { 'Authorization': `Bearer ${token}` }
});

if (!res.ok) {
  console.log(`❌ API error: ${res.status}`);
  console.log(await res.text());
  process.exit(1);
}

const data = await res.json();
const users = data.users || [];

if (users.length === 0) {
  console.log('❌ No user found with that email');
  process.exit(1);
}

console.log(`✅ Found ${users.length} user(s):\n`);

users.forEach((user: any) => {
  console.log(`Name: ${user.givenName} ${user.familyName}`);
  console.log(`Email: ${user.email}`);
  console.log(`TimeBack ID: ${user.sourcedId}`);
  console.log(`Status: ${user.status}`);
  console.log(`Org: ${user.org?.sourcedId || 'N/A'}`);
  console.log('');
});

