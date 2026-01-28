#!/usr/bin/env bun
// Fetch AlphaMath/FastMath assessment scores for pilot CQPM comparison
// Usage: bun tests/fetch-alphamath-scores.ts [timebackId] [date-filter]
// Example: bun tests/fetch-alphamath-scores.ts b9a646b7-990c... 2025-10-18

const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_CLIENT_ID = process.env.VITE_TIMEBACK_CLIENT_ID || '';
const TIMEBACK_CLIENT_SECRET = process.env.VITE_TIMEBACK_CLIENT_SECRET || '';

if (!TIMEBACK_CLIENT_ID || !TIMEBACK_CLIENT_SECRET) {
  console.error('❌ Missing credentials');
  console.error('Set: VITE_TIMEBACK_CLIENT_ID and VITE_TIMEBACK_CLIENT_SECRET');
  process.exit(1);
}

// CLI args or defaults
const timebackId = process.argv[2] || 'b9a646b7-990c-4876-8568-de6b4da6e28b';
const dateFilter = process.argv[3]; // Optional: "2025-10-18"

async function getToken(): Promise<string> {
  console.log('🔑 Getting OAuth token...');
  
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: TIMEBACK_CLIENT_ID,
      client_secret: TIMEBACK_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Auth failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { access_token: string };
  console.log('✅ Got token\n');
  return data.access_token;
}

async function fetchAssessmentResults(timebackId: string, token: string) {
  console.log(`📊 Fetching assessment results for ${timebackId}...`);
  
  // Filter by student, sort by date (newest first), get more results
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults/?filter=student.sourcedId='${timebackId}'&sort=scoreDate&orderBy=desc&limit=500`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.error(`❌ API error: ${response.status}`);
    const text = await response.text();
    console.error('Response:', text);
    return null;
  }

  const data = await response.json();
  return data;
}

async function main() {
  try {
    console.log('📊 AlphaMath/FastMath CQPM Score Fetcher');
    console.log('='.repeat(50));
    console.log(`Timeback ID: ${timebackId}`);
    if (dateFilter) console.log(`Date Filter: ${dateFilter}`);
    console.log();

    // Get token
    const token = await getToken();

    // Fetch results
    const data = await fetchAssessmentResults(timebackId, token);

    if (!data || !data.assessmentResults) {
      console.log('❌ No assessment results found');
      return;
    }

    console.log(`✅ Found ${data.assessmentResults.length} total results\n`);

    // Filter for FastMath/AlphaMath only
    const fastMathResults = data.assessmentResults.filter((r: any) => {
      const sourcedId = r.assessmentLineItem?.sourcedId || '';
      return sourcedId.includes('fastmath') || sourcedId.includes('alphamath');
    });

    console.log(`🎯 FastMath assessments: ${fastMathResults.length}\n`);

    if (fastMathResults.length === 0) {
      console.log('⚠️  No FastMath assessments found');
      console.log('Sample lineItem IDs:');
      data.assessmentResults.slice(0, 5).forEach((r: any) => {
        console.log(`  - ${r.assessmentLineItem?.sourcedId}`);
      });
      return;
    }

    // Apply date filter if provided
    let resultsToShow = fastMathResults;
    if (dateFilter) {
      resultsToShow = fastMathResults.filter((r: any) => 
        r.scoreDate?.startsWith(dateFilter)
      );
      console.log(`📅 Filtered to ${dateFilter}: ${resultsToShow.length} results\n`);
    }
    
    // Sort by date (most recent first)
    resultsToShow = resultsToShow.sort((a: any, b: any) => 
      new Date(b.scoreDate).getTime() - new Date(a.scoreDate).getTime()
    );

    // Map track IDs to readable names (all AlphaMath tracks)
    const TRACK_NAMES: Record<string, string> = {
      // L2 assessments (newer format)
      'fastmath-track13-l2-assessment': 'K Addition Within 10',
      'fastmath-track12-l2-assessment': 'G1 Addition Within 10',
      'fastmath-track9-l2-assessment': 'G2 Addition Single-Digit',
      'fastmath-track10-l2-assessment': 'G2 Subtraction Single-Digit',
      'fastmath-track6-l2-assessment': 'G3 Addition up to 20',
      'fastmath-track8-l2-assessment': 'G3 Subtraction up to 20',
      'fastmath-track11-l2-assessment': 'G3 Multiplication',
      'fastmath-track7-l2-assessment': 'G4 Multiplication up to 12',
      'fastmath-track5-l2-assessment': 'G4 Division up to 12',
      
      // Regular assessments (older format)
      'fastmath-track13-assessment': 'K Addition Within 10',
      'fastmath-track12-assessment': 'G1 Addition Within 10',
      'fastmath-track9-assessment': 'G2 Addition Single-Digit',
      'fastmath-track10-assessment': 'G2 Subtraction Single-Digit',
      'fastmath-track6-assessment': 'G3 Addition up to 20',
      'fastmath-track8-assessment': 'G3 Subtraction up to 20',
      'fastmath-track11-assessment': 'G3 Multiplication',
      'fastmath-track7-assessment': 'G4 Multiplication up to 12',
      'fastmath-track5-assessment': 'G4 Division up to 12',
      
      // Progress assessments
      'fastmath-addition-progress-assessment': 'Addition Progress Check',
      'fastmath-subtraction-progress-assessment': 'Subtraction Progress Check',
      'fastmath-multiplication-progress-assessment': 'Multiplication Progress Check',
      'fastmath-division-progress-assessment': 'Division Progress Check',
    };

    // Show results
    resultsToShow.forEach((r: any, i: number) => {
      const trackId = r.assessmentLineItem?.sourcedId || 'unknown';
      const trackName = TRACK_NAMES[trackId] || trackId;
      const cqpm = r.metadata?.cqpm;
      const fluent = r.metadata?.fluent === 'Yes';
      const accuracy = r.metadata?.accuracyRate;
      const date = new Date(r.scoreDate).toLocaleString();
      
      console.log(`${i+1}. ${trackName}`);
      console.log(`   CQPM: ${cqpm || 'N/A'} ${fluent ? '✅ Fluent' : '❌ Not fluent'}`);
      console.log(`   Accuracy: ${accuracy}% (${r.metadata?.correct}/${r.metadata?.attempts})`);
      console.log(`   Score: ${r.score}`);
      console.log(`   Date: ${date}`);
      console.log();
    });

    // Calculate improvement if multiple tests per track
    const trackGroups: Record<string, any[]> = {};
    resultsToShow.forEach(r => {
      const track = r.assessmentLineItem?.sourcedId || 'unknown';
      if (!trackGroups[track]) trackGroups[track] = [];
      trackGroups[track].push(r);
    });

    console.log('📈 IMPROVEMENT ANALYSIS');
    console.log('-'.repeat(50));
    Object.entries(trackGroups).forEach(([track, results]) => {
      if (results.length < 2) return;
      
      const sorted = results.sort((a, b) => 
        new Date(a.scoreDate).getTime() - new Date(b.scoreDate).getTime()
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const delta = (last.metadata?.cqpm || 0) - (first.metadata?.cqpm || 0);
      
      console.log(`${TRACK_NAMES[track] || track}:`);
      console.log(`  First: ${first.metadata?.cqpm} CQPM (${new Date(first.scoreDate).toLocaleDateString()})`);
      console.log(`  Last:  ${last.metadata?.cqpm} CQPM (${new Date(last.scoreDate).toLocaleDateString()})`);
      console.log(`  Δ:     ${delta > 0 ? '+' : ''}${delta} CQPM`);
      console.log();
    });
    
    return;

    // Show AlphaMath scores
    alphaMathResults.forEach((r: any) => {
      const title = r.assessmentLineItem?.title || r.lineItem?.title || 'Unknown';
      const operation = title.match(/(Addition|Subtraction|Multiplication|Division)/)?.[1] || '?';
      const score = r.score;
      const date = new Date(r.scoreDate).toLocaleDateString();
      const metadata = r.metadata || {};

      console.log(`📝 ${operation}:`);
      console.log(`   Title: ${title}`);
      console.log(`   Score: ${score} ${metadata.scoreType || ''}`);
      console.log(`   Date: ${date}`);
      console.log(`   Metadata:`, JSON.stringify(metadata, null, 2));
      console.log();
    });

    console.log('\n🎉 SUCCESS: Assessment data is accessible via OneRoster API');
    console.log('You can use this for pre/post CQPM comparison without MasteryTrack');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

main();

