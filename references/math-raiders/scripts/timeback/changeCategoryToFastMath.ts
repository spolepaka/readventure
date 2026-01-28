#!/usr/bin/env bun
/**
 * Change Math Raiders from "Math" category to "Fast Math" category
 * Updates:
 * 1. All 5 courses (grades 1-5): subjects and metadata.primaryApp
 * 2. The shared resource: metadata.subject
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

async function updateCourses(token: string) {
  console.log('📚 Updating 5 courses...\n');
  
  for (let grade = 1; grade <= 5; grade++) {
    const courseId = `math-raiders-grade-${grade}`;
    console.log(`Grade ${grade}: ${courseId}`);
    
    // 1. Get current course
    const getRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/${courseId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!getRes.ok) {
      console.log(`  ❌ Failed to fetch: ${getRes.status}`);
      continue;
    }
    
    const data = await getRes.json();
    const course = data.course;
    
    // 2. Update the course
    course.subjects = ["FastMath"];
    if (!course.metadata) {
      course.metadata = {};
    }
    course.metadata.primaryApp = "fast_math";
    course.dateLastModified = new Date().toISOString();
    
    // 3. PUT the course
    const putRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/${courseId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ course })
    });
    
    if (putRes.ok) {
      console.log(`  ✅ Updated`);
      console.log(`     subjects: ["Math"] → ["FastMath"]`);
      console.log(`     primaryApp: "math_raiders" → "fast_math"`);
    } else {
      console.log(`  ❌ Failed to update: ${putRes.status}`);
      const error = await putRes.text();
      console.log(`     Error: ${error.substring(0, 200)}`);
    }
    
    console.log('');
  }
}

async function updateResource(token: string) {
  console.log('🎮 Updating shared resource...\n');
  
  const resourceId = 'c3b6a1b2-cf4b-436f-955c-8f83518d87ee';
  
  // 1. Get current resource
  const getRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/resources/v1p2/resources/${resourceId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!getRes.ok) {
    console.log(`❌ Failed to fetch resource: ${getRes.status}`);
    return;
  }
  
  const data = await getRes.json();
  const resource = data.resource;
  
  // 2. Update the resource
  if (!resource.metadata) {
    resource.metadata = {};
  }
  resource.metadata.subject = "FastMath";
  resource.dateLastModified = new Date().toISOString();
  
  // 3. PUT the resource
  const putRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/resources/v1p2/resources/${resourceId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ resource })
  });
  
  if (putRes.ok) {
    console.log(`✅ Resource updated`);
    console.log(`   ID: ${resourceId}`);
    console.log(`   metadata.subject: "Math" → "FastMath"`);
  } else {
    console.log(`❌ Failed to update resource: ${putRes.status}`);
    const error = await putRes.text();
    console.log(`   Error: ${error.substring(0, 200)}`);
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('CHANGE MATH RAIDERS CATEGORY: Math → Fast Math');
  console.log('='.repeat(80));
  console.log('');
  
  const token = await getToken();
  
  await updateCourses(token);
  await updateResource(token);
  
  console.log('');
  console.log('='.repeat(80));
  console.log('✅ COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log('Math Raiders should now appear in the "Fast Math" category');
  console.log('in the TimeBack dashboard.');
}

main().catch(console.error);

