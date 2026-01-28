import { useMemo, memo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RaidPlayerRow, RaidRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type RaidPlayer = Infer<typeof RaidPlayerRow>;
type Raid = Infer<typeof RaidRow>;

interface SquadUIProps {
  raidPlayers: RaidPlayer[];
  currentIdentity?: string;
  getPlayerName: (playerId: string) => string;
  currentRaid?: Raid | null;
  raidClientStartTime?: number | null;
  arenaHeight?: number; // For responsive row sizing
}

// Dev-only: Generate fake 10-player raid for UI testing
function generateFakePlayers(): RaidPlayer[] {
  const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
  return names.map((name, i) => ({
    id: BigInt(i),
    playerId: `fake-${i}`,
    raidId: BigInt(1),
    playerName: name,
    grade: 4,
    rank: 'gold',
    division: 'II',
    isActive: true,
    damageDealt: Math.floor(Math.random() * 800) + 200,
    problemsAnswered: Math.floor(Math.random() * 25) + 15,
    correctAnswers: Math.floor(Math.random() * 20) + 10,
    fastestAnswerMs: Math.floor(Math.random() * 2000) + 1000,
    isReady: true,
    isLeader: i === 0,
    recentProblems: '',
    pendingChestBonus: undefined,
    track: undefined
  }));
}

/**
 * Details!-inspired DPS meter
 * Tracks time, damage, and relative performance
 * Numbers update instantly, bars animate smoothly
 */
export const SquadUIMotivational = memo(function SquadUIMotivational({ 
  raidPlayers, 
  currentIdentity, 
  getPlayerName,
  currentRaid,
  raidClientStartTime,
  arenaHeight = 280
}: SquadUIProps) {
  
  // Use dummy tick state to trigger re-renders (same pattern as RaidTimer)
  const [, setTick] = useState(0);
  const [useTestData, setUseTestData] = useState(false);
  const [fakePlayers, setFakePlayers] = useState<RaidPlayer[]>([]);
  
  // Calculate time during render - always accurate, synced with RaidTimer
  const raidTime = raidClientStartTime 
    ? Math.floor((Date.now() - raidClientStartTime) / 1000)
    : 0;
  
  // Generate stable fake players once
  useEffect(() => {
    if (useTestData && import.meta.env.DEV) {
      setFakePlayers(generateFakePlayers());
      
      // Update damage every 3-5 seconds to simulate answering
      const interval = setInterval(() => {
        setFakePlayers(prev => prev.map(p => ({
          ...p,
          damageDealt: p.damageDealt + Math.floor(Math.random() * 100) + 50,
          correctAnswers: p.correctAnswers + Math.floor(Math.random() * 3),
          problemsAnswered: p.problemsAnswered + Math.floor(Math.random() * 3) + 1
        })));
      }, 3000 + Math.random() * 2000); // 3-5 seconds
      
      return () => clearInterval(interval);
    }
  }, [useTestData]);
  
  // Timer update - immediate first update, then every second (synced with RaidTimer)
  useEffect(() => {
    if (!raidClientStartTime) return;
    
    const update = () => setTick(prev => prev + 1);
    
    // Immediate update (no delay)
    update();
    
    // Then update every second
    const interval = setInterval(update, 1000);
    
    return () => clearInterval(interval);
  }, [raidClientStartTime]);
  
  // Use test data in dev mode
  const displayPlayers = useTestData && import.meta.env.DEV ? fakePlayers : raidPlayers;
  const testGetName = (id: string) => {
    const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
    const idx = parseInt(id.split('-')[1] || '0');
    return names[idx] || id;
  };
  const displayGetName = useTestData && import.meta.env.DEV ? testGetName : getPlayerName;
  
  // Build sorted player list - sort on REAL damage for stable rankings
  // Only show active players during live raids
  const sortedPlayers = useMemo(() => {
    return displayPlayers
      .filter(p => p.isActive)
      .map(player => {
        const damage = player.damageDealt;
        const accuracy = player.problemsAnswered > 0 
          ? (player.correctAnswers / player.problemsAnswered) * 100 
          : 0;
        const isMe = !!(currentIdentity && player.playerId === currentIdentity);
        
        // Calculate DPS (damage per second)
        const dps = raidTime > 0 ? damage / raidTime : 0;
        
        return {
          player,
          damage,
          dps,
          isMe,
          accuracy,
        };
      })
      .sort((a, b) => b.damage - a.damage); // Sort on real damage, not animated values
  }, [displayPlayers, currentIdentity, raidTime]);
  
  // Smart scaling: different behavior for solo vs group
  const isSolo = sortedPlayers.length === 1;
  const maxDamage = Math.max(...sortedPlayers.map(p => p.damage), 1);
  const bossMaxHp = useTestData ? 5000 : (currentRaid?.bossMaxHp || 1000);
  
  // Solo: Bar represents boss kill progress (0-100% when boss dies)
  // Group: Bar represents relative performance (top player at 85%)
  const scaleFactor = isSolo 
    ? bossMaxHp  // Solo: Full bar when boss is defeated
    : maxDamage / 0.85; // Group: Top player at 85% width
    
  // Total damage from all active players
  const totalDamage = sortedPlayers.reduce((sum, p) => sum + p.damage, 0);

  // Dynamic display: show all players with adaptive row height
  const playersToShow = sortedPlayers.length; // Everyone included!
  
  // Base row heights optimized for 280px arena (Chromebook)
  const baseRowHeight = sortedPlayers.length === 1 ? 36 :
                        sortedPlayers.length <= 3 ? 34 :
                        sortedPlayers.length <= 5 ? 30 :
                        sortedPlayers.length <= 7 ? 26 :
                        sortedPlayers.length <= 9 ? 22 :
                                                    20;
  
  // Scale with arena size (1.0x at 280px, up to 1.5x at 500px)
  const heightScaleFactor = Math.min(arenaHeight / 280, 1.5);
  const rowHeight = Math.floor(baseRowHeight * heightScaleFactor);

  return (
    <div className={`absolute top-2 left-2 z-10 flex flex-col ${
      isSolo ? 'w-64' : 'w-80'
    }`}>
      {/* Dev-only test button */}
      {import.meta.env.DEV && (
        <button
          onClick={() => setUseTestData(!useTestData)}
          className="absolute -top-8 right-0 px-2 py-1 text-[10px] bg-purple-600 text-white rounded opacity-50 hover:opacity-100"
        >
          {useTestData ? '✓ Test 10' : 'Test 10'}
        </button>
      )}
      
      {/* Header - simplified (timer removed, redundant with main countdown) */}
      <div className="flex items-center gap-2 px-2 py-1 bg-gray-900/90 rounded-t-md border-b border-gray-700/50">
        <div className="text-xs font-bold text-gray-300">
          {isSolo ? 'Performance' : 'Damage Meter'}
        </div>
        {!isSolo && (
          <div className="text-[10px] ml-auto text-gray-500">
            Total: {totalDamage.toLocaleString()}
          </div>
        )}
      </div>
      
      {/* Player rows - with position for animations */}
      <div className="bg-gray-900/80 overflow-hidden">
        <div style={{ height: `${Math.min(sortedPlayers.length, playersToShow) * rowHeight}px` }}>
          {sortedPlayers.slice(0, playersToShow).map((data, index) => {
          const { player, damage, dps, isMe, accuracy } = data;
          const playerName = displayGetName(player.playerId);
          // Details! style - absolute damage scaled to fit, not percentage of top
          const barWidth = Math.min((damage / scaleFactor) * 100, 100);
          
          // Dynamic bar colors
          let barGradient = 'from-gray-600/60 to-gray-500/40';
          
          if (isSolo) {
            // Solo: Progress bar style (green = good progress)
            if (barWidth >= 75) {
              barGradient = 'from-green-600/90 to-green-500/70';
            } else if (barWidth >= 50) {
              barGradient = 'from-blue-600/90 to-blue-500/70';
            } else if (barWidth >= 25) {
              barGradient = 'from-cyan-600/90 to-cyan-500/70';
            } else {
              barGradient = 'from-gray-600/80 to-gray-500/60';
            }
          } else {
            // Multiplayer: Rank-based colors for everyone
            if (index === 0 && damage > 0) {
              barGradient = 'from-yellow-600/90 to-yellow-500/70';
            } else if (index === 1) {
              barGradient = 'from-gray-500/70 to-gray-400/50';
            } else if (index === 2) {
              barGradient = 'from-orange-700/60 to-orange-600/40';
            } else {
              barGradient = 'from-gray-600/60 to-gray-500/40';
            }
          }
          
          return (
            <motion.div
              key={player.playerId}
              layout
              className={`relative w-full overflow-hidden border-b border-gray-800/50 ${index % 2 === 1 ? 'bg-black/10' : ''}`}
              style={{
                height: `${rowHeight}px`,
                zIndex: Math.max(1, 10 - index)  // Always positive, top player highest
              }}
              transition={{
                layout: { 
                  duration: 0.2, 
                  type: "spring", 
                  bounce: 0.1,
                  stiffness: 300,
                  damping: 30
                }
              }}
            >
              {/* Animated bar background */}
              <motion.div 
                className={`
                  absolute inset-y-0 left-0 
                  bg-gradient-to-r ${barGradient}
                `}
                animate={{ 
                  width: `${Math.max(barWidth, 0.1)}%`
                }}
                transition={{ 
                  duration: 0.3, 
                  ease: "easeOut" 
                }}
              />
              
              {/* Content */}
              <div className="relative flex items-center h-full px-2 gap-2">
                {/* Rank - hide in solo */}
                {!isSolo && (
                  <div className={`
                    text-xs font-bold w-4 z-10
                    ${index === 0 && damage > 0 ? 'text-yellow-400' : 
                      index === 1 ? 'text-gray-300' : 
                      index === 2 ? 'text-orange-500' : 'text-gray-500'}
                  `}>
                    {index + 1}
                  </div>
                )}
                
                {/* Name */}
                <div className={`
                  text-xs flex-1 truncate z-10 min-w-[60px]
                  ${isMe ? 'text-cyan-300 font-bold' : 'text-gray-200'}
                `}>
                  {playerName.slice(0, 12)}
                </div>
                
                {/* Damage - bigger in solo, instant update */}
                <div className={`
                  ${isSolo ? 'text-lg' : 'text-sm'} font-bold tabular-nums z-10 min-w-[45px] text-right
                  ${isMe ? 'text-cyan-300' : 'text-white'}
                `}>
                  {damage.toLocaleString()}
                </div>
                
                {/* DPS - show after 5 seconds */}
                {raidTime > 5 && (
                  <div className={`text-[11px] z-10 min-w-[45px] text-right ${
                    isSolo ? 'text-gray-400' : 'text-gray-400'
                  }`}>
                    {dps.toFixed(1)} dps
                  </div>
                )}
                
                {/* Percentage - only for multiplayer */}
                {!isSolo && (
                  <div className="text-[10px] text-gray-500 z-10 w-10 text-right">
                    {damage > 0 ? `${Math.round((damage / maxDamage) * 100)}%` : '0%'}
                  </div>
                )}

              </div>
            </motion.div>
          );
        })}
        </div>
        
        {/* Footer stats - simplified for solo, full for multiplayer */}
        {sortedPlayers.length > 0 && (
          <div className="px-2 py-1 bg-gray-900/60 text-[10px] text-gray-400 rounded-b-md">
            {isSolo ? (
              <div className="text-center">
                Boss Progress: {Math.round((totalDamage / bossMaxHp) * 100)}% defeated
              </div>
            ) : (
              <div className="flex justify-between">
                <span>Raid DPS: {raidTime > 0 ? (totalDamage / raidTime).toFixed(1) : '0'}</span>
                <span>Players: {sortedPlayers.length}</span>
                <span>Avg: {Math.round(totalDamage / Math.max(sortedPlayers.length, 1)).toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});