#!/usr/bin/env bun
import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

async function getToken() {
  const { clientId, clientSecret } = await getTimebackCredentials();
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  });
  return (await res.json()).access_token;
}

const token = await getToken();

const students = [
  { name: 'Campbell Cao', email: 'campbell.cao@superbuilders.school', grade: 5 },
  { name: 'Seth Anders', email: 'seth.anders@2hourlearning.com', grade: 5 },
  { name: 'Renee Parnell', email: 'renee.parnell@2hourlearning.com', grade: 2 },
  { name: 'De\'Marcus Collins', email: 'demarcus.collins@2hourlearning.com', grade: 3 },
];

console.log('📊 Checking Math Raiders Course Enrollments\n');
console.log('='.repeat(100));

for (const student of students) {
  const userRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${student.email}'`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const userData = await userRes.json();
  const user = userData.users?.[0];
  
  if (!user) continue;
  
  console.log(`\n👤 ${student.name} (Grade ${student.grade})`);
  console.log('-'.repeat(100));
  
  // Get enrollments for this student
  const enrollRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/enrollments?filter=user.sourcedId='${user.sourcedId}'&limit=200`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const enrollData = await enrollRes.json();
  const enrollments = enrollData.enrollments || [];
  
  console.log(`   Total enrollments: ${enrollments.length}`);
  
  // Filter for Math Raiders courses
  const mathRaidersEnroll = enrollments.filter((e: any) => {
    const courseId = e.class?.sourcedId || '';
    return courseId.includes('math-raiders');
  });
  
  console.log(`   Math Raiders enrollments: ${mathRaidersEnroll.length}`);
  
  if (mathRaidersEnroll.length > 0) {
    mathRaidersEnroll.forEach((e: any) => {
      const courseId = e.class?.sourcedId || '';
      const status = e.status || 'unknown';
      const role = e.role || 'unknown';
      console.log(`      ✅ ${courseId} (status: ${status}, role: ${role})`);
    });
  } else {
    console.log(`      ❌ NOT enrolled in any Math Raiders course!`);
    console.log(`      Expected: math-raiders-grade-${student.grade}`);
  }
}

console.log('\n' + '='.repeat(100));
console.log('\n💡 If TSA students are NOT enrolled:');
console.log('   → TimeBack rejects events for unenrolled students');
console.log('   → Need to enroll them in math-raiders-grade-X courses');

