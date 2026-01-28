import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { PlayerRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type Player = Infer<typeof PlayerRow>;

// ==================== CONSTANTS ====================
// CQPM = Correct Questions Per Minute (speed metric)

const NEW_PLAYER_DEFAULT_CQPM = 10.0;   // Generous default for first-time players
const MIN_SESSION_SECONDS = 30;          // Sessions under 30s don't count for best CQPM
const FLOOR_PERCENTAGE = 0.25;           // Floor = 25% of your best (easy to hit)
const MIN_FLOOR_CQPM = 2.0;              // Absolute minimum floor (2 correct/min)
const AFK_THRESHOLD = 0.3;               // Below 30% of floor = AFK, no XP
const MAX_XP_PER_RAID = 2.5;             // Cap XP at 2.5 minutes per raid
const ACCURACY_THRESHOLD = 80;           // Must get 80%+ correct for any XP

// ==================== HELPERS ====================

/** Get best CQPM for track from map, defaulting for new players */
function getBestCqpm(map: Map<string | undefined, number>, track: string | undefined): number {
  const best = map.get(track) ?? 0;
  return best < 1.0 ? NEW_PLAYER_DEFAULT_CQPM : best;
}

/** Update running best CQPM map with a snapshot (mutates map) */
function updateBestCqpm(
  map: Map<string | undefined, number>,
  s: { track?: string; sessionSeconds: number; problemsCorrect: number }
): void {
  if (s.sessionSeconds <= MIN_SESSION_SECONDS) return;
  const cqpm = (s.problemsCorrect / s.sessionSeconds) * 60;
  const current = map.get(s.track) ?? 0;
  if (cqpm > current) map.set(s.track, cqpm);
}

/**
 * Calculate engagement multiplier (0.0 to 1.0).
 * 
 * How it works:
 * - Your "floor" = 25% of your best speed on this track (minimum 2 CQPM)
 * - If you hit 100%+ of floor → full XP (1.0)
 * - If you hit 30-99% of floor → proportional XP
 * - If you hit <30% of floor → you're AFK, no XP (0.0)
 */
function calculateEngagement(sessionCqpm: number, playerBestCqpm: number): number {
  const floor = Math.max(MIN_FLOOR_CQPM, playerBestCqpm * FLOOR_PERCENTAGE);
  const rawEngagement = sessionCqpm / floor;
  
  if (rawEngagement < AFK_THRESHOLD) {
    return 0.0;  // AFK gets nothing
  }
  return Math.min(1.0, rawEngagement);
}

// ==================== MAIN HOOK ====================

/**
 * Calculate today's TimeBack XP from performance history.
 * 
 * How XP works:
 * 1. You need 80%+ accuracy to earn any XP
 * 2. XP = raid duration (capped at 2.5 min) × engagement multiplier
 * 3. Engagement is based on how fast you were vs your personal best
 * 4. If you're barely trying (<30% of your floor), you get nothing
 * 
 * Why process chronologically:
 * - Each raid's XP depends on your best speed BEFORE that raid
 * - If raid 1 sets a new record, raid 2 uses that higher baseline
 * - This exactly matches how the server calculates XP in real-time
 */
export function useTodayXP(player: Player | null) {
  const performanceHistory = useGameStore(state => state.performanceHistory);
  
  return useMemo(() => {
    if (!player) return { xp: 0, raids: 0 };
    
    // Step 1: Get this player's raids, sorted oldest → newest
    const playerSnapshots = performanceHistory
      .filter(s => s.playerId === player.id)
      .sort((a, b) => a.timestamp.toDate().getTime() - b.timestamp.toDate().getTime());
    
    // Step 2: Determine "today" in student's local timezone
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    // Step 3: Walk through history chronologically
    // - Track running best CQPM per track
    // - Calculate XP for today's raids using best BEFORE each raid
    const bestCqpmMap = new Map<string | undefined, number>();
    let totalXP = 0;
    let todayRaids = 0;
    
    for (const snapshot of playerSnapshots) {
      const isToday = snapshot.timestamp.toDate() >= todayStart;
      
      if (isToday) {
        // Calculate XP for this raid (using best BEFORE it)
        if (snapshot.sessionSeconds > 0 && snapshot.problemsAttempted > 0) {
          const durationMinutes = snapshot.sessionSeconds / 60;
          const sessionCqpm = (snapshot.problemsCorrect / snapshot.sessionSeconds) * 60;
      const accuracy = (snapshot.problemsCorrect / snapshot.problemsAttempted) * 100;
      
          const bestCqpm = getBestCqpm(bestCqpmMap, snapshot.track);
          const engagement = calculateEngagement(sessionCqpm, bestCqpm);
          
          if (accuracy >= ACCURACY_THRESHOLD && engagement > 0) {
            totalXP += Math.min(durationMinutes, MAX_XP_PER_RAID) * engagement;
          }
        }
        todayRaids++;
      }
      
      // Update running best AFTER calculating (so this raid doesn't count for itself)
      updateBestCqpm(bestCqpmMap, snapshot);
    }
    
    return { xp: totalXP, raids: todayRaids };
  }, [player, performanceHistory]);
}
