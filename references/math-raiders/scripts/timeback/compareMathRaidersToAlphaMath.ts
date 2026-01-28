#!/usr/bin/env bun
/**
 * Print Math Raiders AND AlphaMath Fluency course configurations (Grades 1-5)
 * Shows current goals and metadata for comparison
 */

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = Bun.env.TIMEBACKCLIENTID || Bun.env.TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = Bun.env.TIMEBACKSECRET || Bun.env.TIMEBACK_CLIENT_SECRET;

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

async function fetchCourse(courseId: string, token: string) {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/${courseId}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    return { error: `HTTP ${response.status}: ${await response.text()}` };
  }
  
  return await response.json();
}

function printCourseDetails(course: any, prefix: string = '') {
  console.log(`${prefix}📖 Course ID: ${course.sourcedId}`);
  console.log(`${prefix}📝 Title: ${course.title}`);
  
  if (course.metadata) {
    if (course.metadata.metrics) {
      console.log(`${prefix}📊 totalXp: ${course.metadata.metrics.totalXp}, totalLessons: ${course.metadata.metrics.totalLessons}`);
    }
    
    if (course.metadata.goals) {
      console.log(`${prefix}🎯 Goals:`);
      console.log(`${prefix}   dailyXp: ${course.metadata.goals.dailyXp}`);
      console.log(`${prefix}   dailyLessons: ${course.metadata.goals.dailyLessons}`);
      console.log(`${prefix}   dailyAccuracy: ${course.metadata.goals.dailyAccuracy}`);
      console.log(`${prefix}   dailyActiveMinutes: ${course.metadata.goals.dailyActiveMinutes}`);
      console.log(`${prefix}   dailyMasteredUnits: ${course.metadata.goals.dailyMasteredUnits}`);
    }
    
    if (course.metadata.AlphaLearn) {
      console.log(`${prefix}🏫 AlphaLearn: DailyXPGoal=${course.metadata.AlphaLearn.DailyXPGoal}`);
    }
    
    if (course.metadata.primaryApp) {
      console.log(`${prefix}🎮 Primary App: ${course.metadata.primaryApp}`);
    }
  }
}

async function printAllCourses() {
  console.log('📚 Comparing Math Raiders vs AlphaMath Fluency (Grades 1-5)\n');
  console.log('='.repeat(100));
  
  const token = await fetchAccessToken();
  
  for (let grade = 1; grade <= 5; grade++) {
    console.log(`\n🎓 GRADE ${grade}`);
    console.log('-'.repeat(100));
    
    // Fetch Math Raiders
    const mrResult = await fetchCourse(`math-raiders-grade-${grade}`, token);
    const amfResult = await fetchCourse(`fastmath-grade-${grade}`, token);
    
    // Math Raiders
    console.log('\n📘 MATH RAIDERS:');
    if (mrResult.error) {
      console.log(`   ❌ Error: ${mrResult.error}`);
    } else if (mrResult.course) {
      printCourseDetails(mrResult.course, '   ');
    } else {
      console.log('   ❌ Course not found');
    }
    
    // AlphaMath Fluency
    console.log('\n📗 ALPHAMATH FLUENCY:');
    if (amfResult.error) {
      console.log(`   ❌ Error: ${amfResult.error}`);
    } else if (amfResult.course) {
      printCourseDetails(amfResult.course, '   ');
    } else {
      console.log('   ❌ Course not found');
    }
  }
  
  console.log('\n' + '='.repeat(100));
  console.log('✅ Done!\n');
}

printAllCourses().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

