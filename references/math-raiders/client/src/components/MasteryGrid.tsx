import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { generateFactKey } from '../utils/factKeys';
import { OPERATION_SYMBOLS } from '../constants/operationSymbols';
import { ALL_FACTS } from '../data/mathFacts';
import Operation from '../spacetime/operation_type';
import { DivisionFactFamilies } from './DivisionFactFamilies';
import { FactMasteryRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type FactMastery = Infer<typeof FactMasteryRow>;

type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide';

interface MasteryGridProps {
  operation: MathOperation;
  factMasteries: FactMastery[];
  grade: number;
}

export function MasteryGrid({ 
  operation, 
  factMasteries,
  grade
}: MasteryGridProps) {
  // Build mastery lookup map
  const masteryMap: Record<string, typeof factMasteries[0]> = {};
  factMasteries.forEach(fm => {
    masteryMap[fm.factKey] = fm;
  });
  
  // All facts are now available - no tier filtering
  
  // First, get the facts for this grade and operation
  const operationEnum = operation === 'add' ? Operation.Add :
                       operation === 'subtract' ? Operation.Subtract :
                       operation === 'multiply' ? Operation.Multiply :
                       Operation.Divide;
  
  const gradeFactsForOperation = ALL_FACTS.filter(fact => 
    fact.grades.includes(grade) && 
    fact.operation.tag === operationEnum.tag
  );
  
  // Smart engineering: Let the data drive the grid size
  // Find the highest number that appears in any fact for this grade/operation
  let maxSize = gradeFactsForOperation.length === 0 
    ? { multiply: 12, divide: 12, add: 20, subtract: 20 }[operation] // Fallback
    : Math.max(...gradeFactsForOperation.map(f => Math.max(f.left, f.right)));
  
  // Division is special: use only the dividends that actually have facts
  const usedDividends = operation === 'divide' && gradeFactsForOperation.length > 0
    ? [...new Set(gradeFactsForOperation.map(f => f.left))].sort((a, b) => a - b)
    : null;
    
  // Cap divisors at 12 for division
  const maxDivisor = operation === 'divide' && gradeFactsForOperation.length > 0
    ? Math.min(12, Math.max(...gradeFactsForOperation.map(f => f.right)))
    : maxSize;
  
  // Grid dimensions - always include 0 for all operations
  const includeZero = true;
  
  // For division: different row/column sizes
  const rowNumbers = operation === 'divide' && usedDividends
    ? usedDividends  // Only show rows that have division facts
    : includeZero 
      ? Array.from({ length: maxSize + 1 }, (_, i) => i)
      : Array.from({ length: maxSize }, (_, i) => i + 1);
    
  const colNumbers = operation === 'divide'
    ? (includeZero 
        ? Array.from({ length: maxDivisor + 1 }, (_, i) => i)
        : Array.from({ length: maxDivisor }, (_, i) => i + 1))
    : operation === 'subtract' && gradeFactsForOperation.length > 0
      ? [...new Set(gradeFactsForOperation.map(f => f.right))].sort((a, b) => a - b)
      : rowNumbers; // Same as rows for other operations
    
  // For backward compatibility, 'numbers' refers to rows
  const numbers = rowNumbers;
  
  // Get operation symbol
  const opSymbol = OPERATION_SYMBOLS[operation.charAt(0).toUpperCase() + operation.slice(1) as keyof typeof OPERATION_SYMBOLS];
  
  // Count unique orange cells for debugging
  const uniqueOrangeFacts = new Set();
  numbers.forEach(row => {
    numbers.forEach(col => {
      const factKey = generateFactKey(row, col, operation);
      const mastery = masteryMap[factKey];
      if (mastery?.masteryLevel >= 5) {
        uniqueOrangeFacts.add(factKey);
      }
    });
  });
  
  // No overflow needed - we show all facts now
  
  // Calculate progress stats - count only facts available for this grade
  const validFactsCount = gradeFactsForOperation.length;
  
  // Create a set of valid fact keys for this grade
  const validFactKeys = new Set(
    gradeFactsForOperation.map(f => generateFactKey(f.left, f.right, operation))
  );
  
  // Only count mastered facts that are actually available for this grade
  const masteredCount = Object.entries(masteryMap)
    .filter(([key, m]) => validFactKeys.has(key) && m.masteryLevel >= 5)
    .length;
  const progressPercent = validFactsCount > 0 ? Math.round((masteredCount / validFactsCount) * 100) : 0;
  
  // Division gets special fact family treatment
  if ((operation as MathOperation) === 'divide') {
    return (
      <motion.div 
        key={operation}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ 
          type: "spring", 
          stiffness: 300, 
          damping: 20,
          duration: 0.3 
        }}
        className={cn("mx-auto", "max-w-5xl")} // Wider for fact families
      >
        {/* Reuse exact same progress stats */}
        {factMasteries.length > 0 && (
          <motion.div 
            className="text-center mb-4"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}>
            <p className="text-base text-gray-400 mb-2">
              <span className="text-amber-400 font-semibold">{masteredCount}</span>
              <span className="text-gray-500 text-sm"> of </span>
              <span className="text-gray-300 font-semibold">{validFactsCount}</span>
              <span className="text-gray-500 text-sm"> facts mastered</span>
              {(operation === 'add' || operation === 'multiply') && (
                <span 
                  className="inline-block ml-1 text-gray-500 cursor-help relative info-icon"
                  data-tooltip="Unique facts only (3 + 4 = 4 + 3 counts as one)"
                >
                  ⓘ
                </span>
              )}
            </p>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-amber-400 to-orange-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{progressPercent}% complete</p>
          </motion.div>
        )}
        
        <DivisionFactFamilies 
          facts={gradeFactsForOperation}
          masteryMap={masteryMap}
          factMasteries={factMasteries}
        />
      </motion.div>
    );
  }
  
  return (
    <motion.div 
      key={operation} // This triggers re-animation when operation changes
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ 
        type: "spring", 
        stiffness: 300, 
        damping: 20,
        duration: 0.3 
      }}
      className={cn(
        "mx-auto",
        maxSize <= 12 ? "max-w-lg" : "max-w-2xl" // Wider container for larger grids
      )}
    >
      {/* Progress stats */}
      {factMasteries.length > 0 && (
        <motion.div 
          className="text-center mb-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}>
          <p className="text-base text-gray-400 mb-2">
            <span className="text-amber-400 font-semibold">{masteredCount}</span>
            <span className="text-gray-500 text-sm"> of </span>
            <span className="text-gray-300 font-semibold">{validFactsCount}</span>
            <span className="text-gray-500 text-sm"> facts mastered</span>
            {(operation === 'add' || operation === 'multiply') && (
              <span 
                className="inline-block ml-1 text-gray-500 cursor-help relative info-icon"
                data-tooltip="All progress tracks unique facts (3 + 4 = 4 + 3 counts as one)"
              >
                ⓘ
              </span>
            )}
          </p>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-amber-400 to-orange-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{progressPercent}% complete</p>
        </motion.div>
      )}
      
      {/* Everything in one grid for perfect alignment */}
      <div 
          className="grid gap-1 text-[10px] w-full"
        style={{
          gridTemplateColumns: `repeat(${colNumbers.length + 1}, minmax(0, 1fr))` // +1 for row headers
        }}
          role="grid"
          aria-label={`${operation} facts mastery grid`}
        >
        {/* Header row spanning correct columns */}
        <div></div> {/* Empty cell matching row headers */}
        <div 
          className="flex justify-between items-center mb-2"
          style={{ gridColumn: `span ${colNumbers.length}` }}
        >
          <h4 className="text-sm font-bold text-white">{operation.charAt(0).toUpperCase() + operation.slice(1)} Facts</h4>
        </div>
        
        {/* Separator row */}
        <div></div>
        <div 
          className="h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent mb-3"
          style={{ gridColumn: `span ${colNumbers.length}` }}
        ></div>
        {/* Column headers */}
        <div></div>
        {colNumbers.map(n => (
          <div key={`h${n}`} className="text-center text-gray-400 text-[10px] font-medium">
            {n}
          </div>
        ))}
        
        {/* Grid rows */}
        {numbers.map(row => (
          <React.Fragment key={`r${row}`}>
            {/* Row header */}
            <div className="text-gray-500 text-[9px] flex items-center justify-end pr-1">
              {row}{opSymbol}
            </div>
            
            {/* Cells */}
            {colNumbers.map(col => {
              const factKey = generateFactKey(row, col, operation);
              // Check if this fact is available for the current grade
              const isAvailableForGrade = validFactKeys.has(factKey);
              // Only use mastery data if fact is available for current grade
              const mastery = isAvailableForGrade ? masteryMap[factKey] : undefined;
              const level = mastery?.masteryLevel || 0;
              
              const isValidFact = () => {
                switch (operation) {
                  case 'subtract':
                    return row >= col; // No negative results
                  case 'divide':
                    return col !== 0; // No division by zero
                  default:
                    return true; // Add and multiply are always valid
                }
              };
              
              // Calculate result based on operation
              const result = operation === 'add' ? row + col :
                            operation === 'subtract' ? row - col :
                            operation === 'multiply' ? row * col :
                            operation === 'divide' && col !== 0 ? row / col : 0;
              
              // Invalid facts (negative results) render dimmed like unavailable facts
              const isInvalidFact = !isValidFact();
              
              return (
                <motion.div
                  key={`${row}x${col}`}
                  data-fact={`${row} ${opSymbol} ${col} = ${result}`}
                  data-accuracy={(() => {
                    if (!mastery || mastery.recentAttempts.length === 0) return '';
                    const recent = mastery.recentAttempts.slice(-3);
                    const correct = recent.filter(a => a.correct).length;
                    return `${Math.round((correct / recent.length) * 100)}%`;
                  })()}
                  data-speed={(() => {
                    if (!mastery || mastery.recentAttempts.length === 0) return '';
                    const recentCorrect = mastery.recentAttempts.slice(-3).filter(a => a.correct);
                    if (recentCorrect.length === 0) return '';
                    const avgMs = recentCorrect.reduce((sum, a) => sum + a.timeMs, 0) / recentCorrect.length;
                    return `${(avgMs / 1000).toFixed(1)}s`;
                  })()}
                  data-stats={(() => {
                    if (!mastery || mastery.recentAttempts.length === 0) return '';
                    const recent = mastery.recentAttempts.slice(-3);
                    const correct = recent.filter(a => a.correct).length;
                    const accuracy = `${Math.round((correct / recent.length) * 100)}%`;
                    
                    const recentCorrect = recent.filter(a => a.correct);
                    if (recentCorrect.length === 0) return accuracy; // Only accuracy, no bullet
                    
                    const avgMs = recentCorrect.reduce((sum, a) => sum + a.timeMs, 0) / recentCorrect.length;
                    const speed = `${(avgMs / 1000).toFixed(1)}s`;
                    return `${accuracy} • ${speed}`; // Both, with bullet
                  })()}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ 
                    delay: (row + col) * 0.015, // Ripple effect
                    type: "spring",
                    stiffness: 500,
                    damping: 20
                  }}
                  className={cn(
                    // Base styles
                    "mastery-cell aspect-square flex items-center justify-center",
                    "rounded font-bold transition-colors cursor-default",
                    "relative", // For tooltip positioning
                    // Responsive text sizing
                    maxSize <= 12 ? "text-xs md:text-sm" : "text-[10px] md:text-xs",
                    
                    // Position tooltip below for top row
                    row === 2 && "tooltip-below",
                    
                    // Mastery colors - game-inspired progression
                    // Facts not available for grade OR invalid (negative) are dimmed
                    (!isAvailableForGrade || isInvalidFact) && "bg-gray-800/50 text-gray-500",
                    // Available facts show normal colors (only if valid)
                    isAvailableForGrade && !isInvalidFact && level >= 5 && "bg-gradient-to-br from-amber-400 to-orange-500 text-white",
                    isAvailableForGrade && !isInvalidFact && level === 4 && "bg-purple-500 text-white",
                    isAvailableForGrade && !isInvalidFact && level === 3 && "bg-purple-500 text-white",
                    isAvailableForGrade && !isInvalidFact && level === 2 && "bg-cyan-500 text-white", 
                    isAvailableForGrade && !isInvalidFact && level === 1 && "bg-cyan-500 text-white",
                    isAvailableForGrade && !isInvalidFact && (level === 0 || !mastery) && "bg-gray-600 text-gray-300", // Not enough progress yet
                    
                    // Hover effect (only for available AND valid facts)
                    isAvailableForGrade && !isInvalidFact && "hover:brightness-110 hover:shadow-lg hover:shadow-white/10 hover:z-10"
                  )}
                >
                  {Math.floor(result)}
                </motion.div>
              );
            })}
          </React.Fragment>
        ))}
        
        {/* Empty state message */}
        {factMasteries.length === 0 && (
          <div 
            className="text-center mt-4 text-gray-400 text-sm"
            style={{ gridColumn: `span ${colNumbers.length + 1}` }} // +1 for row header
          >
            <div className="text-2xl mb-2">🎯</div>
            <p>Start a raid to light up your grid!</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
