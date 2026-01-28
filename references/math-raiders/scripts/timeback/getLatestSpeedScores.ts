#!/usr/bin/env bun
/**
 * Diagnose a student's track locking status.
 * 
 * Mirrors the worker's fetchSpeedScoreData + determineLockedTracks logic exactly,
 * so you can verify what a student will see before they log in.
 * 
 * Usage: bun scripts/timeback/getLatestSpeedScores.ts <email>
 */
import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

const email = process.argv[2];
if (!email) {
  console.error('Usage: bun scripts/timeback/getLatestSpeedScores.ts <email>');
  process.exit(1);
}

async function getToken(): Promise<string> {
  const { clientId, clientSecret } = await getTimebackCredentials();
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

const token = await getToken();

const userRes = await fetch(
  `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const userData = await userRes.json();
const user = userData.users?.[0];
if (!user) {
  console.error(`User not found: ${email}`);
  process.exit(1);
}

const timebackId = user.sourcedId;
console.log(`${user.givenName} ${user.familyName} | ${timebackId}\n`);

interface AssessmentResult {
  metadata?: { grade?: number | string; cqpm?: number };
  assessmentLineItem?: { title?: string; sourcedId?: string };
  scoreDate?: string;
}

// Paginate through ALL assessments. Students with lots of MR activity can have 6000+,
// and Speed Scores get buried if we only fetch one page.
const limit = 3000;
let offset = 0;
let allResults: AssessmentResult[] = [];

while (true) {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${timebackId}'&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, { 
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) break;
  const data = await res.json();
  const results = data.assessmentResults || [];
  allResults.push(...results);
  if (results.length < limit) break;
  offset += limit;
}

// Speed Scores have cqpm + grade. MR events have xp, not cqpm, so they're excluded.
// Pre-K assessments have grade=-1 and assessmentType="PreK"
const speedScores = allResults.filter(r => 
  r.metadata?.cqpm !== undefined && r.metadata?.grade !== undefined
);

// Pre-K assessments (separate category)
const prekAssessments = allResults.filter(r => 
  (r.metadata as any)?.assessmentType === 'PreK' && r.metadata?.cqpm !== undefined
);

console.log(`Total assessments: ${allResults.length} | Speed Scores: ${speedScores.length} | Pre-K: ${prekAssessments.length}`);

// Sort by date descending (needed for reset detection and grade extraction)
speedScores.sort((a, b) => {
  const dateA = new Date(a.scoreDate || 0).getTime();
  const dateB = new Date(b.scoreDate || 0).getTime();
  return dateB - dateA;
});

function parseGrade(g: string | number | undefined): number {
  if (g === undefined) return -1;
  const s = String(g).toUpperCase();
  if (s === 'K' || s === 'KG') return 0;
  const match = s.match(/G?(\d+)/);
  return match ? parseInt(match[1], 10) : -1;
}

// Detect if student was ever reset (grade decreased). Walk chronologically.
// Compare to PREVIOUS grade, not max. G4→G2→G3 should only flag G4→G2 as reset.
function detectLastReset(): { date: string; from: number; to: number } | null {
  const chronological = [...speedScores].sort((a, b) => 
    new Date(a.scoreDate || 0).getTime() - new Date(b.scoreDate || 0).getTime()
  );
  let previousGrade = -1;
  let lastReset: { date: string; from: number; to: number } | null = null;
  for (const score of chronological) {
    const g = parseGrade(score.metadata?.grade);
    if (g < 0) continue;
    if (previousGrade >= 0 && g < previousGrade) {
      lastReset = { date: score.scoreDate?.slice(0, 10) ?? '?', from: previousGrade, to: g };
    }
    previousGrade = g;
  }
  return lastReset;
}

const resetInfo = detectLastReset();
const relevantScores = resetInfo
  ? speedScores.filter(s => (s.scoreDate || '') >= resetInfo.date)
  : speedScores;

const latestGrade = speedScores.length > 0 ? parseGrade(speedScores[0].metadata?.grade) : -1;
const grade = latestGrade >= 0 ? latestGrade : -1;

// FastMath uses different track numbers. K (track13) reuses TRACK12's content.
const FASTMATH_TO_MR: Record<string, string> = {
  'track5': 'TRACK5', 'track6': 'TRACK6', 'track7': 'TRACK7', 'track8': 'TRACK8',
  'track9': 'TRACK9', 'track10': 'TRACK10', 'track11': 'TRACK11', 'track12': 'TRACK12',
  'track13': 'TRACK12'
};

// Track names for human-readable output (matches client/src/data/tracks.ts)
const TRACK_NAMES: Record<string, string> = {
  'TRACK5': 'Division',
  'TRACK6': 'Add to 20',
  'TRACK7': 'Mult 0-12',
  'TRACK8': 'Sub to 20',
  'TRACK9': 'Add 0-9',
  'TRACK10': 'Sub from 20',
  'TRACK11': 'Mult 0-9',
  'TRACK12': 'Add Within 10',
};

const trackLabel = (t: string) => `${t} (${TRACK_NAMES[t] || '?'})`;

// Build per-track max CQPM from RELEVANT scores (post-reset only if reset detected)
// and history from ALL scores (for display purposes)
const trackMaxCqpm: Record<string, number> = {};
const trackHistory: Record<string, { date: string; cqpm: number }[]> = {};

// Max CQPM: only from relevant (post-reset) scores
for (const score of relevantScores) {
  const trackSource = score.assessmentLineItem?.title ?? score.assessmentLineItem?.sourcedId ?? '';
  const match = trackSource.match(/track(\d+)/i);
  if (!match) continue;
  const mrTrack = FASTMATH_TO_MR[`track${match[1]}`];
  if (!mrTrack) continue;
  const cqpm = score.metadata?.cqpm ?? 0;
  trackMaxCqpm[mrTrack] = Math.max(trackMaxCqpm[mrTrack] ?? 0, cqpm);
}

// History: from all scores (for display)
for (const score of speedScores) {
  const trackSource = score.assessmentLineItem?.title ?? score.assessmentLineItem?.sourcedId ?? '';
  const match = trackSource.match(/track(\d+)/i);
  if (!match) continue;
  const mrTrack = FASTMATH_TO_MR[`track${match[1]}`];
  if (!mrTrack) continue;
  const cqpm = score.metadata?.cqpm ?? 0;
  const date = score.scoreDate?.slice(0, 10) ?? '?';
  trackHistory[mrTrack] = trackHistory[mrTrack] || [];
  trackHistory[mrTrack].push({ date, cqpm });
}

// Sort each track's history by date descending
for (const track of Object.keys(trackHistory)) {
  trackHistory[track].sort((a, b) => b.date.localeCompare(a.date));
}

// Each grade has a required progression and target CQPM
const GRADE_PROGRESSION: Record<number, string[]> = {
  0: ['TRACK12'],
  1: ['TRACK12'],
  2: ['TRACK9', 'TRACK10'],
  3: ['TRACK6', 'TRACK8', 'TRACK11'],
  4: ['TRACK7', 'TRACK5'],
  5: ['TRACK6', 'TRACK8', 'TRACK7', 'TRACK5'],
};

const GRADE_TARGETS: Record<number, number> = {
  0: 20, 1: 30, 2: 30, 3: 30, 4: 35, 5: 40
};

const progression = GRADE_PROGRESSION[grade] || [];
const target = GRADE_TARGETS[grade] || 30;

const gradeDisplay = grade < 0 ? 'Unknown (no Speed Scores)' : `G${grade}`;
console.log(`Knowledge Grade: ${gradeDisplay} | requires: ${progression.length > 0 ? progression.map(trackLabel).join(' → ') + ` @ ${target} CQPM` : 'N/A'}`);
if (resetInfo) {
  console.log(`⚠️  RESET DETECTED: G${resetInfo.from} → G${resetInfo.to} on ${resetInfo.date}`);
  console.log(`   Only using ${relevantScores.length} of ${speedScores.length} scores (post-reset)`);
}
console.log('');

console.log('Track Status (post-reset max):');
for (const track of progression) {
  const max = trackMaxCqpm[track] ?? 0;
  const passed = max >= target;
  const history = trackHistory[track] || [];
  const recent = history.slice(0, 10).map(h => `${Math.round(h.cqpm)} (${h.date.slice(0,10)})`).join(', ') || '-';
  console.log(`  ${trackLabel(track)}: ${max.toFixed(1)} ${passed ? '✓' : '✗'}\n    recent: ${recent}`);
}

// Show other tracks with data (previous grades, etc.)
const otherTracks = Object.keys(trackMaxCqpm).filter(t => !progression.includes(t));
if (otherTracks.length > 0) {
  console.log('\nOther Tracks (previous grades):');
  for (const track of otherTracks) {
    const max = trackMaxCqpm[track] ?? 0;
    const history = trackHistory[track] || [];
    const recent = history.slice(0, 10).map(h => `${Math.round(h.cqpm)} (${h.date.slice(0,10)})`).join(', ') || '-';
    console.log(`  ${trackLabel(track)}: ${max.toFixed(1)}\n    recent: ${recent}`);
  }
}

// Locking logic (must match worker's determineLockedTracks exactly)
// Philosophy: Lock only PASSED tracks (prevent XP farming on mastered content)
const passed = progression.filter(t => (trackMaxCqpm[t] ?? 0) >= target);
const unpassed = progression.filter(t => (trackMaxCqpm[t] ?? 0) < target);

let lockedTracks: string[] = [];

if (unpassed.length === 0) {
  lockedTracks = [];                                    // Graduated: nothing locked
} else {
  lockedTracks = passed;                                // Lock only passed (can play any unpassed)
}

const canPlay = progression.filter(t => !lockedTracks.includes(t));
console.log('\n' + '='.repeat(50));
if (grade < 0) {
  console.log(`N/A - No FastMath Speed Scores (track locking does not apply)`);
} else if (lockedTracks.length === 0 && unpassed.length === 0) {
  console.log(`GRADUATED - All tracks unlocked (can replay any)`);
} else if (lockedTracks.length === 0) {
  console.log(`Can play: ${canPlay.map(trackLabel).join(', ')} (nothing passed yet)`);
} else {
  console.log(`lockedTracks: [${lockedTracks.map(trackLabel).join(', ')}]`);
  console.log(`Can play: ${canPlay.map(trackLabel).join(', ')}`);
}

// Pre-K Assessment Summary (if any)
if (prekAssessments.length > 0) {
  console.log('\n' + '='.repeat(50));
  console.log('PRE-K ASSESSMENTS');
  console.log('='.repeat(50));
  
  // Sort by date descending
  prekAssessments.sort((a, b) => {
    const dateA = new Date(a.scoreDate || 0).getTime();
    const dateB = new Date(b.scoreDate || 0).getTime();
    return dateB - dateA;
  });
  
  // Group by track
  const prekByTrack: Record<string, { date: string; cqpm: number; passed: boolean; accuracy: number }[]> = {};
  for (const score of prekAssessments) {
    const meta = score.metadata as any;
    const trackId = meta.testName?.match(/TRACK_[A-Z_]+/)?.[0] || 'Unknown';
    prekByTrack[trackId] = prekByTrack[trackId] || [];
    prekByTrack[trackId].push({
      date: score.scoreDate?.slice(0, 10) ?? '?',
      cqpm: meta.cqpm ?? 0,
      passed: meta.passedTest ?? meta.fluent === 'Yes',
      accuracy: meta.accuracyRate ?? 0
    });
  }
  
  // Show each Pre-K track
  for (const [track, scores] of Object.entries(prekByTrack)) {
    const maxCqpm = Math.max(...scores.map(s => s.cqpm));
    const passedCount = scores.filter(s => s.passed).length;
    const trackName = track.replace('TRACK_PREK_', '').replace('TRACK_K_', '');
    console.log(`\n  ${trackName}: max ${maxCqpm} CQPM | ${passedCount}/${scores.length} passed`);
    const recent = scores.slice(0, 5).map(s => 
      `${Math.round(s.cqpm)} ${s.passed ? '✓' : '✗'} (${s.date})`
    ).join(', ');
    console.log(`    recent: ${recent}`);
  }
}
