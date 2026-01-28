#!/usr/bin/env bun
/**
 * Compare course structure between AlphaMath Fluency and Math Raiders
 * Shows components and component resources for comparison
 * 
 * Usage: bun compare-structure.ts [grade]
 * Example: bun compare-structure.ts 5
 */

import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

const API_BASE = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2`;

async function getToken() {
  const { clientId, clientSecret } = await getTimebackCredentials();
  
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = await response.json();
  return data.access_token;
}

async function compare() {
  const token = await getToken();
  
  // Default to Grade 5, but allow override via CLI arg
  const grade = parseInt(process.argv[2] || '5');
  const courses = [
    { id: `fastmath-grade-${grade}`, name: `AlphaMath Fluency Grade ${grade}` },
    { id: `math-raiders-grade-${grade}`, name: `Math Raiders Grade ${grade}` }
  ];
  
  console.log(`🔍 Comparing course structures for Grade ${grade}\n`);
  
  for (const course of courses) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${course.name}`);
    console.log('='.repeat(70));
    
    // Get components
    const compResp = await fetch(`${API_BASE}/courses/components?filter=course.sourcedId='${course.id}'`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const compData = await compResp.json();
    console.log(`\nComponents: ${compData.courseComponents?.length || 0}`);
    
    for (const comp of compData.courseComponents || []) {
      console.log(`\n📦 Component: ${comp.title}`);
      console.log(`   ID: ${comp.sourcedId}`);
      console.log(`   sortOrder: ${comp.sortOrder}`);
      console.log(`   metadata:`, comp.metadata);
      console.log(`   prerequisites:`, comp.prerequisites);
      console.log(`   prerequisiteCriteria:`, comp.prerequisiteCriteria);
      
      // Get component resources
      const resResp = await fetch(`${API_BASE}/courses/component-resources?filter=courseComponent.sourcedId='${comp.sourcedId}'`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const resData = await resResp.json();
      console.log(`\n   Resources: ${resData.componentResources?.length || 0}`);
      
      for (const res of resData.componentResources || []) {
        console.log(`\n   📎 Resource: ${res.title}`);
        console.log(`      ID: ${res.sourcedId}`);
        console.log(`      lessonType: ${res.lessonType}`);
        console.log(`      sortOrder: ${res.sortOrder}`);
        console.log(`      metadata:`, res.metadata);
      }
    }
  }
}

compare();
