#!/usr/bin/env bun
/**
 * Unenroll a student from Math Raiders
 * Usage: bun run scripts/timeback/unenrollStudentFromMathRaiders.ts <email>
 * Example: bun run scripts/timeback/unenrollStudentFromMathRaiders.ts atticus@school.com
 * 
 * This performs a soft delete (status -> tobedeleted) via the OneRoster API.
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

// Math Raiders class IDs per grade (0 = K)
const CLASS_IDS: Record<number, string> = {
  0: 'a747e46c-db9d-43de-a586-44b4cc17e003', // Grade K
  1: 'd7f70171-ad42-4cc9-9ebb-59c210bc6604',
  2: 'db8df2b3-70d5-42b6-a5cd-15ec27031f4c',
  3: 'f0dc89af-4867-47ea-86d5-5cf7124afd1c',
  4: '46c143a7-83eb-4362-921f-8afea732bcda',
  5: 'fa2ca870-b475-44fe-9dc1-9f94dba5cb93',
};

const MR_CLASS_IDS = new Set(Object.values(CLASS_IDS));

async function getToken(): Promise<string> {
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
  });
  const data = await response.json();
  return data.access_token;
}

async function findUserByEmail(token: string, email: string): Promise<{ sourcedId: string; givenName: string; familyName: string } | null> {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  
  if (!data.users || data.users.length === 0) {
    // Try lowercase
    const lowerUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email.toLowerCase()}'`;
    const lowerResponse = await fetch(lowerUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const lowerData = await lowerResponse.json();
    if (!lowerData.users || lowerData.users.length === 0) {
      return null;
    }
    return lowerData.users[0];
  }
  return data.users[0];
}

interface Enrollment {
  sourcedId: string;
  status: string;
  class?: { sourcedId: string; name?: string };
}

async function findMathRaidersEnrollments(token: string, userId: string): Promise<Enrollment[]> {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/enrollments?filter=user.sourcedId='${userId}'&limit=200`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  
  if (!data.enrollments) return [];
  
  // Filter to only Math Raiders enrollments that are active
  return data.enrollments.filter((e: Enrollment) => 
    e.class?.sourcedId && 
    MR_CLASS_IDS.has(e.class.sourcedId) &&
    e.status === 'active'
  );
}

async function unenrollStudent(token: string, enrollmentId: string): Promise<void> {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/enrollments/${enrollmentId}`;
  const today = new Date().toISOString().split('T')[0];
  
  // Step 1: PATCH to set endDate (clean record-keeping)
  const patchResponse = await fetch(url, {
    method: 'PATCH',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      enrollment: { endDate: today }
    })
  });
  
  if (!patchResponse.ok) {
    const text = await patchResponse.text();
    console.warn(`⚠️  PATCH failed (continuing with DELETE): ${patchResponse.status} ${text}`);
  }
  
  // Step 2: DELETE to soft-delete (status -> tobedeleted)
  const deleteResponse = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!deleteResponse.ok && deleteResponse.status !== 204) {
    const text = await deleteResponse.text();
    throw new Error(`Failed to delete enrollment: ${deleteResponse.status} ${text}`);
  }
}

function getGradeFromClassId(classId: string): string {
  for (const [grade, id] of Object.entries(CLASS_IDS)) {
    if (id === classId) return grade === '0' ? 'K' : grade;
  }
  return '?';
}

async function main() {
  const email = process.argv[2];
  
  if (!email) {
    console.log('Usage: bun run scripts/timeback/unenrollStudentFromMathRaiders.ts <email>');
    console.log('Example: bun run scripts/timeback/unenrollStudentFromMathRaiders.ts atticus@school.com');
    process.exit(1);
  }
  
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ Missing TIMEBACK_CLIENT_ID or TIMEBACK_CLIENT_SECRET');
    process.exit(1);
  }
  
  console.log(`🔍 Looking up user: ${email}`);
  const token = await getToken();
  
  const user = await findUserByEmail(token, email);
  if (!user) {
    console.error(`❌ User not found: ${email}`);
    process.exit(1);
  }
  
  console.log(`✅ Found: ${user.givenName} ${user.familyName} (${user.sourcedId})`);
  
  // Find Math Raiders enrollments
  const enrollments = await findMathRaidersEnrollments(token, user.sourcedId);
  
  if (enrollments.length === 0) {
    console.log(`⚠️  No active Math Raiders enrollments found`);
    process.exit(0);
  }
  
  console.log(`📝 Found ${enrollments.length} Math Raiders enrollment(s):`);
  for (const e of enrollments) {
    const grade = getGradeFromClassId(e.class?.sourcedId || '');
    console.log(`   - Grade ${grade} (${e.sourcedId})`);
  }
  
  // Delete each enrollment
  for (const e of enrollments) {
    const grade = getGradeFromClassId(e.class?.sourcedId || '');
    console.log(`🗑️  Unenrolling from Grade ${grade}...`);
    await unenrollStudent(token, e.sourcedId);
  }
  
  console.log(`✅ Unenrolled ${user.givenName} ${user.familyName} from Math Raiders`);
}

main().catch(console.error);
