import { useMemo } from 'react';
import { getUpcomingMilestones, type Milestone } from '@/utils/rankMilestones';

interface FilteredDataPoint {
  date: string;
  dateTime: Date;
  mastered: number;
}

interface EtaPrediction {
  name: string;
  factsAway: number;
  etaDays: number;
  etaText: string;
  isClose: boolean; // < 7 days
  isVeryClose: boolean; // < 5 facts
}

export interface EtaResult {
  milestones: EtaPrediction[] | null;
  reason?: 'not_enough_data' | 'stalled' | 'legendary';
}

/**
 * Calculate ETA predictions for upcoming mastery milestones.
 * Uses simple linear velocity (facts/day) from first to last data point.
 */
export function useEtaPrediction(
  filteredData: FilteredDataPoint[],
  currentRank: string | null | undefined,
  masteredCount: number,
  totalCount: number
): EtaResult {
  return useMemo(() => {
    // Only celebrate at TRUE 100% mastery
    if (masteredCount >= totalCount) {
      return { milestones: null, reason: 'legendary' };
    }
    
    // Need at least 2 days of data to calculate velocity
    if (filteredData.length < 2) {
      return { milestones: null, reason: 'not_enough_data' };
    }
    
    // Ensure data is chronologically sorted (oldest to newest)
    const sortedData = [...filteredData].sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
    
    // Use last 30 days of data for velocity (captures recent pace, not old history)
    // Why: Kids who return after a break should see predictions based on current effort
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentData = sortedData.filter(d => d.dateTime >= thirtyDaysAgo);
    const velocityData = recentData.length >= 2 ? recentData : sortedData;
    
    // Calculate velocity (facts per day) using recent data
    const first = velocityData[0];
    const last = velocityData[velocityData.length - 1];
    
    // Chart already deduplicates by calendar day, so having 2+ points means 2+ days
    // Use calendar day difference, not fractional time (avoid edge case where
    // Mon 11pm + Tue 1am = 2 hours but represents 2 days of effort)
    const firstDay = first.date; // "2024-10-14"
    const lastDay = last.date;   // "2024-10-15"
    
    // If same calendar day somehow (shouldn't happen), not enough data
    if (firstDay === lastDay) {
      return { milestones: null, reason: 'not_enough_data' };
    }
    
    // Calculate calendar days (not fractional time)
    // Strip time component to count full days only
    const firstDate = new Date(first.dateTime);
    firstDate.setHours(0, 0, 0, 0);
    
    const lastDate = new Date(last.dateTime);
    lastDate.setHours(0, 0, 0, 0);
    
    // Calculate difference in calendar days
    const days = (lastDate.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000);
    
    // Should always be >= 1 since we already checked firstDay !== lastDay
    const effectiveDays = Math.max(days, 1);
    
    const gain = last.mastered - first.mastered;
    const velocity = gain / effectiveDays;
    
    // No meaningful progress
    if (velocity <= 0.01) {
      return { milestones: null, reason: 'stalled' };
    }
    
    // Get upcoming milestones
    const upcoming = getUpcomingMilestones(currentRank, masteredCount, totalCount);
    
    // Calculate ETAs for each milestone
    const predictions: EtaPrediction[] = upcoming
      .map(milestone => {
        const etaDays = milestone.factsAway / velocity;
        
        return {
          name: milestone.name,
          factsAway: milestone.factsAway,
          etaDays,
          etaText: formatEta(etaDays),
          isClose: etaDays < 7,
          isVeryClose: milestone.factsAway < 5
        };
      })
      .filter(p => p.factsAway > 0); // Skip already achieved
    
    // Show max 2 milestones
    const toShow = predictions.slice(0, 2);
    
    if (toShow.length === 0) {
      return { milestones: null, reason: 'legendary' };
    }
    
    return { milestones: toShow };
  }, [filteredData, currentRank, masteredCount, totalCount]);
}


/**
 * Format ETA as friendly, fuzzy time.
 * We track time (not raids), so all estimates are time-based.
 */
function formatEta(days: number): string {
  const rounded = Math.round(days);
  
  if (rounded < 1) return "very soon!";
  if (rounded === 1) return "in ~1 day";
  if (rounded < 7) return `in ~${rounded} days`;
  
  const weeks = Math.round(days / 7);
  if (rounded < 28) return `in ~${weeks} week${weeks === 1 ? '' : 's'}`;
  
  const months = Math.round(days / 30);
  if (rounded < 90) return `in ~${months} month${months === 1 ? '' : 's'}`;
  
  return "in a few months";
}

