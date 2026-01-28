#!/usr/bin/env bun
/**
 * Creates Math Raiders Grade 4 course in Timeback
 * Matches AlphaMath Fluency Grade 4 structure exactly
 */

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = Bun.env.TIMEBACKCLIENTID || Bun.env.TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = Bun.env.TIMEBACKSECRET || Bun.env.TIMEBACK_CLIENT_SECRET;

// Existing Math Raiders resource (already created and configured)
// Resource URL: https://hub.playcademy.net/play/math-raiders
// Resource metadata includes type: 'interactive', subject: 'Math', launch URLs
const EXISTING_MR_RESOURCE_ID = "c3b6a1b2-cf4b-436f-955c-8f83518d87ee";
const ORG_ID = "a616dcba-f2ed-43a8-95c5-1e9c8592f9b7";

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

async function createGrade4Course() {
  console.log('🏗️  Creating Math Raiders Grade 4 Course');
  console.log('   Matching AlphaMath Fluency Grade 4 structure\n');
  console.log('='.repeat(70));
  
  const token = await fetchAccessToken();
  
  // STEP 1: Create Course (matches AlphaMath structure)
  console.log('\n1️⃣ Creating Course...');
  
  const coursePayload = {
    course: {
      sourcedId: "math-raiders-grade-4",
      status: "active",
      dateLastModified: new Date().toISOString(),
      title: "Math Raiders Grade 4",
      courseCode: "MR-G4",
      grades: ["4"],
      subjects: ["Math"],
      subjectCodes: [""],
      org: { sourcedId: ORG_ID },
      metadata: {
        // Matches AlphaMath field structure
        totalLessons: 313,
        metrics: {
          totalXp: 916,          // AlphaMath's proven estimate for 313 facts
          totalLessons: 313      // 169 mult + 144 div (counting 5×6 and 6×5 separately)
        },
        goals: {
          dailyXp: 20,           // Target: 20 min/day
          dailyLessons: 8,       // Target: ~8 raids/day (2-3 min each)
          dailyAccuracy: 80,     // Target: 80% accuracy
          dailyActiveMinutes: 20,
          dailyMasteredUnits: 7  // Target: ~7 facts/day
        },
        AlphaLearn: {
          DailyXPGoal: 20,
          isPlacement: false,
          publishStatus: "active"
        },
        primaryApp: "math_raiders"
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
    console.log(`   ❌ Failed: ${courseRes.status}`);
    console.log(error);
    return;
  }
  
  console.log('   ✅ Course created: math-raiders-grade-4');
  
  // STEP 2: Create Component
  console.log('\n2️⃣ Creating Component...');
  
  const componentPayload = {
    courseComponent: {
      sourcedId: "math-raiders-grade-4-component",
      status: "active",
      dateLastModified: new Date().toISOString(),
      course: { sourcedId: "math-raiders-grade-4" },
      title: "Math Raiders Grade 4 Component",
      sortOrder: 0,
      unlockDate: "1970-01-01T00:00:00.000Z"
    }
  };
  
  const componentRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/components`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(componentPayload)
  });
  
  if (!componentRes.ok) {
    const error = await componentRes.text();
    console.log(`   ❌ Failed: ${componentRes.status}`);
    console.log(error);
    return;
  }
  
  console.log('   ✅ Component created: math-raiders-grade-4-component');
  
  // STEP 3: Create Component Resource
  console.log('\n3️⃣ Creating Component Resource...');
  
  const componentResourcePayload = {
    componentResource: {
      sourcedId: "math-raiders-grade-4-component-resource",
      status: "active",
      dateLastModified: new Date().toISOString(),
      courseComponent: { sourcedId: "math-raiders-grade-4-component" },
      resource: { sourcedId: EXISTING_MR_RESOURCE_ID },
      title: "Math Raiders Grade 4",
      sortOrder: 1
    }
  };
  
  const crRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/component-resources`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(componentResourcePayload)
  });
  
  if (!crRes.ok) {
    const error = await crRes.text();
    console.log(`   ❌ Failed: ${crRes.status}`);
    console.log(error);
    return;
  }
  
  console.log('   ✅ Component Resource created: math-raiders-grade-4-component-resource');
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('✅ COMPLETE - Math Raiders Grade 4 Course Created');
  console.log('='.repeat(70));
  console.log('\nStructure:');
  console.log('  Course: math-raiders-grade-4 (313 totalLessons, 916 totalXp)');
  console.log('  Component: math-raiders-grade-4-component');
  console.log('  Component Resource: math-raiders-grade-4-component-resource');
  console.log('\nNEXT STEPS:');
  console.log('  1. Update server code to reference new course ID in Caliper events');
  console.log('  2. Enroll pilot students in this course');
  console.log('  3. Events will auto-tag with correct course → 150/313 displays correctly');
}

createGrade4Course().catch(error => {
  console.error('❌ Error:', error.message);
  process.exitCode = 1;
});

