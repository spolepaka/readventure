import { useState, useEffect } from 'react';
import type { Player, Session, Raid, RaidPlayer } from '../../spacetime';

// Helper to extract Date from timestamp (handles both SDK Timestamp objects and cached JSON format)
function getTimestampDate(ts: unknown): Date | null {
  if (!ts) return null;
  // SDK Timestamp object has .toDate() method
  if (typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  // Cached JSON format has __timestamp_micros_since_unix_epoch__
  const micros = (ts as { __timestamp_micros_since_unix_epoch__?: string | number }).__timestamp_micros_since_unix_epoch__;
  if (micros) {
    return new Date(Number(micros) / 1000);
  }
  return null;
}

const TRACK_NAMES: Record<string, string> = {
  'TRACK12': '+≤10', 'TRACK9': '+0-9', 'TRACK10': '-≤20',
  'TRACK6': '+≤20', 'TRACK8': '-≤20', 'TRACK11': '×0-9',
  'TRACK7': '×0-12', 'TRACK5': '÷0-12', 'ALL': 'Mix',
};

function getTrackName(trackId: string | null | undefined): string {
  return trackId ? (TRACK_NAMES[trackId] || trackId) : '—';
}

function getDisplayName(player: { name?: string | null; email?: string | null }): string {
  if (!player.name) return 'Unknown';
  if (player.name.startsWith('Player') && player.email) {
    const parts = player.email.split('@')[0].split('.');
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  }
  return player.name;
}

interface Props {
  sessions: Session[];
  players: Player[];
  raids: Raid[];
  raidPlayers: RaidPlayer[];
}

export function LiveActivity({ sessions, players, raids, raidPlayers }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Time calculations
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);

  const getLastPlayed = (p: Player) => getTimestampDate(p.lastPlayed);
  
  const todayPlayers = players.filter(p => { const d = getLastPlayed(p); return d && d >= todayStart; });
  const weekPlayers = players.filter(p => { const d = getLastPlayed(p); return d && d >= weekStart; });

  const stats = {
    problems: players.reduce((s, p) => s + (p.totalProblems || 0), 0),
    correct: players.reduce((s, p) => s + (p.totalCorrect || 0), 0),
    raids: players.reduce((s, p) => s + (p.totalRaids || 0), 0),
    lp: players.reduce((s, p) => s + (p.totalAp || 0), 0),
  };
  const accuracy = stats.problems > 0 ? Math.round((stats.correct / stats.problems) * 100) : 0;

  const onlinePlayers = sessions
    .map(s => ({ session: s, player: players.find(p => p.id === s.playerId) }))
    .filter((x): x is { session: Session; player: Player } => !!x.player?.name)
    .filter((x, i, arr) => arr.findIndex(y => y.player.id === x.player.id) === i)
    .sort((a, b) => (b.player.inRaidId ? 1 : 0) - (a.player.inRaidId ? 1 : 0));

  // Separate live raids (InProgress/Paused) from other active raids
  const liveRaids = raids.filter(r => r.state?.tag === 'InProgress' || r.state?.tag === 'Paused');
  const otherActiveRaids = raids.filter(r => r.state?.tag && r.state.tag !== 'InProgress' && r.state.tag !== 'Paused');
  const hasLiveBattle = liveRaids.length > 0;

  const StatCard = ({ value, label, color, emoji }: { value: string | number; label: string; color: string; emoji?: string }) => (
    <div className="text-center p-3">
      <div className="text-3xl font-bold leading-none" style={{ color }}>
        {emoji && <span className="mr-1">{emoji}</span>}
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-[0.6875rem] text-slate-500 mt-2 uppercase tracking-wide">
        {label}
      </div>
    </div>
  );

  const MiniStat = ({ value, label, color }: { value: string | number; label: string; color: string }) => (
    <div className="text-center">
      <div className="text-lg font-semibold" style={{ color }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-[0.5625rem] text-slate-500 uppercase">{label}</div>
    </div>
  );

  // Battle card component for live raids
  const BattleCard = ({ raid }: { raid: Raid }) => {
    const playersInRaid = raidPlayers.filter(rp => rp.raidId === raid.id && rp.isActive);
    const hpPercent = raid.bossMaxHp > 0 ? (raid.bossHp / raid.bossMaxHp) * 100 : 0;
    const hpColor = hpPercent > 50 ? 'text-emerald-400' : hpPercent > 25 ? 'text-amber-400' : 'text-red-500';
    const hpBgColor = hpPercent > 50 ? 'bg-emerald-400' : hpPercent > 25 ? 'bg-amber-400' : 'bg-red-500';
    const isPaused = raid.state?.tag === 'Paused';
    
    // Calculate time remaining
    const isAdaptive = raid.bossLevel === 0 || raid.bossLevel >= 100;
    const timeLimitSec = isAdaptive ? 150 : 120;
    const startedAt = getTimestampDate(raid.startedAt);
    const startedMs = startedAt ? startedAt.getTime() : Date.now();
    const elapsedSec = Math.floor((Date.now() - startedMs) / 1000);
    const remainingSec = Math.max(0, timeLimitSec - elapsedSec);
    const timeColor = isPaused ? 'text-amber-400' : remainingSec <= 30 ? 'text-red-500' : remainingSec <= 60 ? 'text-amber-400' : 'text-emerald-400';
    const timeStr = `${Math.floor(remainingSec / 60)}:${(remainingSec % 60).toString().padStart(2, '0')}`;

    return (
      <div className={`rounded-xl p-4 mb-3 ${isPaused ? 'bg-gradient-to-br from-amber-950 to-slate-900 border border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.2)]' : 'bg-gradient-to-br from-blue-900/50 to-slate-900 border border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]'}`}>
        {/* Header: Boss + Timer */}
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚔️</span>
            <div>
              <div className="text-slate-200 font-semibold">
                Boss Lv{raid.bossLevel}
              </div>
              {raid.roomCode && (
                <div className="text-slate-500 text-xs">Room: {raid.roomCode}</div>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold font-mono ${timeColor}`}>
              {isPaused ? '⏸️' : '⏱️'} {timeStr}
            </div>
            <div className="text-slate-500 text-[0.625rem] uppercase">
              {isPaused ? 'paused' : 'remaining'}
            </div>
          </div>
        </div>

        {/* HP Bar - Big and prominent */}
        <div className="mb-4">
          <div className="flex justify-between mb-1">
            <span className="text-slate-400 text-xs">Boss HP</span>
            <span className={`text-sm font-semibold ${hpColor}`}>{raid.bossHp} / {raid.bossMaxHp}</span>
          </div>
          <div className="h-3 bg-slate-900 rounded-md overflow-hidden">
            <div 
              className={`h-full ${hpBgColor} transition-all duration-300 shadow-[0_0_10px_currentColor]`}
              style={{ width: `${hpPercent}%` }}
            />
          </div>
        </div>

        {/* Players */}
        <div className="grid gap-2">
          {playersInRaid.map(rp => {
            const acc = rp.problemsAnswered > 0 ? Math.round((rp.correctAnswers / rp.problemsAnswered) * 100) : 0;
            const accColor = acc >= 80 ? 'text-emerald-400' : acc >= 60 ? 'text-amber-400' : 'text-red-500';
            return (
              <div key={String(rp.id)} className="grid grid-cols-[1fr_auto] items-center bg-slate-900 rounded-lg px-3 py-2">
                <div>
                  <div className="text-slate-200 font-medium text-sm">{rp.playerName}</div>
                  <div className="text-slate-500 text-[0.6875rem]">{getTrackName(rp.track)}</div>
                </div>
                <div className="flex gap-4 items-center">
                  <div className="text-center">
                    <div className="text-pink-400 font-bold">💥 {rp.damageDealt}</div>
                    <div className="text-slate-500 text-[0.5rem] uppercase">damage</div>
                  </div>
                  <div className="text-center">
                    <div className="text-blue-400 font-semibold text-sm">{rp.correctAnswers}/{rp.problemsAnswered}</div>
                    <div className="text-slate-500 text-[0.5rem] uppercase">correct</div>
                  </div>
                  <div className="text-center">
                    <div className={`font-semibold text-sm ${accColor}`}>{acc}%</div>
                    <div className="text-slate-500 text-[0.5rem] uppercase">acc</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 mb-6 shadow-lg">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-semibold text-slate-200 flex items-center gap-2">
          ⚡ Command Center
        </h2>
        <div className="text-xs text-slate-500">
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </div>
      </div>

      {/* LIVE BATTLES - Shown first and prominently when active */}
      {hasLiveBattle && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-gradient-to-r from-red-500/20 to-transparent rounded-md">
            <span className="text-xl animate-pulse">🔴</span>
            <span className="text-red-500 font-bold text-sm uppercase tracking-widest">
              LIVE BATTLE{liveRaids.length > 1 ? 'S' : ''}
            </span>
          </div>
          {liveRaids.map(raid => <BattleCard key={String(raid.id)} raid={raid} />)}
        </div>
      )}

      {/* Hero Stats */}
      <div className="grid grid-cols-4 gap-2 bg-slate-900 rounded-lg p-4 mb-4">
        <StatCard value={onlinePlayers.length} label="Online Now" color={onlinePlayers.length > 0 ? '#34d399' : '#64748b'} emoji={onlinePlayers.length > 0 ? '🟢' : '⚪'} />
        <StatCard value={todayPlayers.length} label="Today" color="#60a5fa" emoji="📅" />
        <StatCard value={weekPlayers.length} label="This Week" color="#a78bfa" emoji="📊" />
        <StatCard value={liveRaids.length} label="Live Raids" color={hasLiveBattle ? '#f472b6' : '#64748b'} emoji={hasLiveBattle ? '⚔️' : '💤'} />
      </div>

      {/* All-Time Stats */}
      <div className="bg-slate-900 rounded-lg p-4 mb-4">
        <div className="text-[0.625rem] text-slate-500 uppercase tracking-widest mb-3 text-center">
          🏆 All-Time Stats
        </div>
        <div className="grid grid-cols-6 gap-2">
          <MiniStat value={players.length} label="Students" color="#e2e8f0" />
          <MiniStat value={stats.problems} label="Problems" color="#e2e8f0" />
          <MiniStat value={`${accuracy}%`} label="Accuracy" color={accuracy >= 80 ? '#34d399' : '#fbbf24'} />
          <MiniStat value={stats.raids} label="Raids" color="#e2e8f0" />
          <MiniStat value={stats.lp} label="LP Earned" color="#a78bfa" />
          <MiniStat value={Math.round(stats.problems / Math.max(players.length, 1))} label="Avg/Student" color="#60a5fa" />
        </div>
      </div>

      {/* Online Students */}
      {onlinePlayers.length > 0 && (
        <div className="mb-4">
          <div className="text-[0.6875rem] font-semibold text-slate-500 mb-3 uppercase tracking-wide">
            👥 Online Students
          </div>
          <div className="grid gap-2">
            {onlinePlayers.map(({ session, player }) => {
              const isPlaying = !!player.inRaidId && !!raids.find(r => r.id === player.inRaidId && r.state?.tag === 'InProgress');
              const connectedAt = getTimestampDate(session.connectedAt);
              const connectedMs = connectedAt ? connectedAt.getTime() : Date.now();
              const minutesOnline = Math.floor((Date.now() - connectedMs) / 60000);
              return (
                <div key={session.connectionId?.toHexString() || String(player.id)} className={`rounded-lg p-3 ${isPlaying ? 'bg-gradient-to-br from-emerald-900 to-emerald-950 border border-emerald-400' : 'bg-slate-700'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2">
                      <span>{isPlaying ? '⚔️' : '👤'}</span>
                      <span className="text-slate-200 font-medium text-sm">{getDisplayName(player)}</span>
                      <span className="text-slate-500 text-xs">G{player.grade}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium ${isPlaying ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {isPlaying ? 'Playing' : 'Lobby'}
                      </span>
                      <span className="text-slate-500 text-xs">{minutesOnline}m</span>
                    </div>
                  </div>
                  <div className="flex gap-4 text-[0.6875rem] text-slate-500">
                    <span>{player.email || 'No email'}</span>
                    <span>TB: {player.timebackId || '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other Active Raids (Matchmaking, Victory, etc) */}
      {otherActiveRaids.length > 0 && (
        <div>
          <div className="text-[0.6875rem] font-semibold text-slate-500 mb-3 uppercase tracking-wide">
            🎮 Other Raids
          </div>
          {otherActiveRaids.slice(0, 5).map((raid) => {
            const playersInRaid = raidPlayers.filter(rp => rp.raidId === raid.id && rp.isActive);
            const stateEmoji: Record<string, string> = {
              'Paused': '⏸️', 'Victory': '🎉', 'Failed': '💀',
              'Matchmaking': '👥', 'Countdown': '🔢', 'Rematch': '🔄'
            };
            const stateColorClass: Record<string, string> = {
              'Paused': 'text-amber-400', 'Victory': 'text-emerald-400', 'Failed': 'text-red-500',
              'Matchmaking': 'text-slate-400', 'Countdown': 'text-blue-400', 'Rematch': 'text-amber-400'
            };

            return (
              <div key={String(raid.id)} className="bg-slate-900 rounded-lg px-3 py-2 mb-2 flex justify-between items-center">
                <span className="text-slate-400 text-[0.8125rem]">
                  Lv{raid.bossLevel} {raid.roomCode && `(${raid.roomCode})`} • {playersInRaid.map(rp => rp.playerName).join(', ')}
                </span>
                <span className={`text-xs font-semibold ${stateColorClass[raid.state?.tag || ''] || 'text-slate-500'}`}>
                  {stateEmoji[raid.state?.tag || ''] || '❓'} {raid.state?.tag}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {onlinePlayers.length === 0 && liveRaids.length === 0 && otherActiveRaids.length === 0 && (
        <div className="text-center p-8 text-slate-500">
          <div className="text-3xl mb-2">😴</div>
          <div>No students online right now</div>
        </div>
      )}
    </div>
  );
}
