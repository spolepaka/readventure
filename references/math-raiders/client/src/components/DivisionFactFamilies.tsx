import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { generateFactKey } from '../utils/factKeys';
import { FactMasteryRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type FactMastery = Infer<typeof FactMasteryRow>;
import type { MathFact } from '../data/mathFacts';

interface DivisionFactFamiliesProps {
  facts: MathFact[];
  masteryMap: Record<string, FactMastery>;
  factMasteries: FactMastery[];
}

export function DivisionFactFamilies({ 
  facts, 
  masteryMap,
  factMasteries
}: DivisionFactFamiliesProps) {
  // Load saved accordion state from localStorage
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('divisionAccordionState');
    return saved ? JSON.parse(saved) : {
      'Easy Patterns': true,  // Start with patterns open
      'Times Table Friends': false,
      'Challenge Facts': false
    };
  });

  // Save accordion state to localStorage
  useEffect(() => {
    localStorage.setItem('divisionAccordionState', JSON.stringify(expandedSections));
  }, [expandedSections]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };
  // Group facts by divisor (right side)
  const groupedByDivisor = facts.reduce((acc, fact) => {
    if (!acc[fact.right]) {
      acc[fact.right] = [];
    }
    acc[fact.right].push(fact);
    return acc;
  }, {} as Record<number, MathFact[]>);

  // Sort each divisor's facts by dividend
  Object.keys(groupedByDivisor).forEach(divisor => {
    groupedByDivisor[Number(divisor)].sort((a, b) => a.left - b.left);
  });

  // Group divisors by educational pattern
  const groups = [
    { 
      title: "Easy Patterns", 
      divisors: [1, 2, 5, 10],
      description: "These facts follow simple patterns",
      icon: "🌟"
    },
    { 
      title: "Times Table Friends", 
      divisors: [3, 4, 6, 8, 9, 12],
      description: "Related to your multiplication facts",
      icon: "🔢"
    },
    { 
      title: "Challenge Facts", 
      divisors: [7, 11],
      description: "These facts need extra practice",
      icon: "💪"
    }
  ].map(g => ({
    ...g,
    divisors: g.divisors.filter(d => groupedByDivisor[d]) // Only include divisors that have facts
  })).filter(g => g.divisors.length > 0); // Only show groups with facts

  return (
    <div className="space-y-4">
      {groups.map((group, groupIndex) => {
        const isExpanded = expandedSections[group.title];
        const totalFacts = group.divisors.reduce((sum, d) => sum + (groupedByDivisor[d]?.length || 0), 0);
        
        return (
          <div key={group.title} className="space-y-2">
            {/* Accordion Header */}
            <button
              onClick={() => toggleSection(group.title)}
              className="w-full flex items-center justify-between p-4 bg-gray-800/50 hover:bg-gray-800/70 rounded-lg"
              aria-expanded={isExpanded}
              aria-controls={`section-${group.title}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{group.icon}</span>
                <div className="text-left">
                  <h3 className="text-lg font-bold text-white">{group.title}</h3>
                  <p className="text-sm text-gray-400">{group.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {totalFacts} facts
                </span>
                <motion.div
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-gray-400"
                >
                  ▼
                </motion.div>
              </div>
            </button>
            
            {/* Accordion Content */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  id={`section-${group.title}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  <div className="p-4 space-y-4">
                    {group.divisors.map(divisor => {
                      const facts = groupedByDivisor[divisor];
                      if (!facts) return null;
                      
                      return (
                        <div key={divisor} className="space-y-2">
                          {/* Divisor header */}
                          <h4 className="text-white font-bold text-xl">
                            {divisor}
                          </h4>
                          
                          {/* Facts grid for this divisor */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                            {facts.map((fact, factIndex) => {
                              const factKey = generateFactKey(fact.left, fact.right, 'divide');
                              const mastery = masteryMap[factKey];
                              const level = mastery?.masteryLevel || 0;
                              const result = fact.left / fact.right;
                              
                              return (
                                <div
                                  key={factKey}
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
                                  data-attempts={''}
                                  className={cn(
                                    // Enable tooltips
                                    "mastery-cell",
                                    // Entrance animation - reuse existing fadeIn
                                    "animate-fadeIn",
                                    // Base styles
                                    "px-3 py-2 text-sm rounded-lg font-bold cursor-default",
                                    "flex items-center justify-center gap-1",
                                    "min-w-[80px]",
                                    "transition-all duration-100",
                                    
                                    // Mastery colors - exact match with regular grid
                                    level >= 5 && "bg-gradient-to-br from-amber-400 to-orange-500 text-white",
                                    level === 4 && "bg-purple-500 text-white",
                                    level === 3 && "bg-purple-500 text-white",
                                    level === 2 && "bg-cyan-500 text-white", 
                                    level === 1 && "bg-cyan-500 text-white",
                                    (level === 0 || !mastery) && "bg-gray-600 text-gray-300",
                                    
                                    // Hover effect - bright and floaty!
                                    "hover:brightness-110 hover:shadow-xl hover:z-10"
                                  )}
                                >
                                  <span>{fact.left}</span>
                                  <span className="text-xs opacity-70">÷</span>
                                  <span>{fact.right}</span>
                                  <span className="text-xs opacity-70">=</span>
                                  <span>{Math.floor(result)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
