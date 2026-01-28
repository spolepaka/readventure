import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { ALL_FACTS } from '../data/mathFacts';
import { generateFactKey } from '../utils/factKeys';
import { getGradeGoalBoss } from '../utils/gradeThresholds';
import { getBossConfig } from '../game/bosses/bossConfig';
import { PlayerRow, PerformanceSnapshotRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type Player = Infer<typeof PlayerRow>;
type PerformanceSnapshot = Infer<typeof PerformanceSnapshotRow>;
import type { Track } from '../data/tracks';

/**
 * Convert goal boss wins to visual star tier
 * Nystrom: Pure function, easy to test, no side effects
 */
export function getStarTier(goalBossWins: number): 'empty' | 'bronze' | 'silver' | 'master' {
  if (goalBossWins >= 3) return 'master';
  if (goalBossWins === 2) return 'silver';
  if (goalBossWins === 1) return 'bronze';
  return 'empty';
}

export interface TrackMasterStatus {
  trackId: string;  // Track ID (e.g., 'TRACK7', 'ALL')
  operation: 'add' | 'subtract' | 'multiply' | 'divide' | 'all';  // 'all' for ALL track
  icon: string;
  name: string;
  masteryPercent: number;  // Used by dev override
  masteredCount: number;
  totalFacts: number;
  isMaster: boolean;
  // Boss-win based progression
  goalBossWins: number;  // 0, 1, 2, or 3+ wins against grade goal boss
  goalBossName: string;  // e.g., "Calc-Bot" - for clear tooltips
  starTier: 'empty' | 'bronze' | 'silver' | 'master';  // Visual tier derived from goalBossWins
}

/**
 * Pure function: Calculate track master statuses
 * Extracted for use in non-React contexts (e.g., captureRaidStartState)
 */
export function calculateTrackMasterStatuses(
  player: Player | null,
  tracks: Track[],
  performanceSnapshots: PerformanceSnapshot[],
  factMasteries: any[]
): TrackMasterStatus[] {
  if (!player || tracks.length === 0) {
    return [];
  }
  
  const goalBossId = getGradeGoalBoss(player.grade);
  const goalBossName = getBossConfig(goalBossId).name;  // e.g., "Calc-Bot"
  
  return tracks.map(track => {
    const isAllTrack = track.id === 'ALL' || !track.operation;
    const operation = track.operation ?? 'all';
    
    // For ALL track, skip fact mastery (purely boss-win based)
    let masteryPercent = 0;
    let masteredCount = 0;
    let totalFacts = 0;
    
    if (!isAllTrack) {
      // Get all facts for this operation at player's grade
      const trackFacts = ALL_FACTS.filter(f => 
        f.operation.tag.toLowerCase() === operation &&
        f.grades.includes(player.grade)
      );
      
      totalFacts = trackFacts.length;
      
      // Generate fact keys for this track
      const trackFactKeys = new Set(
        trackFacts.map(f => generateFactKey(f.left, f.right, operation))
      );
      
      // Count mastered facts (server-calculated mastery_level >= 5)
      masteredCount = factMasteries.filter(fm => 
        fm.playerId === player.id &&
        fm.masteryLevel >= 5 &&
        trackFactKeys.has(fm.factKey)
      ).length;
      
      masteryPercent = totalFacts > 0 ? (masteredCount / totalFacts) * 100 : 0;
    }
    
    // Count SOLO victories against goal boss for this track/grade
    // Track Master = solo achievement (can't be carried by friends in multiplayer)
    const soloTrackSnapshots = performanceSnapshots
      .filter((s: PerformanceSnapshot) => {
        const matchesTrack = isAllTrack 
          ? (s.track === 'ALL' || !s.track)
          : s.track === track.id;
        return s.playerId === player.id && 
               matchesTrack && 
               s.grade === player.grade &&
               s.raidType === 'solo';
      });
    
    const goalBossWins = soloTrackSnapshots.filter((snapshot: PerformanceSnapshot) => {
      return snapshot.bossLevel === goalBossId && snapshot.victory === true;
    }).length;
    
    // Master status: 3 boss wins = master (boss ladder implicitly tests mastery)
    const isMaster = goalBossWins >= 3;
    
    return {
      trackId: track.id,
      operation: operation as 'add' | 'subtract' | 'multiply' | 'divide' | 'all',
      icon: track.icon,
      name: track.name,
      masteryPercent: Math.min(masteryPercent, 100),
      masteredCount,
      totalFacts,
      isMaster,
      goalBossWins,
      goalBossName,
      starTier: getStarTier(goalBossWins),
    };
  });
}

/**
 * Hook wrapper: Calculate Master badge status for all tracks at player's grade
 */
export function useTrackMasterStatus(player: Player | null, tracks: Track[], performanceSnapshots: PerformanceSnapshot[]): TrackMasterStatus[] {
  const factMasteries = useGameStore(state => state.factMasteries);
  
  return useMemo(
    () => calculateTrackMasterStatuses(player, tracks, performanceSnapshots, factMasteries),
    [player, tracks, factMasteries, performanceSnapshots]
  );
}

