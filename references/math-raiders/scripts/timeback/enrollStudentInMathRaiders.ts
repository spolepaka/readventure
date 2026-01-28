#!/usr/bin/env bun
/**
 * Enroll a student in a Math Raiders class
 * Usage: bun run scripts/timeback/enrollStudentInMathRaiders.ts <email> <grade>
 * Example: bun run scripts/timeback/enrollStudentInMathRaiders.ts atticus@school.com 5
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

async function checkExistingEnrollment(token: string, userId: string): Promise<boolean> {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/enrollments?filter=user.sourcedId='${userId}'&limit=200`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  
  const hasMathRaiders = data.enrollments?.some((e: any) => 
    e.status === 'active' &&
    e.class?.sourcedId && Object.values(CLASS_IDS).includes(e.class.sourcedId)
  );
  
  return hasMathRaiders;
}

async function createEnrollment(token: string, userId: string, grade: number): Promise<void> {
  const classId = CLASS_IDS[grade];
  if (!classId) {
    throw new Error(`No class ID for grade ${grade}. Valid grades: 0-5 (0 = K)`);
  }
  
  const enrollmentId = `mr-enroll-${userId}-g${grade}`;
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/enrollments/`;
  
  // Today's date in YYYY-MM-DD format
  const beginDate = new Date().toISOString().split('T')[0];
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      enrollment: {
        sourcedId: enrollmentId,
        status: 'active',
        role: 'student',
        beginDate,
        user: { sourcedId: userId },
        class: { sourcedId: classId }
      }
    })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create enrollment: ${response.status} ${text}`);
  }
}

async function main() {
  const email = process.argv[2];
  const grade = parseInt(process.argv[3], 10);
  
  if (!email || isNaN(grade)) {
    console.log('Usage: bun run scripts/timeback/enrollStudentInMathRaiders.ts <email> <grade>');
    console.log('Example: bun run scripts/timeback/enrollStudentInMathRaiders.ts atticus@school.com 5');
    process.exit(1);
  }
  
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ Missing TIMEBACK_CLIENT_ID or TIMEBACK_CLIENT_SECRET');
    process.exit(1);
  }
  
  if (grade < 0 || grade > 5) {
    console.error('❌ Grade must be 0-5 (0 = K)');
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
  
  // Check existing enrollment
  const hasEnrollment = await checkExistingEnrollment(token, user.sourcedId);
  if (hasEnrollment) {
    console.log(`⚠️  Already enrolled in Math Raiders!`);
    process.exit(0);
  }
  
  // Create enrollment
  console.log(`📝 Enrolling in Math Raiders Grade ${grade}...`);
  await createEnrollment(token, user.sourcedId, grade);
  
  console.log(`✅ Enrolled ${user.givenName} ${user.familyName} in Math Raiders Grade ${grade}`);
}

main().catch(console.error);