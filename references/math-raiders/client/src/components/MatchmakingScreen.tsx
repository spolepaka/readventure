
import { useGameStore } from '../store/gameStore';
import { useShallow } from 'zustand/react/shallow';
import { Copy, Check, Skull, ChevronDown } from 'lucide-react';
import { useState, useMemo, useEffect, useRef } from 'react';
import { RankGem } from './RankGem';
import { BOSS_CONFIG, BOSS_ICONS, BOSS_HP, isAdaptiveBoss, getBossVisual, getBossConfig } from '../game/bosses/bossConfig';
import { useUnlockedBosses } from '../hooks/useUnlockedBosses';

// localStorage key for leader's boss preference
const BOSS_PREF_KEY = 'mathRaidersQuickPlayBoss';

export function MatchmakingScreen() {
  const [copied, setCopied] = useState(false);
  const [showBossSelector, setShowBossSelector] = useState(false);
  const bossSelectorRef = useRef<HTMLDivElement>(null);
  
  // Close dropdown on click outside or ESC
  useEffect(() => {
    if (!showBossSelector) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (bossSelectorRef.current && !bossSelectorRef.current.contains(e.target as Node)) {
        setShowBossSelector(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowBossSelector(false);
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showBossSelector]);
  
  // Data that changes - use useShallow
  const { currentRaid, raidPlayers, currentPlayer, performanceHistory } = useGameStore(
    useShallow(state => ({
      currentRaid: state.currentRaid,
      raidPlayers: state.raidPlayers,
      currentPlayer: state.currentPlayer,
      performanceHistory: state.performanceHistory
    }))
  );
  
  // Derive selected visual from raid's boss_level (server is source of truth)
  const selectedBossVisual = currentRaid ? getBossVisual(currentRaid.bossLevel) : 0;
  
  // Stable actions
  // Use selectors to prevent re-renders
  const toggleReady = useGameStore(state => state.toggleReady);
  const startRaidManual = useGameStore(state => state.startRaidManual);
  const leaveRaid = useGameStore(state => state.leaveRaid);
  const setBossVisual = useGameStore(state => state.setBossVisual);
  const setMasteryBoss = useGameStore(state => state.setMasteryBoss);
  
  // Get stable player ID
  const playerId = useGameStore(state => state.playerId);
  
  // Calculate unlocked bosses (adaptive vs fixed have different rules)
  const isCurrentRaidAdaptive = currentRaid ? isAdaptiveBoss(currentRaid.bossLevel) : true;
  const leaderRaidPlayer = raidPlayers.find(rp => rp.isLeader);
  const unlockedBosses = useUnlockedBosses(isCurrentRaidAdaptive, currentPlayer, leaderRaidPlayer, performanceHistory);
  
  const currentRaidPlayer = raidPlayers.find(rp => 
    rp.playerId === playerId
  );
  
  const isLeader = currentRaidPlayer?.isLeader ?? false;
  const isReady = currentRaidPlayer?.isReady ?? false;

  // Restore leader's saved boss preference when becoming leader of a new raid
  const raidId = currentRaid?.id;
  const raidBossLevel = currentRaid?.bossLevel;
  useEffect(() => {
    // Only restore if: leader, adaptive mode, still at default (0)
    if (!isLeader || raidBossLevel === undefined || !isAdaptiveBoss(raidBossLevel)) return;
    if (raidBossLevel !== 0) return; // Already set, don't override
    
    const saved = localStorage.getItem(BOSS_PREF_KEY);
    if (saved !== null) {
      const visual = parseInt(saved, 10);
      if (!isNaN(visual) && visual >= 0 && visual <= 8) {
        setBossVisual(visual);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeader, raidId]); // Only trigger on leader status or new raid, not bossLevel changes

  // Stats calculated from raidPlayers data
  const activePlayers = raidPlayers.filter(p => p.isActive);

  // Scaled HP: base HP × player count (derived, not stored)
  const scaledHp = useMemo(() => {
    const base = BOSS_HP[currentRaid?.bossLevel ?? 0] ?? 0;
    return base * Math.max(1, activePlayers.length);
  }, [currentRaid?.bossLevel, activePlayers.length]);

  // Check if all active players are ready
  const allReady = activePlayers.length >= 2 && activePlayers.every(rp => rp.isReady);

  // Loading state - raid data not yet loaded
  if (!currentRaid) {
    return (
      <div className="ui-card-surface p-8 max-w-2xl w-full mx-auto shadow-2xl">
        <div className="text-center space-y-6">
          <div className="text-4xl animate-pulse">⚔️</div>
          <p className="text-white/80 text-xl mb-2">Preparing battle calculations...</p>
          <p className="ui-muted text-sm">Get ready!</p>
        </div>
      </div>
    );
  }

  const handleToggleReady = () => {
    if (!playerId) {
      return;
    }
    toggleReady();
  };

  const copyRoomCode = async () => {
    if (!currentRaid?.roomCode) return;
    
    try {
      // Modern clipboard API (works in HTTPS)
      await navigator.clipboard.writeText(currentRaid.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for HTTP/iframe contexts
      const input = document.createElement('input');
      input.value = currentRaid.roomCode;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-gradient-to-b from-indigo-900/40 to-slate-900/60 border border-indigo-500/20 rounded-2xl p-6 sm:p-8 max-w-2xl w-full mx-4 sm:mx-auto shadow-xl shadow-indigo-500/10">
      <div className="text-center mb-6">
        <h2 className="text-3xl font-bold text-white mb-5 font-game">Your Squad</h2>
        {currentRaid?.roomCode && (
          <div className="flex items-center justify-center gap-3 bg-black/30 rounded-xl px-4 py-3 border border-indigo-400/30">
            <span className="text-indigo-300/60 text-sm">Code:</span>
            <span className="text-3xl font-black text-yellow-300 tracking-[0.2em] font-game drop-shadow-lg">
              {currentRaid.roomCode}
            </span>
            <button
              onClick={copyRoomCode}
              className="ml-2 p-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 
                         border border-indigo-400/30 transition-all"
              title="Copy code"
            >
              {copied ? (
                <Check className="w-5 h-5 text-green-400" />
              ) : (
                <Copy className="w-5 h-5 text-indigo-300" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Boss preview - clickable for leader */}
      {currentRaid && (() => {
        // Hoist isAdaptive check once for the entire block (React best practice 7.4)
        const isAdaptive = isAdaptiveBoss(currentRaid.bossLevel);
        const displayBoss = isAdaptive ? selectedBossVisual : currentRaid.bossLevel;
        const bossIcon = BOSS_ICONS[displayBoss];
        
        return (
        <div className="mb-5 relative" ref={bossSelectorRef}>
          <div 
            onClick={() => isLeader && setShowBossSelector(!showBossSelector)}
            className={`flex items-center justify-between bg-gradient-to-r from-red-900/30 to-orange-900/20 rounded-xl px-4 py-3 border border-red-500/20 ${
              isLeader ? 'cursor-pointer hover:border-red-400/40 transition-colors' : ''
            }`}
          >
          <div className="flex items-center gap-2">
              {bossIcon ? (() => {
                const BossIcon = bossIcon.icon as React.ComponentType<{ className?: string }>;
                return <BossIcon className={`w-5 h-5 ${bossIcon.color} drop-shadow-[0_0_6px_rgba(248,113,113,0.6)]`} />;
              })() : <Skull className="w-5 h-5 text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.6)]" />}
            <span className="text-white/50 text-sm">Boss:</span>
            <span className="text-white font-bold font-game">
                {getBossConfig(isAdaptive ? selectedBossVisual : currentRaid.bossLevel).name}
            </span>
              {isLeader && (
                <ChevronDown className={`w-4 h-4 text-white/50 transition-transform ${showBossSelector ? 'rotate-180' : ''}`} />
              )}
          </div>
          
            {!isAdaptive ? (
            <span className="text-red-400 text-sm font-bold tabular-nums">
              {scaledHp.toLocaleString()} HP
            </span>
          ) : (
            <span className="px-2 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300 text-xs font-medium">
              ⚡ Adaptive
            </span>
          )}
          </div>
          
          {/* Boss selector dropdown - leader only */}
          {showBossSelector && isLeader && (() => {
            const bossOptions = isAdaptive
              ? [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(id => unlockedBosses[id])
              : [1, 2, 3, 4, 5, 6, 7, 8].filter(id => unlockedBosses[id]);
            const currentSelection = isAdaptive ? selectedBossVisual : currentRaid.bossLevel;
            
            return (
              <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-blue-500/30 rounded-xl p-2 z-50 shadow-xl shadow-black/50">
                {bossOptions.map(id => {
                  const boss = BOSS_ICONS[id];
                  const BossIcon = boss.icon as React.ComponentType<{ className?: string }>;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        if (isAdaptive) {
                          setBossVisual(id);
                          localStorage.setItem(BOSS_PREF_KEY, String(id));
                        } else {
                          setMasteryBoss(id);
                        }
                        setShowBossSelector(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        currentSelection === id ? 'bg-blue-500/20 border border-blue-400/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <BossIcon className={`w-5 h-5 ${boss.color}`} />
                      <span className="text-white font-medium">{BOSS_CONFIG[id]?.name}</span>
                      {!isAdaptive && (
                        <span className="text-red-400/70 text-xs ml-auto mr-2">
                          {((BOSS_HP[id] ?? 0) * raidPlayers.filter(rp => rp.isActive).length).toLocaleString()} HP
                        </span>
                      )}
                      {currentSelection === id && <span className="text-emerald-400">✓</span>}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
        );
      })()}

      {/* Players Joined */}
      <div className="bg-black/20 rounded-xl p-5 mb-5 border border-indigo-500/20">
        <div className="space-y-3 relative z-10">
          {raidPlayers.filter(p => p.isActive).map((player) => {
            const isCurrentPlayer = player.playerId === playerId;
            
            // IDIOMATIC: Use denormalized name directly from raid_player
            const playerName = player.playerName;
            
            return (
              <div key={player.playerId} 
                   className={`flex items-center px-3 py-2 rounded-lg transition-all ${
                     player.isReady 
                       ? 'bg-emerald-500/10 border-l-4 border-emerald-400' 
                       : isCurrentPlayer ? 'bg-white/5' : ''
                   }`}>
                {/* Left: Crown + Name */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-5 flex-shrink-0">
                    {player.isLeader && <span className="text-base">👑</span>}
                </div>
                  <span className="text-white font-medium truncate">
                    {playerName}
                    {isCurrentPlayer && <span className="text-white/50 text-xs ml-1">(you)</span>}
                    </span>
                </div>
                
                {/* Center: Grade + Rank */}
                <div className="flex items-center gap-1.5 text-xs text-gray-400 mx-4">
                  <span>{player.grade === 0 ? 'K' : `G${player.grade}`}</span>
                  <span className="text-white/20">•</span>
                      <RankGem rank={(player.rank || 'bronze') as 'bronze' | 'silver' | 'gold' | 'diamond' | 'legendary'} size="xs" animate={false} className="opacity-80" />
                        <span className="text-white capitalize">{player.rank || 'Bronze'}</span>
                  {player.division && <span className="text-gray-500">{player.division}</span>}
                </div>
                
                {/* Right: Ready indicator */}
                <div className={`w-5 text-center flex-shrink-0 ${player.isReady ? 'text-emerald-400' : 'text-white/40'}`}>
                  {player.isReady ? '✓' : '○'}
                </div>
              </div>
            );
          })}

        </div>

        {/* Player Count - one line */}
        <div className="mt-4 pt-3 border-t border-indigo-500/20 text-center text-sm">
          <span className="text-indigo-300">{activePlayers.length}/10</span>
          <span className="text-white/30 mx-2">•</span>
          <span className={activePlayers.length < 2 ? 'text-yellow-400' : 'text-white/50'}>
            {activePlayers.length < 2 
              ? `Need ${2 - activePlayers.length} more to start!`
              : `${10 - activePlayers.length} spots open`}
          </span>
        </div>
      </div>


      {/* Action Buttons */}
      <div className="space-y-2">
        {/* Ready Button */}
        {!isLeader && (
          <button
            onClick={handleToggleReady}
            className={`w-full py-4 rounded-xl font-bold text-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] ${
              isReady 
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-400' 
                : 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 hover:bg-indigo-400'
            }`}
          >
            {isReady ? "READY ✓" : "READY!"}
          </button>
        )}
        
        {/* Status message for non-leaders */}
        {!isLeader && allReady && (
          <p className="text-center text-white/40 text-sm">
            Waiting for {activePlayers.find(p => p.isLeader)?.playerName} to start...
          </p>
        )}

        {/* Leader Buttons - one primary action at a time */}
        {isLeader && (
          <>
            {/* Step 1: Ready button (until leader is ready) */}
            {!isReady && (
              <button
                onClick={handleToggleReady}
                className="w-full py-4 rounded-xl font-bold text-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 hover:bg-indigo-400 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                READY!
              </button>
            )}
            
            {/* Step 2: After leader ready - waiting or start */}
            {isReady && !(allReady && activePlayers.length >= 2) && (
              <button
                onClick={handleToggleReady}
                className="w-full py-4 rounded-xl font-bold text-xl bg-emerald-600/50 text-white/90 border border-emerald-500/30 hover:bg-emerald-600/40 transition-all"
              >
                READY ✓ <span className="text-white/50 text-sm font-normal ml-2">tap to unready</span>
              </button>
            )}
            
            {/* Step 3: Everyone ready - START! */}
            {isReady && allReady && activePlayers.length >= 2 && (
              <div className="space-y-2">
                <button
                  onClick={startRaidManual}
                  className="w-full py-4 rounded-xl font-bold text-xl bg-gradient-to-r from-emerald-500 to-green-400 text-white shadow-lg shadow-emerald-500/40 hover:from-emerald-400 hover:to-green-300 animate-pulse hover:animate-none hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  ⚔️ START RAID!
                </button>
                <button
                  onClick={handleToggleReady}
                  className="w-full text-white/40 hover:text-white/60 text-sm transition-colors"
                >
                  wait, not ready
                </button>
              </div>
            )}
          </>
        )}

        {/* Leave - secondary action, visible but not competing */}
        <button
          onClick={leaveRaid}
          className="w-full py-3 rounded-lg text-white/70 hover:text-white 
                     bg-white/5 hover:bg-white/10 border border-white/10 
                     text-sm font-medium transition-all"
        >
          ← Back to Lobby
        </button>
      </div>
    </div>
  );
} 