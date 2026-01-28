#!/usr/bin/env bun
/**
 * Check if a user exists in TimeBack by email
 */

import { join } from 'path';

// Load env vars
const envPath = join(import.meta.dir, '../../client/.env.production');
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

const email = process.argv[2];

if (!email) {
  console.error('Usage: bun checkUserExists.ts <email>');
  process.exit(1);
}

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

console.log(`🔍 Checking if ${email} exists in TimeBack...\n`);

const token = await getToken();

// Method 1: Search by email
console.log('Method 1: Searching users by email...');
const searchUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users/?filter=email='${email}'`;
const searchRes = await fetch(searchUrl, {
  headers: { 'Authorization': `Bearer ${token}` }
});

if (!searchRes.ok) {
  console.log(`   ❌ Search failed: ${searchRes.status}`);
  console.log(await searchRes.text());
} else {
  const data = await searchRes.json();
  console.log(`   Response:`, JSON.stringify(data, null, 2));
}

console.log('\n');

