#!/usr/bin/env bun
/**
 * Find Grade K class in TimeBack
 * Usage: bun run scripts/timeback/findGradeKClass.ts
 */

import { join } from 'path';

// Load env vars from worker
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

async function main() {
  console.log('🔍 Searching for Math Raiders Grade K classes...\n');
  
  const token = await getToken();
  
  // Search for Math Raiders classes
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/classes?filter=title~'Math Raiders'`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!res.ok) {
    console.error('❌ API error:', res.status);
    return;
  }
  
  const data = await res.json();
  const classes = data.classes || [];
  
  console.log(`Found ${classes.length} Math Raiders classes:\n`);
  
  // Sort by title for readability
  classes.sort((a: any, b: any) => (a.title || '').localeCompare(b.title || ''));
  
  for (const cls of classes) {
    console.log(`📚 ${cls.title}`);
    console.log(`   ID: ${cls.sourcedId}`);
    console.log(`   Status: ${cls.status}`);
    console.log('');
  }
  
  // Look specifically for Grade K / Grade 0
  const gradeK = classes.filter((c: any) => 
    c.title?.toLowerCase().includes('grade k') || 
    c.title?.toLowerCase().includes('grade 0') ||
    c.title?.toLowerCase().includes('kindergarten')
  );
  
  if (gradeK.length > 0) {
    console.log('✅ Found Grade K class(es):');
    for (const c of gradeK) {
      console.log(`   ${c.title}: ${c.sourcedId}`);
    }
  } else {
    console.log('❌ No Grade K class found. You may need to create one.');
  }
}

main().catch(console.error);
