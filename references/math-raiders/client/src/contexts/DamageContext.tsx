import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { DamageNumber } from '../components/FloatingCombatText';

interface DamageContextType {
  damages: DamageNumber[];
  spawnDamage: (damage: DamageNumber) => void;
  removeDamage: (id: number) => void;
}

const DamageContext = createContext<DamageContextType | null>(null);

let damageIdCounter = 0;
export const getUniqueDamageId = () => ++damageIdCounter;

export function DamageProvider({ children }: { children: ReactNode }) {
  const [damages, setDamages] = useState<DamageNumber[]>([]);
  
  const spawnDamage = useCallback((damage: DamageNumber) => {
    setDamages(prev => [...prev, damage]);
  }, []);
  
  const removeDamage = useCallback((id: number) => {
    setDamages(prev => prev.filter(d => d.id !== id));
  }, []);
  
  return (
    <DamageContext.Provider value={{ damages, spawnDamage, removeDamage }}>
      {children}
    </DamageContext.Provider>
  );
}

export function useDamage() {
  const context = useContext(DamageContext);
  if (!context) {
    throw new Error('useDamage must be used within DamageProvider');
  }
  return context;
}

