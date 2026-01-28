#!/usr/bin/env bun
/**
 * Get ALL assessments for a student by email (no filtering).
 * Shows everything - Speed Scores, Language, Math, etc.
 * 
 * Usage: bun scripts/timeback/getAllAssessments.ts <email>
 */
import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

const email = process.argv[2];
if (!email) {
  console.error('Usage: bun scripts/timeback/getAllAssessments.ts <email>');
  process.exit(1);
}

// Auth - same pattern as worker
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

// Fetch user by email
async function getUser(token: string, email: string) {
  const res = await fetch(
    `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`User lookup failed: ${res.status}`);
  const data = await res.json();
  return data.users?.[0];
}

// Fetch ALL assessments - no filtering
async function getAllAssessments(token: string, timebackId: string) {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${timebackId}'&limit=3000&sort=scoreDate&orderBy=desc`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Assessment fetch failed: ${res.status}`);
  
  const data = await res.json();
  
  // No filtering - return everything, sorted by date
  return (data.assessmentResults || [])
    .sort((a: any, b: any) => new Date(b.scoreDate).getTime() - new Date(a.scoreDate).getTime());
}

// Main
const token = await getToken();
const user = await getUser(token, email);

if (!user) {
  console.log(`❌ User not found: ${email}`);
  process.exit(1);
}

console.log(`👤 ${user.givenName} ${user.familyName}`);
console.log(`   TimeBack ID: ${user.sourcedId}\n`);

const assessments = await getAllAssessments(token, user.sourcedId);

if (assessments.length === 0) {
  console.log('No assessments found');
  process.exit(0);
}

// Group by activity/subject for summary
const byActivity: Record<string, number> = {};
const bySubject: Record<string, number> = {};

for (const a of assessments) {
  const activity = a.metadata?.activity || a.assessmentLineItem?.title || 'unknown';
  const subject = a.metadata?.subject || 
    (a.assessmentLineItem?.title?.includes('fastmath') ? 'FastMath' : 'unknown');
  
  byActivity[activity] = (byActivity[activity] || 0) + 1;
  
  // Infer subject from activity name if not explicit
  let inferredSubject = subject;
  if (subject === 'unknown') {
    if (activity.includes('SENTENCE') || activity.includes('PARAGRAPH') || 
        activity.includes('CONJUNCTION') || activity.includes('APPOSITIVE')) {
      inferredSubject = 'Language';
    } else if (activity.includes('fastmath') || activity.includes('track')) {
      inferredSubject = 'FastMath';
    }
  }
  bySubject[inferredSubject] = (bySubject[inferredSubject] || 0) + 1;
}

// Summary
console.log(`📊 ${assessments.length} total assessments\n`);

console.log('By Subject:');
for (const [subject, count] of Object.entries(bySubject).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${subject}: ${count}`);
}

console.log('\nBy Activity (top 10):');
const topActivities = Object.entries(byActivity)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
for (const [activity, count] of topActivities) {
  console.log(`  ${activity}: ${count}`);
}

// Recent assessments
console.log('\n--- Recent Assessments (last 15) ---\n');
console.log('Date       | Grade | CQPM  | Activity/Title');
console.log('-'.repeat(70));

for (const a of assessments.slice(0, 15)) {
  const date = a.scoreDate?.slice(0, 10) ?? '?';
  const grade = a.metadata?.grade ?? '?';
  const cqpm = a.metadata?.cqpm !== undefined ? String(a.metadata.cqpm).slice(0, 5).padStart(5) : '  -  ';
  const activity = a.metadata?.activity || a.assessmentLineItem?.title || '?';
  console.log(`${date} | G${String(grade).padEnd(4)} | ${cqpm} | ${activity.slice(0, 40)}`);
}

// Check for FastMath specifically
const fastmathAssessments = assessments.filter((a: any) => 
  a.metadata?.cqpm !== undefined || 
  a.assessmentLineItem?.title?.includes('fastmath')
);

console.log(`\n🔢 FastMath assessments: ${fastmathAssessments.length}`);
if (fastmathAssessments.length > 0) {
  const latestFM = fastmathAssessments[0];
  console.log(`   Latest: ${latestFM.scoreDate?.slice(0, 10)} - ${latestFM.metadata?.cqpm ?? '?'} CQPM (G${latestFM.metadata?.grade ?? '?'})`);
}
