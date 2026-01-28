#!/usr/bin/env bun

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

const YOUR_TIMEBACK_ID = Bun.argv[2];

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
  if (!YOUR_TIMEBACK_ID) {
    console.log('Usage: bun run checkEnrollmentStatus.ts <your-timeback-id>');
    return;
  }

  const token = await fetchAccessToken();
  
  console.log(`Checking enrollments for: ${YOUR_TIMEBACK_ID}\n`);
  
  // Get all courses this user is enrolled in
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users/${YOUR_TIMEBACK_ID}/classes`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (res.ok) {
    const data = await res.json();
    const classes = data.classes || [];
    
    console.log(`Found ${classes.length} enrollments:\n`);
    
    // Show detailed status for AMF courses
    const amfClasses = classes.filter((c: any) => 
      c.title?.includes('AlphaMath') || c.course?.sourcedId?.includes('fastmath')
    );
    
    console.log('AlphaMath Fluency Enrollments:\n');
    amfClasses.forEach((c: any) => {
      console.log(`  ${c.title}`);
      console.log(`    Course ID: ${c.course?.sourcedId || 'N/A'}`);
      console.log(`    Status: ${c.status || 'N/A'}`);
      console.log(`    Class ID: ${c.sourcedId || 'N/A'}`);
      console.log(`    Date Modified: ${c.dateLastModified || 'N/A'}`);
      console.log('');
    });
    
    // Show all enrollments with status
    console.log('\nAll Enrollments with Status:\n');
    classes.forEach((c: any) => {
      const status = c.status || 'active';
      const statusEmoji = status === 'tobedeleted' ? '🗑️' : status === 'active' ? '✅' : '❓';
      console.log(`  ${statusEmoji} ${c.title} (${status})`);
    });
  } else {
    console.log(`Failed: ${res.status}`);
    console.log(await res.text());
  }
}

check().catch(console.error);

