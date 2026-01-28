#!/usr/bin/env bun
/**
 * Check a student's enrollments, including Math Raiders
 * Usage: bun run scripts/timeback/checkEnrollments.ts <email>
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

// Math Raiders class IDs per grade (same as enrollStudentInMathRaiders.ts)
const MR_CLASS_IDS: Record<string, number> = {
  'a747e46c-db9d-43de-a586-44b4cc17e003': 0, // Grade K
  'd7f70171-ad42-4cc9-9ebb-59c210bc6604': 1,
  'db8df2b3-70d5-42b6-a5cd-15ec27031f4c': 2,
  'f0dc89af-4867-47ea-86d5-5cf7124afd1c': 3,
  '46c143a7-83eb-4362-921f-8afea732bcda': 4,
  'fa2ca870-b475-44fe-9dc1-9f94dba5cb93': 5,
};

const emailArg = Bun.argv[2];

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

async function findUserByEmail(token: string, email: string) {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  return data.users?.[0];
}

async function check() {
  if (!emailArg) {
    console.log('Usage: bun run scripts/timeback/checkEnrollments.ts <email>');
    return;
  }

  const token = await fetchAccessToken();
  
  // Look up user by email first
  const user = await findUserByEmail(token, emailArg);
  if (!user) {
    console.log(`❌ User not found: ${emailArg}`);
    return;
  }
  
  console.log(`👤 ${user.givenName} ${user.familyName}`);
  console.log(`   TimeBack ID: ${user.sourcedId}\n`);
  
  // Get enrollments for this user
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/enrollments?filter=user.sourcedId='${user.sourcedId}'&limit=200`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (res.ok) {
    const data = await res.json();
    const enrollments = data.enrollments || [];
    
    console.log(`Found ${enrollments.length} enrollments:\n`);
    
    let mrEnrollment: any = null;
    
    for (const e of enrollments) {
      const classId = e.class?.sourcedId;
      const isMR = classId && MR_CLASS_IDS[classId] !== undefined;
      const marker = isMR ? '🎮' : '  ';
      console.log(`${marker} ${e.class?.title || classId || 'unknown'} (${e.role}, ${e.status})`);
      
      if (isMR) {
        mrEnrollment = e;
      }
    }
    
    if (mrEnrollment) {
      const grade = MR_CLASS_IDS[mrEnrollment.class.sourcedId];
      console.log(`\n✅ Math Raiders: Grade ${grade} (${mrEnrollment.status})`);
    } else {
      console.log(`\n❌ Math Raiders: NOT ENROLLED`);
    }
  } else {
    console.log(`Failed: ${res.status}`);
    console.log(await res.text());
  }
}

check().catch(console.error);
