#!/usr/bin/env bun
/**
 * List and delete old Math Raiders courses from TimeBack
 * Keeps: math-raiders-grade-4
 * Deletes: Everything else with "math-raiders" or "Math Raiders" in title
 */

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = Bun.env.TIMEBACK_CLIENT_ID || Bun.env.VITE_TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = Bun.env.TIMEBACK_CLIENT_SECRET || Bun.env.VITE_TIMEBACK_CLIENT_SECRET;

const KEEP_COURSE_ID = 'math-raiders-grade-4';  // Production course to keep

async function getToken(): Promise<string> {
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

async function cleanup() {
  console.log('🔍 Finding Math Raiders courses...\n');
  
  const token = await getToken();
  
  // Search for all Math Raiders courses
  const searchUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/?search=Math Raiders&limit=100`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!searchRes.ok) {
    console.error('❌ Failed to search courses');
    process.exit(1);
  }
  
  const data = await searchRes.json() as { courses: any[] };
  const courses = data.courses || [];
  
  console.log(`Found ${courses.length} Math Raiders courses:\n`);
  
  // Categorize
  const keep: any[] = [];
  const remove: any[] = [];
  
  courses.forEach(course => {
    if (course.sourcedId === KEEP_COURSE_ID) {
      keep.push(course);
    } else {
      remove.push(course);
    }
  });
  
  // Show what we'll keep
  console.log('✅ KEEPING:');
  if (keep.length === 0) {
    console.log('   (none - production course not found!)');
  } else {
    keep.forEach(c => {
      console.log(`   - ${c.title} (${c.sourcedId})`);
      console.log(`     Status: ${c.status}`);
      console.log(`     Metadata: totalLessons=${c.metadata?.totalLessons || 'N/A'}`);
    });
  }
  
  console.log('');
  
  // Show what we'll delete
  console.log('❌ WILL DELETE:');
  if (remove.length === 0) {
    console.log('   (none - all clean!)');
    console.log('\n✨ No cleanup needed!');
    process.exit(0);
  }
  
  remove.forEach(c => {
    console.log(`   - ${c.title} (${c.sourcedId})`);
    console.log(`     Status: ${c.status}`);
  });
  
  console.log('');
  console.log('⚠️  This will soft-delete (set status=tobedeleted) these courses.');
  console.log('Type "DELETE" to confirm: ');
  
  // Wait for confirmation
  const confirmation = await new Promise<string>(resolve => {
    process.stdin.once('data', data => resolve(data.toString().trim()));
  });
  
  if (confirmation !== 'DELETE') {
    console.log('\n❌ Aborted - no courses deleted');
    process.exit(0);
  }
  
  // Delete each old course
  console.log('\n🗑️  Deleting old courses...\n');
  
  for (const course of remove) {
    const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/${course.sourcedId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.status === 204) {
      console.log(`✅ Deleted: ${course.title}`);
    } else {
      const error = await response.text();
      console.error(`❌ Failed to delete ${course.title}: ${error}`);
    }
  }
  
  console.log('\n✨ Cleanup complete!');
  console.log(`\nKept: ${keep.length} course(s)`);
  console.log(`Deleted: ${remove.length} course(s)`);
}

cleanup().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});


