import { useMemo } from 'react';

/**
 * FloatingMathSymbols - Static math symbols during raid
 * 
 * Performance-first: Zero animations, just beautiful static decoration
 * Scattered around edges so they don't distract from gameplay
 */

interface MathSymbol {
  id: number;
  symbol: string;
  x: number;
  y: number;
  size: string;
  rotation: number;
  opacity: number;
  hasGlow: boolean;
}

const MATH_SYMBOLS = ['×', '÷', '+', '−', '=', '∑', '∏', '√', '∞', 'π', 'θ', 'Δ'];

export const FloatingMathSymbols = () => {
  // Generate symbols once - scattered around edges, not center (don't block gameplay)
  const symbols = useMemo((): MathSymbol[] => {
    const result: MathSymbol[] = [];
    
    // Place 12 symbols around the edges
    const positions = [
      // Top edge
      { x: 5, y: 5 }, { x: 25, y: 8 }, { x: 75, y: 6 }, { x: 92, y: 10 },
      // Left edge
      { x: 3, y: 35 }, { x: 6, y: 70 },
      // Right edge  
      { x: 94, y: 40 }, { x: 91, y: 75 },
      // Bottom edge
      { x: 8, y: 88 }, { x: 30, y: 92 }, { x: 70, y: 90 }, { x: 88, y: 85 },
    ];
    
    const sizes = ['text-xl', 'text-2xl', 'text-3xl', 'text-4xl'];
    
    for (let i = 0; i < 12; i++) {
      const pos = positions[i];
      result.push({
      id: i,
        symbol: MATH_SYMBOLS[i],
        x: pos.x + (Math.random() * 4 - 2), // Slight randomness
        y: pos.y + (Math.random() * 4 - 2),
        size: sizes[i % sizes.length],
        rotation: Math.random() * 30 - 15, // -15 to +15 degrees
        opacity: 0.08 + Math.random() * 0.08, // 8-16% opacity (subtle)
        hasGlow: i % 4 === 0, // Every 4th glows
      });
    }
    
    return result;
  }, []);

  return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {symbols.map((s) => (
        <span
          key={s.id}
          className={`absolute font-bold select-none ${s.size} ${
            s.hasGlow 
              ? 'text-violet-400 drop-shadow-[0_0_8px_rgba(167,139,250,0.5)]' 
              : 'text-white'
          }`}
            style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            opacity: s.hasGlow ? s.opacity * 2 : s.opacity,
            transform: `rotate(${s.rotation}deg)`,
          }}
          >
          {s.symbol}
        </span>
        ))}
      </div>
  );
};
