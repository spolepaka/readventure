import { useMemo } from 'react';
import { getGradeGoalBoss, WINS_FOR_TRACK_MASTER } from '../utils/gradeThresholds';

interface PlayerLike {
  grade?: number;
}

interface RaidPlayerLike {
  grade?: number;
  track?: string | null;
  isLeader?: boolean;
}

// Minimal interface for performance history - avoids SpacetimeDB type import complexity
interface PerformanceRecord {
  grade: number;
  track?: string | null;
  raidType?: string | null;
  bossLevel: number;
  victory?: boolean | null;
}

/**
 * Calculate which bosses are unlocked for the boss selector.
 * 
 * ADAPTIVE RAIDS (Quick Play):
 * - Uses current player's grade
 * - Shows bosses they've beaten (cosmetic choice)
 * - No track filter
 * 
 * FIXED RAIDS (Mastery Trials):
 * - Uses leader's grade + track
 * - Shows bosses leader has beaten + next challenge
 * - Track-specific (prevents carrying across tracks)
 * - TRACK MASTER GATE: Goal boss requires 3× wins to unlock challenge content beyond
 */
export function useUnlockedBosses(
  isAdaptive: boolean,
  currentPlayer: PlayerLike | null,
  leaderRaidPlayer: RaidPlayerLike | undefined,
  perfHistory: PerformanceRecord[]
): Record<number, boolean> {
  return useMemo(() => {
    const unlocks: Record<number, boolean> = { 0: true, 1: true }; // Clank + Gloop always available
    
    if (isAdaptive) {
      // Adaptive: use current player's grade, show beaten bosses only
      const grade = currentPlayer?.grade ?? 0;
      const soloRaids = perfHistory.filter(p =>
        p.grade === grade &&
        p.raidType === 'solo' &&
        p.bossLevel >= 1 && p.bossLevel <= 8
      );
      for (let tier = 1; tier <= 8; tier++) {
        if (soloRaids.some(p => p.bossLevel === tier && p.victory === true)) {
          unlocks[tier] = true;
        }
      }
      // Captain Nova (7) always free in Quick Play
      unlocks[7] = true;
      // Void Emperor (8) always free in Quick Play
      unlocks[8] = true;
    } else {
      // Fixed (Mastery Trials): use leader's grade + track, show beaten + next
      const leaderGrade = leaderRaidPlayer?.grade ?? currentPlayer?.grade ?? 0;
      const leaderTrack = leaderRaidPlayer?.track ?? null;
      const goalBoss = getGradeGoalBoss(leaderGrade);
      // ALL track raids may have track as 'ALL' or undefined/null (legacy snapshots)
      const isAllTrack = leaderTrack === 'ALL' || leaderTrack == null;
      const matchesTrack = (pTrack: string | null | undefined) =>
        isAllTrack ? (pTrack === 'ALL' || !pTrack) : pTrack === leaderTrack;
      const soloRaids = perfHistory.filter(p =>
        p.grade === leaderGrade &&
        matchesTrack(p.track) &&
        p.raidType === 'solo' &&
        p.bossLevel >= 1 && p.bossLevel <= 8
      );
      // TRACK MASTER GATE
      // Each grade has a "goal boss" that proves grade-level fluency (e.g., K → Boss 4).
      // Students must beat their goal boss 3× solo to unlock challenge content beyond.
      // This prevents over-leveling: you can't skip ahead until you've mastered your level.
      //
      // - Pre-goal bosses: 1 win unlocks next
      // - Goal boss: 3× wins unlocks next (Track Master certification)
      // - Post-goal bosses: 1 win unlocks next (optional challenge content)
      for (let tier = 1; tier <= 8; tier++) {
        const winsOnThisBoss = soloRaids.filter(p => p.bossLevel === tier && p.victory === true).length;
        if (winsOnThisBoss === 0) continue; // No wins on this boss
        
        unlocks[tier] = true; // Boss is unlocked (we have wins on it)
        
        if (tier < 8) {
          const isGoalBoss = tier === goalBoss;
          const winsNeededToUnlockNext = isGoalBoss ? WINS_FOR_TRACK_MASTER : 1;
          
          if (winsOnThisBoss >= winsNeededToUnlockNext) {
            unlocks[tier + 1] = true;
          }
        }
      }
    }
    return unlocks;
  }, [isAdaptive, currentPlayer?.grade, leaderRaidPlayer?.grade, leaderRaidPlayer?.track, perfHistory]);
}
