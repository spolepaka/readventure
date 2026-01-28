#!/usr/bin/env bun
/**
 * Deep comparison: AlphaMath Fluency Grade 5 vs Math Raiders Grade 5
 * Checks EVERY field to ensure we can't get yelled at
 */

// Load env vars from client/.env.production
import { join } from 'path';
const envPath = join(import.meta.dir, '../../client/.env.production');
const envFile = await Bun.file(envPath).text();
envFile.split('\n').forEach(line => {
  const match = line.match(/^(\w+)=(.*)$/);
  if (match) {
    const [, key, value] = match;
    process.env[key] = value;
  }
});

// Using us-east-1 (matches local VITE credentials)
const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = process.env.TIMEBACK_CLIENT_ID || process.env.VITE_TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = process.env.TIMEBACK_CLIENT_SECRET || process.env.VITE_TIMEBACK_CLIENT_SECRET;

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

const token = await getToken();

// Fetch AlphaMath Fluency Grade 5 (using sourcedId like verifyTimeBackSetup.ts)
const amRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/fastmath-grade-5`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const amData = await amRes.json();
const alphaMath = amData.course;

// Fetch Math Raiders Grade 5
const mrRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/math-raiders-grade-5`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const mrData = await mrRes.json();
const mathRaiders = mrData.course;

if (!alphaMath) {
  console.log('❌ AlphaMath Fluency Grade 5 not found!');
  console.log('AlphaMath Response:', JSON.stringify(amData, null, 2));
}

if (!mathRaiders) {
  console.log('❌ Math Raiders Grade 5 not found!');
  console.log('Math Raiders Response:', JSON.stringify(mrData, null, 2));
  process.exit(1);
}

if (!alphaMath) {
  console.log('\n⚠️  Can\'t compare - showing Math Raiders only:\n');
  console.log('Math Raiders Grade 5:');
  console.log(JSON.stringify(mathRaiders, null, 2));
  process.exit(0);
}

console.log('='.repeat(80));
console.log('DEEP COMPARISON: AlphaMath Fluency G5 vs Math Raiders G5');
console.log('='.repeat(80));
console.log('');

// Compare every metadata field
const fields = [
  ['sourcedId', alphaMath.sourcedId, mathRaiders.sourcedId],
  ['title', alphaMath.title, mathRaiders.title],
  ['status', alphaMath.status, mathRaiders.status],
  ['grades', JSON.stringify(alphaMath.grades), JSON.stringify(mathRaiders.grades)],
  ['subjects', JSON.stringify(alphaMath.subjects), JSON.stringify(mathRaiders.subjects)],
  ['courseCode', alphaMath.courseCode, mathRaiders.courseCode],
  ['---', '---', '---'],
  ['metadata.totalLessons', alphaMath.metadata?.totalLessons, mathRaiders.metadata?.totalLessons],
  ['metadata.metrics.totalXp', alphaMath.metadata?.metrics?.totalXp, mathRaiders.metadata?.metrics?.totalXp],
  ['metadata.metrics.totalLessons', alphaMath.metadata?.metrics?.totalLessons, mathRaiders.metadata?.metrics?.totalLessons],
  ['---', '---', '---'],
  ['metadata.goals.dailyXp', alphaMath.metadata?.goals?.dailyXp, mathRaiders.metadata?.goals?.dailyXp],
  ['metadata.goals.dailyLessons', alphaMath.metadata?.goals?.dailyLessons, mathRaiders.metadata?.goals?.dailyLessons],
  ['metadata.goals.dailyAccuracy', alphaMath.metadata?.goals?.dailyAccuracy, mathRaiders.metadata?.goals?.dailyAccuracy],
  ['metadata.goals.dailyActiveMinutes', alphaMath.metadata?.goals?.dailyActiveMinutes, mathRaiders.metadata?.goals?.dailyActiveMinutes],
  ['metadata.goals.dailyMasteredUnits', alphaMath.metadata?.goals?.dailyMasteredUnits, mathRaiders.metadata?.goals?.dailyMasteredUnits],
  ['---', '---', '---'],
  ['metadata.AlphaLearn.DailyXPGoal', alphaMath.metadata?.AlphaLearn?.DailyXPGoal, mathRaiders.metadata?.AlphaLearn?.DailyXPGoal],
  ['metadata.AlphaLearn.isPlacement', alphaMath.metadata?.AlphaLearn?.isPlacement, mathRaiders.metadata?.AlphaLearn?.isPlacement],
  ['metadata.AlphaLearn.publishStatus', alphaMath.metadata?.AlphaLearn?.publishStatus, mathRaiders.metadata?.AlphaLearn?.publishStatus],
  ['metadata.primaryApp', alphaMath.metadata?.primaryApp, mathRaiders.metadata?.primaryApp],
];

console.log('Field'.padEnd(40) + 'AlphaMath'.padEnd(20) + 'MathRaiders'.padEnd(20) + 'Match');
console.log('-'.repeat(80));

let allMatch = true;
fields.forEach(([field, amVal, mrVal]) => {
  if (field === '---') {
    console.log('');
    return;
  }
  
  const match = JSON.stringify(amVal) === JSON.stringify(mrVal);
  const status = match ? '✅' : '❌';
  
  if (!match && field !== 'sourcedId' && field !== 'title' && field !== 'courseCode' && field !== 'metadata.primaryApp') {
    allMatch = false;
  }
  
  console.log(
    field.padEnd(40) +
    String(amVal ?? 'N/A').padEnd(20) +
    String(mrVal ?? 'N/A').padEnd(20) +
    status
  );
});

console.log('');
console.log('='.repeat(80));

// Show full metadata for inspection
console.log('\nAlphaMath Full Metadata:');
console.log(JSON.stringify(alphaMath.metadata, null, 2));

console.log('\nMath Raiders Full Metadata:');
console.log(JSON.stringify(mathRaiders.metadata, null, 2));

console.log('\n' + '='.repeat(80));
console.log(allMatch ? '✅ SAFE TO SHIP' : '⚠️  REVIEW DIFFERENCES');
console.log('='.repeat(80));






