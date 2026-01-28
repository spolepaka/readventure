/**
 * Calculate rank division based on progress within current rank
 * Returns IV, III, II, or I based on percentage within rank boundaries
 */
export function calculateDivision(
  rank: string | null | undefined,
  masteredCount: number,
  totalCount: number
): string {
  if (!rank || totalCount === 0) return 'IV';
  
  // Legendary has no divisions - it's the pinnacle
  if (rank === 'legendary') return '';
  
  const percentage = (masteredCount / totalCount) * 100;
  
  // Rank thresholds
  const thresholds = {
    bronze: { min: 0, max: 25 },
    silver: { min: 25, max: 50 },
    gold: { min: 50, max: 75 },
    diamond: { min: 75, max: 90 },
    legendary: { min: 90, max: 100 }
  };
  
  const currentRank = thresholds[rank as keyof typeof thresholds];
  if (!currentRank) return 'IV';
  
  // Calculate position within current rank (0-1)
  const rankRange = currentRank.max - currentRank.min;
  const progressInRank = percentage - currentRank.min;
  const positionInRank = Math.max(0, Math.min(1, progressInRank / rankRange));
  
  // Map to divisions (4 divisions per rank)
  if (positionInRank >= 0.75) return 'I';
  if (positionInRank >= 0.50) return 'II';
  if (positionInRank >= 0.25) return 'III';
  return 'IV';
}

/**
 * Get rank color classes for Tailwind
 */
export function getRankColorClasses(rank: string | null | undefined): {
  bg: string;
  text: string;
  border: string;
  glow: string;
} {
  switch (rank) {
    case 'bronze':
      return {
        bg: 'bg-yellow-950/20',
        text: 'text-yellow-700',
        border: 'border-yellow-800',
        glow: 'shadow-yellow-800/20'
      };
    case 'silver':
      return {
        bg: 'bg-gray-700/20',
        text: 'text-gray-300',
        border: 'border-gray-500',
        glow: 'shadow-gray-400/20'
      };
    case 'gold':
      return {
        bg: 'bg-yellow-900/20',
        text: 'text-yellow-400',
        border: 'border-yellow-600',
        glow: 'shadow-yellow-500/20'
      };
    case 'diamond':
      return {
        bg: 'bg-cyan-900/20',
        text: 'text-cyan-400',
        border: 'border-cyan-500',
        glow: 'shadow-cyan-400/30'
      };
    case 'legendary':
      return {
        bg: 'bg-purple-900/20',
        text: 'text-purple-400',
        border: 'border-purple-500',
        glow: 'shadow-purple-500/40'
      };
    default:
      return {
        bg: 'bg-gray-900/20',
        text: 'text-gray-400',
        border: 'border-gray-600',
        glow: 'shadow-gray-500/10'
      };
  }
}

/**
 * Get rank icon (emoji for now, can be replaced with SVG later)
 */
export function getRankIcon(rank: string | null | undefined): string {
  switch (rank) {
    case 'bronze': return '🥉';
    case 'silver': return '🥈';
    case 'gold': return '🥇';
    case 'diamond': return '💎';
    case 'legendary': return '⚡';
    default: return '🎯';
  }
}

/**
 * Calculate facts needed to reach next milestone (division or rank)
 * Returns null if at max rank (legendary) or invalid data
 */
export function getNextMilestone(
  rank: string | null | undefined,
  masteredCount: number,
  totalCount: number
): { factsNeeded: number; milestone: string } | null {
  // Edge case: No rank or invalid data
  if (!rank || totalCount === 0) {
    return null;
  }
  
  // Edge case: Already at max rank
  if (rank === 'legendary') {
    return null;
  }
  
  // Edge case: Data corruption check
  if (masteredCount > totalCount) {
    console.warn(`Facts mastered (${masteredCount}) exceeds total facts (${totalCount})`);
    return null;
  }
  
  // Get current division
  const division = calculateDivision(rank, masteredCount, totalCount);
  
  // Rank thresholds (same as server)
  const thresholds = {
    bronze: { min: 0, max: 25 },
    silver: { min: 25, max: 50 },
    gold: { min: 50, max: 75 },
    diamond: { min: 75, max: 90 }
  };
  
  const currentRank = thresholds[rank as keyof typeof thresholds];
  if (!currentRank) return null;
  
  const rankRange = currentRank.max - currentRank.min;
  
  // Calculate next percentage target based on division
  let nextPercentage: number;
  let nextMilestone: string;
  
  switch (division) {
    case 'IV':
      nextPercentage = currentRank.min + (rankRange * 0.25);
      nextMilestone = `${rank.charAt(0).toUpperCase() + rank.slice(1)} III`;
      break;
    case 'III':
      nextPercentage = currentRank.min + (rankRange * 0.50);
      nextMilestone = `${rank.charAt(0).toUpperCase() + rank.slice(1)} II`;
      break;
    case 'II':
      nextPercentage = currentRank.min + (rankRange * 0.75);
      nextMilestone = `${rank.charAt(0).toUpperCase() + rank.slice(1)} I`;
      break;
    case 'I':
      // Moving to next rank
      const nextRankMap = {
        bronze: { percentage: 25, name: 'Silver IV' },
        silver: { percentage: 50, name: 'Gold IV' },
        gold: { percentage: 75, name: 'Diamond IV' },
        diamond: { percentage: 90, name: 'Legendary' }
      };
      const nextRank = nextRankMap[rank as keyof typeof nextRankMap];
      if (!nextRank) return null;
      
      nextPercentage = nextRank.percentage;
      nextMilestone = nextRank.name;
      break;
    default:
      return null;
  }
  
  // Calculate facts needed (ceiling ensures at least 1)
  const factsNeeded = Math.ceil((nextPercentage * totalCount / 100) - masteredCount);
  
  // Edge case: Already past the milestone (shouldn't happen with correct division logic)
  if (factsNeeded <= 0) {
    return null;
  }
  
  return {
    factsNeeded,
    milestone: nextMilestone
  };
}














