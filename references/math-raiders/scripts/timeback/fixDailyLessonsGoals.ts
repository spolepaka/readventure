#!/usr/bin/env bun
/**
 * Fix dailyLessons goals for all Math Raiders courses
 * Target: 5 raids/day (10 min goal ÷ 2 min/raid avg)
 */

import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

async function getToken() {
  const { clientId, clientSecret } = await getTimebackCredentials();
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  return (await res.json()).access_token;
}

const token = await getToken();

console.log('🔧 Fixing dailyLessons goals for Math Raiders courses...\n');
console.log('Target: 5 raids/day (10 min ÷ 2 min avg per raid)\n');
console.log('='.repeat(80));

// Grades that need updating (Grade 4 already correct at 5)
const gradesToFix = [
  { grade: 1, current: 10, target: 5 },
  { grade: 2, current: 1, target: 5 },
  { grade: 3, current: 1, target: 5 },
  { grade: 5, current: 10, target: 5 },
];

for (const { grade, current, target } of gradesToFix) {
  const courseId = `math-raiders-grade-${grade}`;
  console.log(`\n📝 Grade ${grade}: ${current} → ${target} lessons/day`);
  
  // First GET the course
  const getUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/${courseId}`;
  const getRes = await fetch(getUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!getRes.ok) {
    console.log(`   ❌ Failed to fetch course: ${getRes.status}`);
    continue;
  }
  
  const courseData = await getRes.json();
  const course = courseData.course;
  
  // Update metadata
  course.metadata = course.metadata || {};
  course.metadata.goals = course.metadata.goals || {};
  course.metadata.goals.dailyLessons = target;
  
  // PUT back the full course
  const putRes = await fetch(getUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ course })
  });
  
  if (putRes.ok) {
    console.log(`   ✅ Updated successfully!`);
  } else {
    console.log(`   ❌ Failed to PUT: ${putRes.status}`);
    console.log(`   ${await putRes.text()}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('\n✨ All courses should now show realistic progress!');
console.log('Students will see: X/5 lessons today (not X/1 or X/10)');

