#!/usr/bin/env bun
/**
 * Verify all Math Raiders courses (Grades 1-5) are correctly configured
 * Compares against AlphaMath Fluency structure
 */

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = Bun.env.TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = Bun.env.TIMEBACK_CLIENT_SECRET;

// Expected values (from count-lessons-per-grade.ts)
const EXPECTED = {
  1: { totalLessons: 66, totalXp: 264 },
  2: { totalLessons: 265, totalXp: 796 },
  3: { totalLessons: 562, totalXp: 1188 },
  4: { totalLessons: 313, totalXp: 916 },
  5: { totalLessons: 775, totalXp: 706 }
};

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

async function verifyCourse(grade: number, token: string) {
  const expected = EXPECTED[grade as keyof typeof EXPECTED];
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`GRADE ${grade}`);
  console.log('='.repeat(70));
  
  // Fetch Math Raiders course
  const mrUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/math-raiders-grade-${grade}`;
  const mrRes = await fetch(mrUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!mrRes.ok) {
    console.log(`❌ Math Raiders Grade ${grade} course NOT FOUND`);
    return false;
  }
  
  const mrData = await mrRes.json();
  const mr = mrData.course;
  
  // Fetch AlphaMath course for comparison
  const amUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/?filter=title~'AlphaMath Fluency Grade ${grade}'`;
  const amRes = await fetch(amUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  let am = null;
  if (amRes.ok) {
    const amData = await amRes.json();
    am = amData.courses?.[0];
  }
  
  // Check critical fields
  let pass = true;
  
  console.log(`\nMath Raiders Grade ${grade}:`);
  console.log(`  sourcedId: ${mr.sourcedId}`);
  console.log(`  title: ${mr.title}`);
  console.log(`  totalLessons: ${mr.metadata?.totalLessons} ${mr.metadata?.totalLessons === expected.totalLessons ? '✅' : '❌ Expected: ' + expected.totalLessons}`);
  console.log(`  totalXp: ${mr.metadata?.metrics?.totalXp} ${mr.metadata?.metrics?.totalXp === expected.totalXp ? '✅' : '❌ Expected: ' + expected.totalXp}`);
  console.log(`  metrics.totalLessons: ${mr.metadata?.metrics?.totalLessons} ${mr.metadata?.metrics?.totalLessons === expected.totalLessons ? '✅' : '❌'}`);
  
  if (am) {
    console.log(`\nAlphaMath Fluency Grade ${grade} (for reference):`);
    console.log(`  totalLessons: ${am.metadata?.totalLessons || 'N/A'}`);
    console.log(`  totalXp: ${am.metadata?.metrics?.totalXp || 'N/A'}`);
  } else {
    console.log(`\n⚠️  AlphaMath Grade ${grade} not found (may not exist)`);
  }
  
  if (mr.metadata?.totalLessons !== expected.totalLessons || 
      mr.metadata?.metrics?.totalXp !== expected.totalXp ||
      mr.metadata?.metrics?.totalLessons !== expected.totalLessons) {
    pass = false;
  }
  
  return pass;
}

async function main() {
  console.log('🔍 Verifying Math Raiders Courses (Grades 1-5)');
  
  const token = await getToken();
  
  const results = [];
  for (const grade of [1, 2, 3, 4, 5]) {
    const pass = await verifyCourse(grade, token);
    results.push({ grade, pass });
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  
  results.forEach(r => {
    console.log(`  Grade ${r.grade}: ${r.pass ? '✅ PASS' : '❌ FAIL'}`);
  });
  
  const allPass = results.every(r => r.pass);
  console.log(`\n${allPass ? '✅ All courses verified!' : '❌ Some courses have issues'}`);
}

main().catch(console.error);














