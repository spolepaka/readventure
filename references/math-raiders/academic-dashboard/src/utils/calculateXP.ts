/**
 * XP Calculation for Math Raiders
 * 
 * Replicates server-side XP logic for dashboard display.
 * Must walk through snapshots chronologically because each raid's XP
 * depends on the player's best CQPM *before* that raid.
 * 
 * XP Formula:
 *   XP = min(duration, 2.5 min) × engagement
 * 
 * Where:
 *   - Accuracy must be ≥80% (otherwise 0 XP)
 *   - Engagement = sessionCQPM / floor (capped at 1.0)
 *   - Floor = max(2.0, 25% of player's best CQPM on this track)
 *   - If engagement < 0.3 (AFK detection), XP = 0
 * 
 * Why chronological order matters:
 *   If a player improves from 10 CQPM to 20 CQPM, their floor increases.
 *   Early raids should use the lower floor that existed at that time,
 *   not the final higher floor. This matches real-time server calculation.
 * 
 * @see server/src/lib.rs - calculate_engagement()
 * @see client/src/hooks/useTodayXP.ts - original client implementation
 */

// ============================================================================
// CONSTANTS (must match server/src/lib.rs)
// ============================================================================

const NEW_PLAYER_DEFAULT_CQPM = 10.0;  // Generous default for first-time players
const MIN_SESSION_SECONDS = 30;         // Sessions under 30s don't count for best CQPM
const FLOOR_PERCENTAGE = 0.25;          // Floor = 25% of your best
const MIN_FLOOR_CQPM = 2.0;             // Absolute minimum floor
const AFK_THRESHOLD = 0.3;              // Below 30% of floor = AFK, no XP
const MAX_XP_PER_RAID = 2.5;            // Cap XP at 2.5 minutes per raid
const ACCURACY_THRESHOLD = 80;          // Must get 80%+ correct for any XP

// ============================================================================
// TYPES
// ============================================================================

export interface Snapshot {
  playerId: string;
  track?: string;
  sessionSeconds: number;
  problemsCorrect: number;
  problemsAttempted: number;
  timestamp: number;  // Unix ms
}

export interface XPResult {
  totalXP: number;
  totalMinutes: number;
  efficiency: number;  // XP / Minutes (0.0 to 1.0)
  raidCount: number;
}

// ============================================================================
// CORE LOGIC
// ============================================================================

/**
 * Calculate engagement multiplier for a single raid.
 * 
 * How it works:
 * - Floor = 25% of your best speed on this track (minimum 2 CQPM)
 * - If you hit 100%+ of floor → full credit (1.0)
 * - If you hit 30-99% of floor → proportional credit
 * - If you hit <30% of floor → you're AFK, no credit (0.0)
 */
function calculateEngagement(sessionCqpm: number, playerBestCqpm: number): number {
  const floor = Math.max(MIN_FLOOR_CQPM, playerBestCqpm * FLOOR_PERCENTAGE);
  const rawEngagement = sessionCqpm / floor;
  
  if (rawEngagement < AFK_THRESHOLD) {
    return 0.0;  // AFK gets nothing
  }
  return Math.min(1.0, rawEngagement);
}

/**
 * Get best CQPM for a track, with sensible default for new players.
 */
function getBestCqpm(bestMap: Map<string | undefined, number>, track: string | undefined): number {
  const best = bestMap.get(track) ?? 0;
  return best < 1.0 ? NEW_PLAYER_DEFAULT_CQPM : best;
}

/**
 * Update running best CQPM for a track (mutates map).
 * Only counts sessions over 30 seconds to avoid noisy data.
 */
function updateBestCqpm(
  bestMap: Map<string | undefined, number>,
  snapshot: Snapshot
): void {
  if (snapshot.sessionSeconds < MIN_SESSION_SECONDS) return;
  
  const cqpm = (snapshot.problemsCorrect / snapshot.sessionSeconds) * 60;
  const current = bestMap.get(snapshot.track) ?? 0;
  
  if (cqpm > current) {
    bestMap.set(snapshot.track, cqpm);
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Calculate total XP for a player from their snapshots.
 * 
 * Walks through snapshots chronologically, maintaining running best CQPM
 * per track. This exactly matches how the server calculates XP in real-time.
 * 
 * @param snapshots - Player's snapshots (will be sorted internally)
 * @returns XP totals and efficiency metrics
 */
export function calculatePlayerXP(snapshots: Snapshot[]): XPResult {
  if (snapshots.length === 0) {
    return { totalXP: 0, totalMinutes: 0, efficiency: 0, raidCount: 0 };
  }
  
  // Sort oldest → newest (required for correct floor calculation)
  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
  
  // Running state
  const bestCqpmByTrack = new Map<string | undefined, number>();
  let totalXP = 0;
  let totalMinutes = 0;
  
  for (const snapshot of sorted) {
    const durationMinutes = snapshot.sessionSeconds / 60;
    totalMinutes += durationMinutes;
    
    // Skip invalid sessions
    if (snapshot.sessionSeconds <= 0 || snapshot.problemsAttempted <= 0) {
      updateBestCqpm(bestCqpmByTrack, snapshot);
      continue;
    }
    
    // Calculate metrics for this raid
    const accuracy = (snapshot.problemsCorrect / snapshot.problemsAttempted) * 100;
    const sessionCqpm = (snapshot.problemsCorrect / snapshot.sessionSeconds) * 60;
    const bestCqpm = getBestCqpm(bestCqpmByTrack, snapshot.track);
    const engagement = calculateEngagement(sessionCqpm, bestCqpm);
    
    // XP = capped duration × engagement (if accuracy threshold met)
    if (accuracy >= ACCURACY_THRESHOLD && engagement > 0) {
      totalXP += Math.min(durationMinutes, MAX_XP_PER_RAID) * engagement;
    }
    
    // Update running best AFTER calculating (so this raid doesn't affect itself)
    updateBestCqpm(bestCqpmByTrack, snapshot);
  }
  
  const efficiency = totalMinutes > 0 ? totalXP / totalMinutes : 0;
  
  return {
    totalXP,
    totalMinutes,
    efficiency,
    raidCount: sorted.length,
  };
}
