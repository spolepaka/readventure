// Math Raiders TimeBack Worker
// Processes events from SpacetimeDB queue and sends to TimeBack API

// Polyfill MUST run before anything imports the SDK
import '@ungap/compression-stream/poly'; // provides global CompressionStream/DecompressionStream in Bun

import { DbConnection } from './spacetimedb';
import TimebackEventQueueRowBuilder from './spacetimedb/timeback_event_queue_table';
import type { Infer } from 'spacetimedb';
import type { EventContext, ReducerEventContext } from './spacetimedb';

type TimebackEventQueue = Infer<typeof TimebackEventQueueRowBuilder>;

// Constants
const MAX_RETRIES = 5;
const RECONNECT_DELAY_MS = 5000;
const TOKEN_REFRESH_BUFFER_SECONDS = 60;

// Types
interface EventPayload {
  timebackId: string;
  email: string;
  grade: number;  // Player's grade for routing to correct course
  resourceId: string;
  raidEndTime: string;
  raidDurationMinutes: number;
  xpEarned: number;
  totalQuestions: number;
  correctQuestions: number;
  masteredUnits?: number;
  process?: boolean;
  attempt?: number;
}

interface CaliperEnvelope {
  sensor: string;
  sendTime: string;
  dataVersion: string;
  data: any[]; // Caliper event structure is complex, keeping any[] for the actual event data
}

interface OAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// Environment config
const config = {
  spacetimedb: {
    uri: process.env.SPACETIMEDB_URI || 'ws://localhost:3000',
    module: process.env.SPACETIMEDB_MODULE || 'math-raiders',
    token: process.env.SPACETIMEDB_TOKEN // Owner token for accessing private tables
  },
  timeback: {
    apiUrl: process.env.TIMEBACK_API_URL || 'https://caliper.alpha-1edtech.ai/caliper/event',
    authUrl: process.env.TIMEBACK_AUTH_URL || 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token',
    clientId: process.env.TIMEBACK_CLIENT_ID!,
    clientSecret: process.env.TIMEBACK_CLIENT_SECRET!
  },
  pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000')
};

// Validate required config
if (!config.spacetimedb.token) {
  console.error('❌ Missing required SPACETIMEDB_TOKEN');
  console.error('   Worker needs owner token to access timeback_event_queue (RLS protected)');
  console.error('   Set SPACETIMEDB_TOKEN in your .env file');
  process.exit(1);
}

if (!config.timeback.clientId || !config.timeback.clientSecret) {
  console.error('❌ Missing required TimeBack credentials. Set TIMEBACK_CLIENT_ID and TIMEBACK_CLIENT_SECRET');
  process.exit(1);
}

// Playcademy verification URL - computed once at startup
const playcademyBaseUrl = (() => {
  if (process.env.PLAYCADEMY_BASE_URL) return process.env.PLAYCADEMY_BASE_URL;
  switch (process.env.NODE_ENV) {
    case 'development': return 'http://localhost:4321';
    case 'staging': return 'https://hub.dev.playcademy.net';
    default: return 'https://hub.playcademy.net';
  }
})();

// Track events being processed to prevent duplicates
const processingEvents = new Set<bigint>();

// OAuth Token Manager
class TokenManager {
  private token?: string;
  private expiresAt?: Date;

  async getToken(): Promise<string> {
    // Return cached token if still valid
    if (this.token && this.expiresAt && new Date() < this.expiresAt) {
      return this.token;
    }

    // Token fetch is internal - only log result
    const response = await fetch(config.timeback.authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `grant_type=client_credentials&client_id=${config.timeback.clientId}&client_secret=${config.timeback.clientSecret}`
    });

    if (!response.ok) {
      throw new Error(`OAuth failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as OAuthResponse;
    this.token = data.access_token;
    // Refresh 1 minute before expiration
    this.expiresAt = new Date(Date.now() + (data.expires_in - TOKEN_REFRESH_BUFFER_SECONDS) * 1000);
    
    console.log('[TOKEN] refreshed expires:', this.expiresAt.toISOString());
    return this.token;
  }

  invalidate() {
    this.token = undefined;
    this.expiresAt = undefined;
  }
}

const tokenManager = new TokenManager();

// Playcademy SSO doesn't always include TimeBack fields. When missing, we look them up directly.
const TIMEBACK_API = 'https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2';

// Math Raiders class IDs per grade (0 = K)
// Used for enrollment sync - when a student's knowledge grade changes, we update their MR class
const MR_CLASS_IDS: Record<number, string> = {
  0: 'a747e46c-db9d-43de-a586-44b4cc17e003', // Grade K
  1: 'd7f70171-ad42-4cc9-9ebb-59c210bc6604', // Grade 1
  2: 'db8df2b3-70d5-42b6-a5cd-15ec27031f4c', // Grade 2
  3: 'f0dc89af-4867-47ea-86d5-5cf7124afd1c', // Grade 3
  4: '46c143a7-83eb-4362-921f-8afea732bcda', // Grade 4
  5: 'fa2ca870-b475-44fe-9dc1-9f94dba5cb93', // Grade 5
};

const MR_CLASS_ID_SET = new Set(Object.values(MR_CLASS_IDS));

interface MREnrollment {
  sourcedId: string;
  grade: number;
  classId: string;
}

// Find a student's current Math Raiders enrollment (if any)
// Returns null if not enrolled, or the enrollment details if enrolled
async function findMREnrollment(userId: string): Promise<MREnrollment | null> {
  const url = `${TIMEBACK_API}/enrollments?filter=user.sourcedId='${userId}'&limit=200`;
  
  const fetchOnce = async () => {
    const token = await tokenManager.getToken();
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  };

  let response = await fetchOnce();
  if (response.status === 401) {
    tokenManager.invalidate();
    response = await fetchOnce();
  }

  if (!response.ok) return null;

  const data = await response.json() as { enrollments?: Array<{ sourcedId: string; status: string; class?: { sourcedId: string } }> };
  if (!data.enrollments) return null;

  // Find active MR enrollment
  for (const e of data.enrollments) {
    if (e.status !== 'active') continue;
    const classId = e.class?.sourcedId;
    if (!classId || !MR_CLASS_ID_SET.has(classId)) continue;
    
    // Find the grade for this class
    for (const [gradeStr, id] of Object.entries(MR_CLASS_IDS)) {
      if (id === classId) {
        return { sourcedId: e.sourcedId, grade: parseInt(gradeStr, 10), classId };
      }
    }
  }

  return null;
}

// Sync a student's MR enrollment to match their knowledge grade
// Only syncs if they're already enrolled (we don't auto-enroll new students)
async function syncMREnrollment(userId: string, targetGrade: number): Promise<void> {
  const current = await findMREnrollment(userId);
  
  // Not enrolled in MR - don't auto-enroll, that's an admin decision
  if (!current) return;
  
  // Already in correct grade - nothing to do
  if (current.grade === targetGrade) return;
  
  const targetClassId = MR_CLASS_IDS[targetGrade];
  if (!targetClassId) {
    console.warn(`[SYNC] No class for grade ${targetGrade}`);
    return;
  }
  
  const today = new Date().toISOString().split('T')[0];
  
  // Step 1: PATCH to set endDate on old enrollment (clean record-keeping)
  try {
    const token = await tokenManager.getToken();
    await fetch(`${TIMEBACK_API}/enrollments/${current.sourcedId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollment: { endDate: today } }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // PATCH failed, continue with DELETE anyway
  }
  
  // Step 2: DELETE to soft-delete old enrollment (status -> tobedeleted)
  try {
    const token = await tokenManager.getToken();
    const res = await fetch(`${TIMEBACK_API}/enrollments/${current.sourcedId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 204) {
      console.warn(`[SYNC] DELETE failed: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[SYNC] DELETE error:`, e);
    return; // Don't create new enrollment if we couldn't remove old one
  }
  
  // Step 3: POST to create new enrollment in target grade
  const enrollmentId = `mr-enroll-${userId}-g${targetGrade}`;
  try {
    const token = await tokenManager.getToken();
    const res = await fetch(`${TIMEBACK_API}/enrollments/`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollment: {
          sourcedId: enrollmentId,
          status: 'active',
          role: 'student',
          beginDate: today,
          user: { sourcedId: userId },
          class: { sourcedId: targetClassId },
        }
      }),
      signal: AbortSignal.timeout(5000),
    });
    
    if (res.ok || res.status === 201) {
      console.log(`[SYNC] ✓ ${userId.slice(0,8)} G${current.grade}→G${targetGrade}`);
    } else {
      console.warn(`[SYNC] POST failed: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[SYNC] POST error:`, e);
  }
}

interface TimebackUser {
  sourcedId: string;
  givenName?: string;
  familyName?: string;
}

async function findTimebackUserByEmail(email: string): Promise<TimebackUser | null> {
  const filter = encodeURIComponent(`email='${email}'`);
  const url = `${TIMEBACK_API}/users?filter=${filter}`;
  
  const fetchOnce = async () => {
    const token = await tokenManager.getToken();
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  };
  
  let response = await fetchOnce();
  if (response.status === 401) {
    tokenManager.invalidate();
    response = await fetchOnce();
  }
  
  if (!response.ok) {
    throw new Error(`TimeBack user lookup failed: ${response.status}`);
  }
  
  const data = await response.json() as { users?: TimebackUser[] };
  return data.users?.[0] ?? null;
}

function buildDisplayName(givenName?: string, familyName?: string): string | null {
  const parts = [givenName, familyName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

// ==================== HTTP API SERVER ====================

import { verifyGameToken } from '@playcademy/sdk/server';

// Store the SpacetimeDB connection for the verify endpoint
let stdbConnection: DbConnection | null = null;

// Start HTTP server for grade fetching and JWT verification
const PORT = parseInt(process.env.PORT || '3001', 10);
const httpServer = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    // CORS headers for local dev (client on :5173, worker on :3001)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',  // TODO: Restrict to specific origins in production
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    
    // Health check
    if (url.pathname === '/health') {
      return Response.json({ 
        status: 'ok', 
        stdbConnected: stdbConnection !== null,
        timestamp: new Date().toISOString() 
      }, { headers: corsHeaders });
    }
    
    // JWT verification endpoint - creates verified session
    if (url.pathname === '/verify' && req.method === 'POST') {
      let stdbIdentity: string | undefined;
      let email: string | undefined;
      let playerId: string | undefined;
      try {
        const body = await req.json() as { token?: string; stdbIdentity?: string };
        const token = body.token;
        stdbIdentity = body.stdbIdentity;
        
        // Validate input
        if (!stdbIdentity) {
          return Response.json(
            { error: 'Missing stdbIdentity' }, 
            { status: 400, headers: corsHeaders }
          );
        }
        
        // Dev mode: allow connection without Playcademy token
        // Uses !== 'production' so staging/test also bypass (intentional)
        if (!token && process.env.NODE_ENV !== 'production') {
          const devPlayerId = `dev-${stdbIdentity.slice(0, 8)}`;
          console.log('[VERIFY] dev mode player:', devPlayerId);
          
          if (!stdbConnection) {
            return Response.json(
              { error: 'SpacetimeDB not connected' }, 
              { status: 503, headers: corsHeaders }
            );
          }
          
          // Create session for dev player
          await stdbConnection.reducers.createSession({
            clientIdentity: stdbIdentity,
            playerId: devPlayerId,
          });
          
          return Response.json({ playerId: devPlayerId }, { headers: corsHeaders });
        }
        
        if (!token) {
          return Response.json(
            { error: 'Missing token' }, 
            { status: 400, headers: corsHeaders }
          );
        }
        
        // Verify token with Playcademy API (URL configured at module level)
        const { user, gameId } = await verifyGameToken(token, { baseUrl: playcademyBaseUrl });
        email = user.email;
        
        if (!stdbConnection) {
          return Response.json(
            { error: 'SpacetimeDB not connected' }, 
            { status: 503, headers: corsHeaders }
          );
        }
        
        // Dev mode: use stdbIdentity-based playerId for unique local multiplayer testing
        // Playcademy's local dev server returns same test user for all sessions
        playerId = process.env.NODE_ENV === 'development' 
          ? `dev-${stdbIdentity.slice(0, 8)}`
          : user.sub;
        
        // 1. Gather all claims first (enrich before authorizing)
        // Playcademy is authoritative, but sometimes returns incomplete data.
        // Fill gaps from TimeBack so the player record is complete from day one.
        let timebackId = user.timeback_id;
        let displayName = user.name;
        
        const playcademyHadId = !!timebackId;
        const playcademyHadName = !!displayName && displayName !== user.email;
        let backfillSource: 'none' | 'timeback' | 'not_found' | 'failed' = 'none';
        
        if ((!playcademyHadId || !playcademyHadName) && user.email) {
          try {
            const timebackUser = await findTimebackUserByEmail(user.email);
            if (timebackUser) {
              timebackId ??= timebackUser.sourcedId;
              displayName = buildDisplayName(timebackUser.givenName, timebackUser.familyName) ?? displayName;
              backfillSource = 'timeback';
            } else {
              backfillSource = 'not_found';
            }
          } catch {
            backfillSource = 'failed';
          }
        }
        
        // 2. Fetch grade + locked tracks from TimeBack (self-healing: teacher changes grade → next login updates)
        let grade: number | null = null;
        let lockedTracks: string[] = [];
        let latestTrack: string | null = null;
        let forceUnlock: string[] | null = null;
        let forceLock: string[] | null = null;
        if (timebackId) {
          try {
            const data = await fetchSpeedScoreData(timebackId);
            grade = data.grade;
            lockedTracks = data.lockedTracks;
            latestTrack = data.latestTrack;
            forceUnlock = data.forceUnlock;
            forceLock = data.forceLock;
            
            // 2b. Sync MR enrollment if grade changed (non-blocking)
            // Only syncs for already-enrolled students; never auto-enrolls new students
            if (grade !== null) {
              syncMREnrollment(timebackId, grade).catch(e => {
                console.warn('[SYNC] error:', e);
              });
            }
          } catch {
            // Grade fetch failed, client will use existing DB grade
          }
        }

        // 3. Then establish session (authorize)
        await stdbConnection.reducers.createSession({
          clientIdentity: stdbIdentity,
          playerId,
        });
        
        // One canonical log line per verify - tells the whole story, queryable
        const unlockStr = forceUnlock ? ` unlock=${forceUnlock.join(',')}` : '';
        const lockStr = forceLock ? ` lock=${forceLock.join(',')}` : '';
        console.log(`[VERIFY] email=${user.email} pc_sub=${user.sub} player_id=${playerId} pc_had_id=${playcademyHadId} pc_had_name=${playcademyHadName} backfill=${backfillSource} timeback_id=${timebackId?.slice(0,8) ?? 'none'} grade=${grade ?? 'null'} locked=${lockedTracks.length}${unlockStr}${lockStr} latest=${latestTrack ?? 'null'} name="${displayName}" game_id=${gameId}`);

        return Response.json({
          playerId,
          name: displayName,
          email: user.email,
          timebackId,
          grade,
          lockedTracks,
          latestTrack,
        }, { headers: corsHeaders });
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isAuthError = error instanceof Error && (errorMsg.includes('401') || errorMsg.includes('Unauthorized'));
        
        // Canonical failure log with context
        console.error(`[VERIFY] ✗ ws:${stdbIdentity?.slice(0,8) ?? 'unknown'} email=${email ?? 'unknown'} player_id=${playerId ?? 'unknown'} error=${isAuthError ? 'token_invalid' : 'internal'} msg="${errorMsg.slice(0,100)}"`);
        
        if (isAuthError) {
          return Response.json(
            { error: 'Invalid or expired token' }, 
            { status: 401, headers: corsHeaders }
          );
        }
        
        return Response.json(
          { error: 'Verification failed', details: errorMsg }, 
          { status: 500, headers: corsHeaders }
        );
      }
    }
    
    // Get student grade + track from Speed Scores (for smart track defaults)
    if (url.pathname === '/api/get-student-grade' && req.method === 'POST') {
      try {
        const body = await req.json() as { timebackId: string };
        
        if (!body.timebackId) {
          return Response.json({ error: 'Missing timebackId' }, { status: 400 });
        }
        
        // Fetch grade + locked tracks using server credentials
        const { grade, lockedTracks, latestTrack, forceUnlock, forceLock } = await fetchSpeedScoreData(body.timebackId);

        const unlockStr = forceUnlock ? ` unlock=${forceUnlock.join(',')}` : '';
        const lockStr = forceLock ? ` lock=${forceLock.join(',')}` : '';
        console.log(`[API] grade timeback:${body.timebackId.slice(0,8)} grade:${grade ?? 'null'} locked:${lockedTracks.length}${unlockStr}${lockStr} latest:${latestTrack ?? 'null'}`);
        return Response.json({ grade, lockedTracks, latestTrack }, { headers: corsHeaders });
        
      } catch (error) {
        console.error('[API] ✗ grade fetch failed:', error instanceof Error ? error.message : error);
        return Response.json({ 
          error: 'Failed to fetch grade',
          details: error instanceof Error ? error.message : String(error)
        }, { status: 500, headers: corsHeaders });
      }
    }
    
    // Get speed scores for multiple students (for academic dashboard)
    if (url.pathname === '/api/get-speed-scores' && req.method === 'POST') {
      try {
        const body = await req.json() as { emails: string[] };
        
        if (!body.emails || !Array.isArray(body.emails)) {
          return Response.json({ error: 'Missing emails array' }, { status: 400, headers: corsHeaders });
        }
        
        const results: Record<string, Array<{ date: string; grade: number; track: string; cqpm: number }>> = {};
        
        // Process emails in parallel (but limit concurrency)
        await Promise.all(body.emails.map(async (email) => {
          try {
            // Look up user by email
            const user = await findTimebackUserByEmail(email);
            if (!user) {
              results[email] = [];
              return;
            }
            
            // Fetch their speed scores
            const scores = await fetchRawSpeedScores(user.sourcedId);
            results[email] = scores;
          } catch {
            results[email] = [];
          }
        }));
        
        console.log(`[API] speed-scores emails:${body.emails.length} returned:${Object.values(results).reduce((sum, arr) => sum + arr.length, 0)}`);
        return Response.json(results, { headers: corsHeaders });
        
      } catch (error) {
        console.error('[API] ✗ speed-scores failed:', error instanceof Error ? error.message : error);
        return Response.json({ error: 'Failed to fetch speed scores' }, { status: 500, headers: corsHeaders });
      }
    }
    
    return new Response('Not found', { status: 404 });
  }
});

console.log(`[STARTUP] HTTP server port:${PORT}`);
console.log(`[STARTUP] Playcademy: ${playcademyBaseUrl}`);

// FastMath track → Math Raiders track mapping
// FastMath uses different track numbers than Math Raiders in some cases
const FASTMATH_TO_MR_TRACK: Record<string, string> = {
  'track13': 'TRACK12',  // K (Addition Within 10) - reuses TRACK12
  'track12': 'TRACK12',  // G1 (Addition Within 10)
  'track9': 'TRACK9',    // G2 (Addition 0-9)
  'track10': 'TRACK10',  // G2 (Subtraction from 20)
  'track11': 'TRACK11',  // G3 (Multiplication 0-9)
  'track6': 'TRACK6',    // G3, G5 (Addition to 20)
  'track8': 'TRACK8',    // G3, G5 (Subtraction to 20)
  'track7': 'TRACK7',    // G4, G5 (Multiplication 0-12)
  'track5': 'TRACK5',    // G4, G5 (Division 0-12)
};

// Per-student track overrides: force-unlock specific tracks that would normally be locked
// Use case: Student passed a track but teacher wants them to practice it anyway
// Format: { timebackId: [tracks to unlock] }
const FORCE_UNLOCK_TRACKS: Record<string, string[]> = {
  // harper.lembo@alpha.school - struggling with Sub, practice Add only per Janna 2026-01-27
  '0b9c0021-7a17-4ba8-b9cc-1fb7e94329a9': ['TRACK9'],  // Add 0-9
};

// Per-student track overrides: force-lock specific tracks that would normally be unlocked
// Use case: Teacher wants to restrict student to specific tracks
// Format: { timebackId: [tracks to lock] }
const FORCE_LOCK_TRACKS: Record<string, string[]> = {
  // harper.lembo@alpha.school - struggling with Sub, practice Add only per Janna 2026-01-27
  '0b9c0021-7a17-4ba8-b9cc-1fb7e94329a9': ['TRACK10'],  // Sub
};

// Track progression per grade (in order students should complete them)
// Used to determine which track to lock a student to
const GRADE_TRACK_PROGRESSION: Record<number, string[]> = {
  0: ['TRACK12'],                              // K: Addition Within 10 (reuses TRACK12)
  1: ['TRACK12'],                              // G1: Addition Within 10
  2: ['TRACK9', 'TRACK10'],                    // G2: Add 0-9 → Sub
  3: ['TRACK6', 'TRACK8', 'TRACK11'],          // G3: Add → Sub → Mul
  4: ['TRACK7', 'TRACK5'],                     // G4: Mul → Div
  5: ['TRACK6', 'TRACK8', 'TRACK7', 'TRACK5'], // G5: Add → Sub → Mul → Div at 40 CQPM
};

// CQPM target per grade (must reach this to "pass" a track)
function getGradeCQPMTarget(grade: number): number {
  if (grade === 0) return 20;
  if (grade >= 1 && grade <= 3) return 30;
  if (grade === 4) return 35;
  return 40;  // G5
}

interface StudentSpeedScoreData {
  grade: number | null;
  lockedTracks: string[];
  latestTrack: string | null;
  forceUnlock: string[] | null;  // Tracks force-unlocked via override
  forceLock: string[] | null;    // Tracks force-locked via override
}

// ─────────────────────────────────────────────────────────────────────────────
// TimeBack Assessment Fetching
// 
// Single source of truth for paginated assessment fetching. Both the dashboard
// (raw scores) and game (grade/locking) use this. Handles:
// - Pagination (students can have 6000+ assessments)
// - Token refresh on 401
// - Graceful degradation on network errors
// ─────────────────────────────────────────────────────────────────────────────

const TIMEBACK_GRADEBOOK_API = 'https://api.alpha-1edtech.ai/ims/oneroster/gradebook/v1p2';

interface AssessmentResult {
  metadata?: { grade?: number | string; cqpm?: number };
  assessmentLineItem?: { title?: string; sourcedId?: string };
  scoreDate?: string;
  dateLastModified?: string;
}

/**
 * Fetch all assessments for a student from TimeBack.
 * Handles pagination, auth retry, and network errors.
 */
async function fetchAllAssessments(timebackId: string): Promise<AssessmentResult[]> {
  const limit = 3000;
  let offset = 0;
  const allResults: AssessmentResult[] = [];

  const fetchPage = async (pageOffset: number) => {
    const url = `${TIMEBACK_GRADEBOOK_API}/assessmentResults?filter=student.sourcedId='${timebackId}'&limit=${limit}&offset=${pageOffset}`;
    const token = await tokenManager.getToken();
    return await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  };

  while (true) {
    let response: Response;
    try {
      response = await fetchPage(offset);
    } catch {
      break; // Network error - use what we have
    }

    // Retry once on 401 (token expired mid-flight)
    if (response.status === 401) {
      tokenManager.invalidate();
      try {
        response = await fetchPage(offset);
      } catch {
        break;
      }
    }

    if (!response.ok) break;

    let data: { assessmentResults?: AssessmentResult[] };
    try {
      data = await response.json() as typeof data;
    } catch {
      break;
    }

    const results = data.assessmentResults || [];
    allResults.push(...results);

    if (results.length < limit) break; // Last page
    offset += limit;
  }

  return allResults;
}

/**
 * Filter assessments to Speed Scores only (have cqpm + grade in metadata).
 */
function filterToSpeedScores(assessments: AssessmentResult[]): AssessmentResult[] {
  return assessments.filter(r => r.metadata?.cqpm !== undefined && r.metadata?.grade !== undefined);
}

/**
 * Fetch raw speed scores for academic dashboard.
 * Returns array of { date, grade, track, cqpm } sorted by date.
 */
async function fetchRawSpeedScores(timebackId: string): Promise<Array<{ date: string; grade: number; track: string; cqpm: number }>> {
  const assessments = await fetchAllAssessments(timebackId);
  const speedScores = filterToSpeedScores(assessments);

  return speedScores
    .map(r => {
      const trackSource = r.assessmentLineItem?.title || r.assessmentLineItem?.sourcedId || '';
      const trackMatch = trackSource.match(/track(\d+)/i);
      const rawTrack = trackMatch ? `track${trackMatch[1]}` : '';
      return {
        date: (r.scoreDate || r.dateLastModified || '').slice(0, 10),
        grade: typeof r.metadata!.grade === 'number' ? r.metadata!.grade : parseInt(String(r.metadata!.grade).replace(/\D/g, '')) || 0,
        track: FASTMATH_TO_MR_TRACK[rawTrack.toLowerCase()] || rawTrack.toUpperCase(),
        cqpm: Math.round((r.metadata!.cqpm as number) * 10) / 10,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Fetch student grade + locked tracks from TimeBack Speed Scores
// Returns knowledge grade and tracks that should be locked (already passed)
async function fetchSpeedScoreData(timebackId: string): Promise<StudentSpeedScoreData> {
  const empty: StudentSpeedScoreData = { grade: null, lockedTracks: [], latestTrack: null, forceUnlock: null, forceLock: null };

  const allResults = await fetchAllAssessments(timebackId);
  const speedScores = filterToSpeedScores(allResults);

  if (speedScores.length === 0) return empty;

  // Sort by date descending (client-side backup in case server sort fails)
  speedScores.sort((a, b) => {
    const dateA = new Date(a.scoreDate || a.dateLastModified || 0).getTime();
    const dateB = new Date(b.scoreDate || b.dateLastModified || 0).getTime();
    return dateB - dateA;
  });

  const latest = speedScores[0];
  const latestTrack = extractMRTrack(
    latest.assessmentLineItem?.title,
    latest.assessmentLineItem?.sourcedId
  );

  // Extract grade from latest assessment (knowledge grade from metadata)
  // Handles: 5, "5", "G5", "K", "KG"
  const grade = parseKnowledgeGrade(latest.metadata?.grade);

  // If we don't know the grade, unlock all (can't determine progression)
  if (grade === null) {
    return { grade, lockedTracks: [], latestTrack, forceUnlock: null, forceLock: null };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRACK LOCKING LOGIC
  // 
  // Goal: Determine which tracks should be LOCKED (disabled) in Math Raiders.
  // lockedTracks = tracks the student has passed and shouldn't farm XP from.
  // 
  // Priority order:
  // 1. All passed → graduated, lock nothing (empty array)
  // 2. G5 special case → lock only passed tracks (can play any unpassed)
  // 3. Other grades → lock everything except first unpassed in progression
  // ─────────────────────────────────────────────────────────────────────────

  const target = getGradeCQPMTarget(grade);
  const progression = GRADE_TRACK_PROGRESSION[grade] ?? [];

  // ─────────────────────────────────────────────────────────────────────────
  // RESET DETECTION
  // 
  // If a student was reset (grade went DOWN at any point), only use scores
  // from AFTER the last reset. This handles:
  // - Students who were promoted too early and reset by guides
  // - Parent play that caused false graduation, then student was reset
  // ─────────────────────────────────────────────────────────────────────────
  const resetDate = detectLastReset(speedScores);
  const relevantScores = resetDate
    ? speedScores.filter(s => new Date(s.scoreDate || s.dateLastModified || 0) >= resetDate)
    : speedScores;

  // Build map: track → max CQPM achieved (handles retakes)
  const trackMaxCqpm = buildTrackMaxCqpmMap(relevantScores);

  // Determine which tracks to lock
  let lockedTracks = determineLockedTracks(grade, trackMaxCqpm, target, progression);

  // Apply per-student overrides (teacher requests)
  const forceUnlock = FORCE_UNLOCK_TRACKS[timebackId] ?? null;
  const forceLock = FORCE_LOCK_TRACKS[timebackId] ?? null;
  if (forceUnlock) {
    lockedTracks = lockedTracks.filter(t => !forceUnlock.includes(t));
  }
  if (forceLock) {
    lockedTracks = [...new Set([...lockedTracks, ...forceLock])];
  }

  return { grade, lockedTracks, latestTrack, forceUnlock, forceLock };
}

/**
 * Parse knowledge grade from assessment metadata.
 * Handles: 5, "5", "G5", "K", "KG" → numeric grade (0-5) or null
 */
function parseKnowledgeGrade(rawGrade: string | number | undefined): number | null {
  if (rawGrade === undefined || rawGrade === null) return null;
  
  const s = String(rawGrade).toUpperCase().trim();
  
  // Handle K/KG → 0
  if (s === 'K' || s === 'KG') return 0;
  
  // Handle "G5" or "5" → 5
  const match = s.match(/^G?(\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 0 && num <= 5) return num;
  }
  
  return null;
}

/**
 * Detect if student was ever reset (grade decreased) in their assessment history.
 * Returns the date of the last reset, or null if never reset.
 * 
 * A reset is when a student goes from a higher grade to a lower grade, indicating
 * a guide manually moved them back (e.g., promoted too early, parent play detected).
 */
function detectLastReset(
  speedScores: Array<{ metadata?: { grade?: unknown }; scoreDate?: string; dateLastModified?: string }>
): Date | null {
  // Sort chronologically (oldest first) to walk the grade journey
  const chronological = [...speedScores].sort((a, b) => {
    const dateA = new Date(a.scoreDate || a.dateLastModified || 0).getTime();
    const dateB = new Date(b.scoreDate || b.dateLastModified || 0).getTime();
    return dateA - dateB;
  });

  let previousGrade = -1;
  let lastResetDate: Date | null = null;

  for (const score of chronological) {
    const grade = parseKnowledgeGrade(score.metadata?.grade as string | number | undefined);
    if (grade === null) continue;

    // Compare to PREVIOUS grade, not max. G4→G2→G3 should only flag G4→G2 as reset,
    // not G2→G3 (which is progression, not reset).
    if (previousGrade >= 0 && grade < previousGrade) {
      lastResetDate = new Date(score.scoreDate || score.dateLastModified || 0);
    }
    previousGrade = grade;
  }

  return lastResetDate;
}

/**
 * Extract Math Raiders track ID from FastMath assessment.
 * Tries title first, falls back to sourcedId (title can be empty).
 * e.g., "fastmath-track8-l2-assessment" → "TRACK8"
 */
function extractMRTrack(title: string | undefined, sourcedId: string | undefined): string | null {
  // Try title first, then sourcedId
  for (const source of [title, sourcedId]) {
    if (!source) continue;
    const match = source.match(/track(\d+)/i);
    if (match) {
      const fastmathTrack = `track${match[1]}`;
      return FASTMATH_TO_MR_TRACK[fastmathTrack] || null;
    }
  }
  return null;
}

/**
 * Build a map of track → max CQPM achieved across all assessments.
 * Handles students who took the same track multiple times.
 */
function buildTrackMaxCqpmMap(
  speedScores: Array<{
    metadata?: { cqpm?: number };
    assessmentLineItem?: { title?: string; sourcedId?: string };
  }>
): Record<string, number> {
  const trackMaxCqpm: Record<string, number> = {};
  
  for (const score of speedScores) {
    const mrTrack = extractMRTrack(
      score.assessmentLineItem?.title,
      score.assessmentLineItem?.sourcedId
    );
    if (!mrTrack) continue;
    
    const cqpm = score.metadata?.cqpm ?? 0;
    trackMaxCqpm[mrTrack] = Math.max(trackMaxCqpm[mrTrack] ?? 0, cqpm);
  }
  
  return trackMaxCqpm;
}

/**
 * Determine which tracks should be LOCKED (disabled in UI).
 * 
 * Philosophy: Lock only PASSED tracks (prevent XP farming on mastered content).
 * Students can freely play any unpassed track in their grade.
 * 
 * Priority:
 * 1. All passed → graduated, return [] (nothing locked, can replay any)
 * 2. Otherwise → lock only passed tracks (can play any unpassed)
 */
function determineLockedTracks(
  _grade: number,
  trackMaxCqpm: Record<string, number>,
  target: number,
  progression: string[]
): string[] {
  const passed = progression.filter(t => (trackMaxCqpm[t] ?? 0) >= target);
  const unpassed = progression.filter(t => (trackMaxCqpm[t] ?? 0) < target);

  // All passed → graduated, nothing locked (can replay any track)
  if (unpassed.length === 0) {
    return [];
  }

  // Lock only passed tracks (can play any unpassed)
  return passed;
}

// Build shared actor (TimebackUser) - reused by both events
function buildActor(eventData: EventPayload) {
  return {
    id: `https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/users/${eventData.timebackId}`,
    type: "TimebackUser",
    email: eventData.email
  };
}

// Build shared activity context - reused by both events
function buildActivityContext(eventData: EventPayload, grade: number) {
  return {
    id: `https://api.alpha-1edtech.ai/ims/activity/context/${crypto.randomUUID()}/${Date.now()}`,
    type: "TimebackActivityContext",
    subject: "FastMath",
    app: { name: "Math Raiders" },
    activity: { name: "Math Raid" },
    course: {
      id: `https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/courses/math-raiders-grade-${grade}`,
      name: `Math Raiders Grade ${grade}`
    },
    process: eventData.process ?? true
  };
}

// Transform SpacetimeDB event to Caliper format
// Returns envelope with BOTH TimebackActivityEvent and TimebackTimeSpentEvent
function createCaliperEvent(dbEvent: TimebackEventQueue): CaliperEnvelope {
  const eventData: EventPayload = JSON.parse(dbEvent.payload);
  const grade = eventData.grade;
  
  // Shared building blocks (Nystrom: composition, not duplication)
  const actor = buildActor(eventData);
  const object = buildActivityContext(eventData, grade);
  
  // Event 1: TimebackActivityEvent - what they accomplished
  const activityEvent = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: "ActivityEvent",
    action: "Completed",
    eventTime: eventData.raidEndTime,
    profile: "TimebackProfile",
    actor,
    object,
    generated: {
      id: `https://playcademy.org/metrics/raids/${dbEvent.id}/activity`,
      type: "TimebackActivityMetricsCollection",
      attempt: eventData.attempt ?? 1,
      items: [
        { type: "xpEarned", value: eventData.xpEarned },
        { type: "totalQuestions", value: eventData.totalQuestions },
        { type: "correctQuestions", value: eventData.correctQuestions },
        ...(eventData.masteredUnits !== undefined ? [{ type: "masteredUnits", value: eventData.masteredUnits }] : [])
      ]
    }
  };
  
  // Event 2: TimebackTimeSpentEvent - how long they spent
  const timeSpentEvent = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: "TimeSpentEvent",
    action: "SpentTime",
    eventTime: eventData.raidEndTime,
    profile: "TimebackProfile",
    actor,
    object,
    generated: {
      id: `https://playcademy.org/metrics/raids/${dbEvent.id}/time`,
      type: "TimebackTimeSpentMetricsCollection",
      items: [
        { type: "active", value: Math.round(eventData.raidDurationMinutes * 60) }  // API expects seconds
      ]
    }
  };

  // Wrap both events in single Caliper envelope (one API call)
  return {
    sensor: "https://mathraiders.com",
    sendTime: new Date().toISOString(),
    dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p2",
    data: [activityEvent, timeSpentEvent]
  };
}

// Send event to TimeBack
async function sendToTimeBack(ctx: EventContext | ReducerEventContext, dbEvent: TimebackEventQueue) {
  // Worker respects retry limit (DB enforces as safety net)
  if (dbEvent.attempts >= MAX_RETRIES) {
    console.log(`[TIMEBACK] skip event:${dbEvent.id} reason:max_retries`);
    return;
  }
  
  const eventData: EventPayload = JSON.parse(dbEvent.payload);

  // Check if next retry time hasn't arrived yet
  if (dbEvent.nextRetryAt) {
    const nextRetry = dbEvent.nextRetryAt.toDate();
    if (nextRetry > new Date()) {
      // Not ready for retry - silent wait
      return;
    }
  }

  const startTime = Date.now();
  
  try {
    const envelope = createCaliperEvent(dbEvent);
    const accessToken = await tokenManager.getToken();
    
    const response = await fetch(config.timeback.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(envelope)
    });
    
    const durationMs = Date.now() - startTime;
    
    if (response.ok) {
      const responseText = await response.text();
      // Canonical log: one line with high-cardinality fields + duration
      console.log(`[TIMEBACK] ✓ event:${dbEvent.id} user:${eventData.timebackId.slice(0,8)} xp:${eventData.xpEarned} (${durationMs}ms)`);
      
      // Only log response if there's an error in it
      if (responseText) {
        try {
          const responseData = JSON.parse(responseText);
          if (responseData.status === 'error' || responseData.errors) {
            console.log(`[TIMEBACK] ⚠ API returned error:`, responseData.errors || responseData.message);
          }
        } catch {
          // Non-JSON response, ignore unless debugging
        }
      }
      
      await ctx.reducers.markEventSent({ eventId: dbEvent.id, error: undefined });
    } else if (response.status === 401) {
      // Token expired - will refresh and retry
      tokenManager.invalidate();
      return sendToTimeBack(ctx, dbEvent); // Retry immediately
    } else {
      const text = await response.text();
      const error = `HTTP ${response.status}: ${text.slice(0,100)}`;
      // Canonical failure log with duration
      console.error(`[TIMEBACK] ✗ event:${dbEvent.id} user:${eventData.timebackId.slice(0,8)} error:${response.status} (${durationMs}ms)`);
      await ctx.reducers.markEventSent({ eventId: dbEvent.id, error });
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Canonical exception log with duration
    console.error(`[TIMEBACK] ✗ event:${dbEvent.id} user:${eventData.timebackId.slice(0,8)} exception:${errorMessage.slice(0,50)} (${durationMs}ms)`);
    await ctx.reducers.markEventSent({ eventId: dbEvent.id, error: errorMessage });
  }
}

// Process a single event
async function processEvent(ctx: EventContext | ReducerEventContext, event: TimebackEventQueue) {
  if (processingEvents.has(event.id)) {
    return; // Already processing
  }
  
  processingEvents.add(event.id);
  try {
    await sendToTimeBack(ctx, event);
  } finally {
    processingEvents.delete(event.id);
  }
}

// Main worker loop
async function startWorker() {
  console.log('[STARTUP] worker connecting to:', config.spacetimedb.uri);
  
  const db = await DbConnection.builder()
    .withUri(config.spacetimedb.uri)
    .withModuleName(config.spacetimedb.module)
    .withToken(config.spacetimedb.token) // Connect as module owner to access private tables
    .onConnect((ctx, identity, token) => {
      try {
        console.log('[STARTUP] connected identity:', identity.toHexString().slice(0, 16));
        
        // Store connection for /verify endpoint
        stdbConnection = ctx;
        
        // Subscription creation - only log result
        
        // Subscribe to unsent events
        ctx.subscriptionBuilder()
        .onError((error) => {
          console.error('❌ Subscription error:', error);
        })
        .onApplied((subCtx) => {
          // Subscription ready - check for backlog
          
          // Process any existing unsent events
          let eventCount = 0;
          const events: TimebackEventQueue[] = Array.from(subCtx.db.timebackEventQueue.iter());
          for (const event of events) {
            if (!event.sent && event.attempts < MAX_RETRIES) {
              eventCount++;
              processEvent(subCtx as unknown as EventContext, event);
            }
          }
          
          if (eventCount > 0) {
            console.log('[STARTUP] backlog:', eventCount, 'events');
          } else {
            console.log('[STARTUP] ready, no backlog');
          }
          
          // Handle new events as they arrive
          subCtx.db.timebackEventQueue.onInsert((eventCtx, event: TimebackEventQueue) => {
            try {
              if (!event.sent && event.attempts < MAX_RETRIES && !processingEvents.has(event.id)) {
                // New event - will log [TIMEBACK] when processed
                processEvent(eventCtx, event);
              }
            } catch (e) {
              console.error('❌ Error in onInsert:', e);
            }
          });
          
          // Handle retries when events are updated
          subCtx.db.timebackEventQueue.onUpdate((eventCtx, oldEvent: TimebackEventQueue, newEvent: TimebackEventQueue) => {
            try {
              // If an event was marked for retry and is now ready
              if (!newEvent.sent && newEvent.attempts < MAX_RETRIES && !processingEvents.has(newEvent.id)) {
                processEvent(eventCtx, newEvent);
              }
            } catch (e) {
              console.error('❌ Error in onUpdate:', e);
            }
          });
          
          // Poll for retry-ready events (nextRetryAt has passed)
          // Subscriptions are event-driven; this timer catches events after backoff expires
          setInterval(() => {
            const now = new Date();
            for (const event of subCtx.db.timebackEventQueue.iter()) {
              if (event.sent) continue;
              if (event.attempts >= MAX_RETRIES) continue;
              if (processingEvents.has(event.id)) continue;
              
              const retryAt = event.nextRetryAt?.toDate();
              if (retryAt && retryAt > now) continue;
              
              processEvent(subCtx as unknown as EventContext, event);
            }
          }, config.pollInterval);
        })
        .subscribe('SELECT * FROM timeback_event_queue WHERE sent = false');
        
        // Subscription created - startup complete
      } catch (error) {
        console.error('[FATAL] onConnect:', error instanceof Error ? error.message : error);
        throw error; // Re-throw so it disconnects
      }
    })
    .onConnectError((ctx, error) => {
      console.error('[ERROR] connection failed:', error);
    })
    .onDisconnect((ctx, error) => {
      console.error('[ERROR] disconnected, reconnecting in', RECONNECT_DELAY_MS / 1000, 's');
      processingEvents.clear(); // Clear tracking on disconnect
      stdbConnection = null; // Clear connection for /verify endpoint
      setTimeout(() => startWorker(), RECONNECT_DELAY_MS);
    })
    .build();
  
  // Keep the process alive
  // Worker running - startup logs complete
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[SHUTDOWN] worker stopping');
  process.exit(0);
});

// Start the worker
startWorker().catch((error: unknown) => {
  console.error('[FATAL]', error instanceof Error ? error.message : error);
  process.exit(1);
});
