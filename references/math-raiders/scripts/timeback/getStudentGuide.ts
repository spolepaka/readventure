#!/usr/bin/env bun
/**
 * Get a student's teacher/guide via TimeBack OneRoster API.
 * 
 * Usage: bun scripts/timeback/getStudentGuide.ts <email>
 */
import { getTimebackCredentials, TIMEBACK_API_BASE, TIMEBACK_AUTH_URL } from './utils/timeback';

const email = process.argv[2];
if (!email) {
  console.error('Usage: bun scripts/timeback/getStudentGuide.ts <email>');
  process.exit(1);
}

// Get OAuth token
async function getToken(): Promise<string> {
  const { clientId, clientSecret } = await getTimebackCredentials();
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

// Fetch from TimeBack API
async function api(token: string, path: string) {
  const res = await fetch(`${TIMEBACK_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    console.error(`API error: ${res.status} ${path}`);
    return null;
  }
  return res.json();
}

// Main
const token = await getToken();

// 1. Find student by email
const usersRes = await api(token, `/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`);
const user = usersRes?.users?.[0];

if (!user) {
  console.log(`❌ User not found: ${email}`);
  process.exit(1);
}

console.log(`👤 ${user.givenName} ${user.familyName}`);
console.log(`   ID: ${user.sourcedId}`);
console.log(`   Role: ${user.role}`);
console.log('');

// 2. Get student's classes
const classesRes = await api(token, `/ims/oneroster/rostering/v1p2/students/${user.sourcedId}/classes`);
const classes = classesRes?.classes || [];

if (classes.length === 0) {
  console.log('📚 No classes found');
  process.exit(0);
}

console.log(`📚 ${classes.length} class(es):\n`);

// 3. For each class, get teachers
for (const cls of classes) {
  console.log(`   ${cls.title || cls.sourcedId}`);
  
  const teachersRes = await api(token, `/ims/oneroster/rostering/v1p2/classes/${cls.sourcedId}/teachers`);
  const teachers = teachersRes?.users || [];
  
  if (teachers.length === 0) {
    console.log('      (no teachers)');
  } else {
    for (const t of teachers) {
      console.log(`      👨‍🏫 ${t.givenName} ${t.familyName} <${t.email}>`);
    }
  }
  console.log('');
}
