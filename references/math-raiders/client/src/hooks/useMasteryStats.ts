import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { ALL_FACTS } from '../data/mathFacts';
import { FactMasteryRow, PlayerRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type FactMastery = Infer<typeof FactMasteryRow>;
type Player = Infer<typeof PlayerRow>;

/**
 * Calculate mastery statistics for a player's current grade
 */
export function useMasteryStats(player: Player | null) {
  const factMasteries = useGameStore(state => state.factMasteries);
  
  return useMemo(() => {
    if (!player) {
      return { mastered: 0, total: 0, percentage: 0 };
    }
    
    // Get facts for current grade
    const gradeFacts = ALL_FACTS.filter(fact => 
      fact.grades.includes(player.grade)
    );
    
    // Create a set of valid fact keys for this grade
    const validFactKeys = new Set(
      gradeFacts.map(f => {
        // Convert Operation enum to symbol to match backend format
        const opSymbol = f.operation.tag === 'Add' ? '+' : 
                        f.operation.tag === 'Subtract' ? '-' :
                        f.operation.tag === 'Multiply' ? '×' :
                        f.operation.tag === 'Divide' ? '÷' : '';
        
        // Normalize fact key to match backend (smaller first for commutative ops)
        if (f.operation.tag === 'Add' || f.operation.tag === 'Multiply') {
          const min = Math.min(f.left, f.right);
          const max = Math.max(f.left, f.right);
          return `${min}${opSymbol}${max}`;
        } else {
          return `${f.left}${opSymbol}${f.right}`;
        }
      })
    );
    
    // Count mastered facts (level 5+) that are in current grade
    const masteredCount = factMasteries.filter(fm => 
      fm.playerId === player.id &&
      fm.masteryLevel >= 5 &&
      validFactKeys.has(fm.factKey)
    ).length;
    
    const totalCount = gradeFacts.length;
    const percentage = totalCount > 0 ? (masteredCount / totalCount) * 100 : 0;
    
    return {
      mastered: masteredCount,
      total: totalCount,
      percentage: Math.round(percentage * 10) / 10 // Round to 1 decimal
    };
  }, [player, factMasteries]);
}
