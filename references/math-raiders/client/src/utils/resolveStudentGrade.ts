/**
 * Resolve student's grade level from AlphaNumbers (formerly AlphaMath Fluency) enrollment
 * 
 * Source of truth: AlphaNumbers enrollment (teacher-assigned, fluency-specific)
 * Fallback: undefined (server uses existing DB grade or defaults to 3 for new students)
 * 
 * Why no PowerPath fallback: PowerPath measures general math placement, not fluency.
 * Mixing data sources creates inconsistency. Better to fail explicitly than use wrong data.
 */

interface PlaycademyUser {
  id: string;
  username?: string | null;
  email?: string | null;
  grade?: number; // Will be available in future
  [key: string]: any;
}

// Worker endpoint URLs (OAuth fix - credentials stay server-side)
const WORKER_URL = import.meta.env.DEV 
  ? 'http://localhost:3001'  // Local: direct to worker
  : 'https://lip-jets-approx-pig.trycloudflare.com';  // Prod: through tunnel/nginx

interface WorkerGradeResponse {
  grade: number | null;
  lockedTracks: string[];
  latestTrack: string | null;
}

/**
 * Fetch grade + locked tracks from worker API (secure - credentials on server)
 */
async function fetchGradeViaWorker(timebackId: string): Promise<WorkerGradeResponse> {
  try {
    const response = await fetch(`${WORKER_URL}/api/get-student-grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timebackId }),
      signal: AbortSignal.timeout(3000)  // 3s timeout
    });
    
    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}`);
    }
    
    const data = await response.json() as WorkerGradeResponse;
    
    if (import.meta.env.DEV) {
      console.log(`[Grade] Worker returned: grade=${data.grade}, locked=${data.lockedTracks.length}, latest=${data.latestTrack ?? 'null'}`);
    }
    
    return data;
  } catch (error) {
    console.warn('[Grade] Worker fetch failed:', error);
    return { grade: null, lockedTracks: [], latestTrack: null };
  }
}

// localStorage keys for TimeBack-synced state (not manual selection)
const LOCKED_TRACKS_KEY = 'timeback-locked-tracks';
const TIMEBACK_TRACK_KEY = 'timeback-latest-track';

/**
 * Resolve student's grade level from AlphaMath Fluency enrollment
 * Also stores their locked tracks for preventing XP farming
 * 
 * @param playcademyUser - User object from Playcademy SDK
 * @param timebackId - Student's TimeBack ID (if available)
 * @returns Grade level (0-5 for K-5) or undefined if API unavailable
 */
export async function resolveStudentGrade(
  playcademyUser: PlaycademyUser,
  timebackId?: string
): Promise<number | undefined> {
  // Priority 1: Playcademy user.grade (future)
  if (playcademyUser.grade !== undefined && playcademyUser.grade !== null) {
    if (import.meta.env.DEV) {
      console.log(`[Grade] Using Playcademy grade: ${playcademyUser.grade}`);
    }
    return playcademyUser.grade;
  }

  // Priority 2: Fetch from AlphaNumbers enrollment (single source of truth)
  if (timebackId) {
    const { grade, lockedTracks, latestTrack } = await fetchGradeViaWorker(timebackId);
    
    // Only update cache on successful fetch (grade !== null)
    // On failure, keep last known locks (fail-closed, not fail-open)
    if (grade !== null) {
      localStorage.setItem(LOCKED_TRACKS_KEY, JSON.stringify(lockedTracks));
      if (latestTrack) {
        localStorage.setItem(TIMEBACK_TRACK_KEY, latestTrack);
      }
      return grade;
    }
    // Fetch failed - keep cached locks, fall through to undefined grade
  }

  // No API source available - return undefined
  // Server will use existing DB grade (safe for returning students) or default to 3 (for new students)
  if (import.meta.env.DEV) {
    console.log(`[Grade] AlphaNumbers unavailable - server will use DB grade or default`);
  }
  return undefined;
}

/**
 * Get the locked tracks (tracks student has passed and shouldn't play)
 * Returns empty array if no TimeBack data or graduated (nothing locked)
 */
export function getLockedTracks(): string[] {
  const stored = localStorage.getItem(LOCKED_TRACKS_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Get the latest TimeBack track (for smart default selection)
 * Returns null if no TimeBack data
 */
export function getTimebackTrack(): string | null {
  return localStorage.getItem(TIMEBACK_TRACK_KEY);
}
