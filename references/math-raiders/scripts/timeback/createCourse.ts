#!/usr/bin/env bun
/**
 * Creates Math Raiders course for any grade
 * Usage: bun createCourse.ts <grade>
 * Example: bun createCourse.ts 3
 */

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = Bun.env.TIMEBACKCLIENTID || Bun.env.TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = Bun.env.TIMEBACKSECRET || Bun.env.TIMEBACK_CLIENT_SECRET;

const EXISTING_MR_RESOURCE_ID = "c3b6a1b2-cf4b-436f-955c-8f83518d87ee";
const ORG_ID = "a616dcba-f2ed-43a8-95c5-1e9c8592f9b7";

// Exact counts from count-lessons-per-grade.ts
// Grade K: Addition to 5 (21 facts) + Subtraction to 5 (21 facts) = 42 facts × 4 min = 168 XP
const GRADE_CONFIG: Record<number, { totalLessons: number; totalXp: number }> = {
  0: { totalLessons: 42, totalXp: 168 },   // K
  1: { totalLessons: 66, totalXp: 264 },
  2: { totalLessons: 265, totalXp: 796 },
  3: { totalLessons: 562, totalXp: 1188 },
  4: { totalLessons: 313, totalXp: 916 },
  5: { totalLessons: 775, totalXp: 706 }
};

async function fetchAccessToken(): Promise<string> {
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });
  const data = await response.json() as { access_token?: string };
  return data.access_token!;
}

async function createCourse(grade: number) {
  const config = GRADE_CONFIG[grade];
  if (!config) {
    console.error(`❌ Invalid grade: ${grade}. Valid: 0 (K), 1, 2, 3, 4, 5`);
    process.exit(1);
  }
  
  const displayGrade = grade === 0 ? 'K' : String(grade);
  
  console.log(`🏗️  Creating Math Raiders Grade ${displayGrade} Course`);
  console.log(`   totalLessons: ${config.totalLessons}, totalXp: ${config.totalXp}\n`);
  console.log('='.repeat(70));
  
  const token = await fetchAccessToken();
  
  // STEP 1: Create Course
  console.log('\n1️⃣ Creating Course...');
  
  const coursePayload = {
    course: {
      sourcedId: `math-raiders-grade-${grade}`,
      status: "active",
      dateLastModified: new Date().toISOString(),
      title: `Math Raiders Grade ${displayGrade}`,
      courseCode: `MR-G${displayGrade}`,
      grades: [`${grade}`],
      subjects: ["FastMath"],
      subjectCodes: [""],
      org: { sourcedId: ORG_ID },
      metadata: {
        goals: {
          dailyXp: 10,
          dailyLessons: 5,
          dailyAccuracy: 80,
          dailyActiveMinutes: 10,
          dailyMasteredUnits: 5
        },
        metrics: {
          totalXp: config.totalXp,
          totalLessons: config.totalLessons
        },
        AlphaLearn: {
          DailyXPGoal: 10
        },
        primaryApp: "fast_math",
        targetGrades: [`${grade}`],
        publishStatus: "testing"
      }
    }
  };
  
  const courseRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(coursePayload)
  });
  
  if (!courseRes.ok) {
    const error = await courseRes.text();
    throw new Error(`Course creation failed: ${courseRes.status} ${error}`);
  }
  
  console.log(`✅ Course created: math-raiders-grade-${grade}`);
  
  // STEP 2: Create Component
  console.log('\n2️⃣ Creating Component...');
  
  const componentPayload = {
    courseComponent: {
      sourcedId: `math-raiders-grade-${grade}-component`,
      status: "active",
      dateLastModified: new Date().toISOString(),
      course: { sourcedId: `math-raiders-grade-${grade}` },
      title: `Math Raiders Grade ${displayGrade} Component`,
      sortOrder: 0,
      unlockDate: "1970-01-01T00:00:00.000Z"
    }
  };
  
  const compRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/components`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(componentPayload)
  });
  
  if (!compRes.ok) {
    const error = await compRes.text();
    throw new Error(`Component creation failed: ${compRes.status} ${error}`);
  }
  
  console.log(`✅ Component created: math-raiders-grade-${grade}-component`);
  
  // STEP 3: Link Resource
  console.log('\n3️⃣ Linking Resource...');
  
  const resourcePayload = {
    componentResource: {
      sourcedId: `math-raiders-grade-${grade}-component-resource`,
      status: "active",
      dateLastModified: new Date().toISOString(),
      courseComponent: { sourcedId: `math-raiders-grade-${grade}-component` },
      resource: { sourcedId: EXISTING_MR_RESOURCE_ID },
      title: `Math Raiders Grade ${displayGrade}`,
      sortOrder: 1
    }
  };
  
  const crRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/component-resources`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(resourcePayload)
  });
  
  if (!crRes.ok) {
    const error = await crRes.text();
    throw new Error(`Resource linking failed: ${crRes.status} ${error}`);
  }
  
  console.log(`✅ Resource linked: math-raiders-grade-${grade}-component-resource`);
  
  console.log(`\n✅ COMPLETE - Math Raiders Grade ${displayGrade} Course Created`);
  console.log('='.repeat(70));
  console.log('');
  console.log(`  Course: math-raiders-grade-${grade} (${config.totalLessons} totalLessons, ${config.totalXp} totalXp)`);
  console.log(`  Component: math-raiders-grade-${grade}-component`);
  console.log(`  Resource: math-raiders-grade-${grade}-component-resource`);
}

// Parse grade from command line
const grade = parseInt(process.argv[2]);
if (isNaN(grade) || grade < 0 || grade > 5) {
  console.error('Usage: bun createCourse.ts <grade>');
  console.error('Example: bun createCourse.ts 0  (for Kindergarten)');
  console.error('Valid grades: 0 (K), 1, 2, 3, 4, 5');
  process.exit(1);
}

createCourse(grade).catch(console.error);
