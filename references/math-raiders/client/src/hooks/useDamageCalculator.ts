import { useCallback } from 'react';

// Grade-based thresholds (Alpha School CQPM standards)
const getFastThreshold = (grade: number) => {
  if (grade === 0) return 3000;      // K: 20 CQPM
  if (grade >= 1 && grade <= 3) return 2000;  // G1-3: 30 CQPM
  if (grade === 4) return 1700;      // G4: 35 CQPM
  return 1500;                       // G5+: 40 CQPM
};

const RESPONSE_TIME_LIMITS = {
  FAST: 2000,  // Default (will be overridden by grade)
  MEDIUM: 3500,
  MAX_VALID: 60000
};

/**
 * Estimate damage for a correct answer (client-side prediction).
 * Matches server's calculate_damage logic exactly, including crits.
 * Used for optimistic UI updates before server confirms.
 */
export function estimateDamage(responseMs: number, grade: number): { damage: number; isCrit: boolean } {
  const fastThreshold = getFastThreshold(grade);
  
  if (responseMs <= fastThreshold) {
    // Fast answers can crit (15% chance for 2x damage)
    const isCrit = Math.random() < 0.15;
    return { damage: isCrit ? 150 : 75, isCrit };
  } else if (responseMs <= fastThreshold + 1000) {
    return { damage: 60, isCrit: false };  // +1s
  } else if (responseMs <= fastThreshold + 2000) {
    return { damage: 45, isCrit: false };  // +2s
  } else if (responseMs <= fastThreshold + 3000) {
    return { damage: 30, isCrit: false };  // +3s
  } else if (responseMs <= fastThreshold + 5000) {
    return { damage: 23, isCrit: false };  // +5s
  } else {
    return { damage: 15, isCrit: false };  // Beyond
  }
}

/**
 * Hook for speed tier determination and threshold access
 */
export function useDamageCalculator() {
  const getSpeedTier = useCallback((responseTime: number, grade?: number): 'fast' | 'medium' | 'normal' => {
    const fastThreshold = getFastThreshold(grade ?? 4);
    if (responseTime < fastThreshold) return 'fast';
    if (responseTime < fastThreshold + 2000) return 'medium';
    return 'normal';
  }, []);

  return { getSpeedTier, RESPONSE_TIME_LIMITS, getFastThreshold, estimateDamage };
}
