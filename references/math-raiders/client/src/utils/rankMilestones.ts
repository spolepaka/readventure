/**
 * Calculate all upcoming milestones (divisions, next rank, legendary)
 * for ETA prediction system.
 */

// Rank percentage thresholds (shared with rankDivisions.ts)
const RANK_THRESHOLDS = {
  bronze: { min: 0, max: 25 },
  silver: { min: 25, max: 50 },
  gold: { min: 50, max: 75 },
  diamond: { min: 75, max: 90 },
  legendary: { min: 90, max: 100 }
} as const;

const RANKS_IN_ORDER = ['bronze', 'silver', 'gold', 'diamond', 'legendary'] as const;

export interface Milestone {
  name: string;
  factsAway: number;
  percentNeeded: number;
}

/**
 * Get all upcoming milestones for a player.
 * Returns divisions in current rank, then next rank, then legendary.
 */
export function getUpcomingMilestones(
  currentRank: string | null | undefined,
  masteredCount: number,
  totalCount: number
): Milestone[] {
  if (!currentRank || totalCount === 0) return [];
  
  const currentPercent = (masteredCount / totalCount) * 100;
  const milestones: Milestone[] = [];
  
  const rankRange = RANK_THRESHOLDS[currentRank as keyof typeof RANK_THRESHOLDS];
  if (!rankRange) return [];
  
  // Add remaining divisions in current rank (legendary has no divisions)
  if (currentRank !== 'legendary') {
    // Ranks have 4 divisions (IV→III→II→I), show milestones for divisions III, II, I
    // Players start in Division IV, so we show milestones at 25%, 50%, 75% progress through rank
    const rankSpan = rankRange.max - rankRange.min;
    
    // Division milestones: 25% = III, 50% = II, 75% = I
    const divisionMilestones = [
      { progress: 0.25, name: 'III' },  // 25% through rank
      { progress: 0.50, name: 'II' },   // 50% through rank
      { progress: 0.75, name: 'I' }     // 75% through rank
    ];
    
    for (const { progress, name: divisionName } of divisionMilestones) {
      const divPercent = rankRange.min + progress * rankSpan;
      
      if (divPercent > currentPercent) {
        const factsNeeded = Math.ceil(totalCount * divPercent / 100);
        milestones.push({
          name: `${capitalize(currentRank)} ${divisionName}`,
          factsAway: factsNeeded - masteredCount,
          percentNeeded: divPercent
        });
      }
    }
  }
  
  // Add next rank
  const currentRankIndex = RANKS_IN_ORDER.indexOf(currentRank as typeof RANKS_IN_ORDER[number]);
  if (currentRankIndex >= 0 && currentRankIndex < 4) {
    const nextRank = RANKS_IN_ORDER[currentRankIndex + 1];
    const nextThreshold = RANK_THRESHOLDS[nextRank];
    const factsNeeded = Math.ceil(totalCount * nextThreshold.min / 100);
    
    milestones.push({
      name: capitalize(nextRank),
      factsAway: factsNeeded - masteredCount,
      percentNeeded: nextThreshold.min
    });
  }
  
  // Add legendary if not there yet (skip if diamond, since next rank already adds it)
  if (currentRank !== 'diamond' && currentPercent < 90) {
    const factsNeeded = Math.ceil(totalCount * 90 / 100);
    milestones.push({
      name: 'Legendary',
      factsAway: factsNeeded - masteredCount,
      percentNeeded: 90
    });
  }
  
  // Add complete mastery (100%) - the ultimate goal!
  if (currentPercent < 100) {
    milestones.push({
      name: 'Complete Mastery',
      factsAway: totalCount - masteredCount,
      percentNeeded: 100
    });
  }
  
  return milestones;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

