import { useDamage } from '../contexts/DamageContext';
import { FloatingCombatText } from './FloatingCombatText';

/**
 * Damage overlay - Sits at app level, independent of game screen re-renders
 * This is Bob-approved: Damage system separated from other game systems
 */
export function DamageOverlay() {
  const { damages, removeDamage } = useDamage();
  
  return (
    <div className="fixed inset-0 pointer-events-none overflow-visible z-50">
      <FloatingCombatText 
        damages={damages}
        onComplete={removeDamage}
      />
    </div>
  );
}

