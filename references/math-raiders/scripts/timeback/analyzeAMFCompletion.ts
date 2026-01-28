#!/usr/bin/env bun
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
const studentId = 'b9a646b7-990c-4876-8568-de6b4da6e28b';

console.log('🔍 ANALYZING AMF Assessment Results for Completion Logic\n');

const resultsRes = await fetch(`${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${studentId}'&limit=200`, {
  headers: { 'Authorization': `Bearer ${token}` }
});

const resultsData = await resultsRes.json();
const allResults = resultsData.assessmentResults || [];

const amfResults = allResults.filter((r: any) => 
  r.metadata?.appName === 'AlphaMath Fluency'
);

console.log(`Total AMF results: ${amfResults.length}\n`);

// Sort by date
amfResults.sort((a: any, b: any) => 
  new Date(a.scoreDate).getTime() - new Date(b.scoreDate).getTime()
);

console.log('='.repeat(70));
console.log('PART 1: Check for Linked Results (completion assessments)');
console.log('='.repeat(70));

const linkedResults = amfResults.filter((r: any) => r.assessmentLineItemSourcedId);
const unlinkedResults = amfResults.filter((r: any) => !r.assessmentLineItemSourcedId);

console.log(`Linked to line items: ${linkedResults.length}`);
console.log(`Unlinked (external): ${unlinkedResults.length}`);

if (linkedResults.length > 0) {
  console.log('\n⚠️ FOUND LINKED RESULTS (potential completion triggers):\n');
  linkedResults.forEach((r: any) => {
    console.log(`  Date: ${r.scoreDate}`);
    console.log(`  Score: ${r.score}`);
    console.log(`  LineItem: ${r.assessmentLineItemSourcedId}`);
    console.log(`  Metadata.lessonType: ${r.metadata?.lessonType}`);
    console.log(`  Metadata.originalObjectId: ${r.metadata?.originalObjectId?.substring(0, 60)}...`);
    console.log('');
  });
}

console.log('\n' + '='.repeat(70));
console.log('PART 2: Check Metadata for Completion Flags');
console.log('='.repeat(70));

const flaggedResults = amfResults.filter((r: any) => 
  r.metadata?.isComplete || 
  r.metadata?.courseCompleted || 
  r.metadata?.testOut ||
  r.metadata?.placement
);

console.log(`Results with completion flags: ${flaggedResults.length}`);
if (flaggedResults.length > 0) {
  flaggedResults.forEach((r: any) => {
    console.log(`  ${r.scoreDate}: ${JSON.stringify(r.metadata)}`);
  });
}

console.log('\n' + '='.repeat(70));
console.log('PART 3: Mastery Progression (first 5 and last 5)');
console.log('='.repeat(70));

const first5 = amfResults.slice(0, 5);
const last5 = amfResults.slice(-5);

console.log('\nFirst 5 results:');
first5.forEach((r: any, i: any) => {
  console.log(`  ${i+1}. ${r.scoreDate?.substring(0, 10)} - Mastered: ${r.metadata?.masteredUnits || 0}, Score: ${r.score || 0}`);
});

console.log('\nLast 5 results:');
last5.forEach((r: any, i: any) => {
  console.log(`  ${amfResults.length - 4 + i}. ${r.scoreDate?.substring(0, 10)} - Mastered: ${r.metadata?.masteredUnits || 0}, Score: ${r.score || 0}`);
});

console.log('\n' + '='.repeat(70));
console.log('PART 4: Unique Lesson Types');
console.log('='.repeat(70));

const lessonTypes = new Set(amfResults.map((r: any) => r.metadata?.lessonType).filter(Boolean));
console.log(`Unique lessonTypes: ${Array.from(lessonTypes).join(', ')}`);

console.log('\n' + '='.repeat(70));
console.log('CONCLUSION:');
console.log('='.repeat(70));

if (linkedResults.length > 0) {
  console.log('AMF HAS linked results that could mark completion.');
} else {
  console.log('AMF has NO linked results - completion is NOT tracked via assessments.');
  console.log('Likely relies on backend auto-enrollment based on mastery thresholds.');
}
