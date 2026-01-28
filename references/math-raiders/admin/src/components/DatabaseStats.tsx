import { useMemo } from 'react';
import type { Player, FactMastery, PerformanceSnapshot } from '../../spacetime';

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

function getDisplayName(player: { name?: string | null; email?: string | null }): string {
  if (!player.name) return 'Unknown';
  if (player.name.startsWith('Player') && player.email) {
    const emailName = player.email.split('@')[0];
    const parts = emailName.split('.');
    const firstName = parts[0];
    return firstName.charAt(0).toUpperCase() + firstName.slice(1);
  }
  return player.name;
}

// Track ID → what they're practicing
const TRACK_NAMES: Record<string, string> = {
  'TRACK12': '+≤10', 'TRACK9': '+0-9', 'TRACK10': '-≤20',
  'TRACK6': '+≤20', 'TRACK8': '-≤20', 'TRACK11': '×0-9',
  'TRACK7': '×0-12', 'TRACK5': '÷0-12', 'ALL': 'Mix',
};

function getTrackDisplay(trackId: string | null | undefined): string {
  if (!trackId) return '-';
  return TRACK_NAMES[trackId] || trackId;
}

function getRankEmoji(rank: string | null | undefined): string {
  if (!rank) return '·';
  switch (rank) {
    case 'legendary': return '👑';
    case 'diamond': return '💎';
    case 'platinum': return '⭐';
    case 'gold': return '🥇';
    case 'silver': return '🥈';
    case 'bronze': return '🥉';
    default: return '·';
  }
}

interface Props {
  players: Player[];
  factMasteries: FactMastery[];
  performanceSnapshots: PerformanceSnapshot[];
}

export function DatabaseStats({ players, factMasteries, performanceSnapshots }: Props) {
  // Memoize expensive calculations - only recompute when data changes
  const playerStats = useMemo(() => {
    const now = new Date();
    const austinToday = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
    
    // Pre-index snapshots and facts by player_id for O(1) lookup instead of O(n) filter per player
    const snapshotsByPlayer = new Map<string, PerformanceSnapshot[]>();
    for (const s of performanceSnapshots) {
      const arr = snapshotsByPlayer.get(s.playerId) || [];
      arr.push(s);
      snapshotsByPlayer.set(s.playerId, arr);
    }
    
    const factsByPlayer = new Map<string, FactMastery[]>();
    for (const f of factMasteries) {
      const arr = factsByPlayer.get(f.playerId) || [];
      arr.push(f);
      factsByPlayer.set(f.playerId, arr);
    }

    return players.filter((p) => p.id != null && p.name).map((p) => {
      const playerSnapshots = snapshotsByPlayer.get(p.id) || [];
      
      // Total minutes
      const totalMinutes = playerSnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
      
      // Today's minutes
      const todaySnapshots = playerSnapshots.filter((s) => {
        const snapTime = getTimestampDate(s.timestamp);
        if (!snapTime) return false;
        const snapDate = snapTime.toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
        return snapDate === austinToday;
      });
    const todayMinutes = todaySnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
    
    // XP (80%+ accuracy sessions)
    const xpSnapshots = playerSnapshots.filter((s) => {
      const acc = s.problemsAttempted > 0 ? (s.problemsCorrect / s.problemsAttempted) * 100 : 0;
      return acc >= 80;
    });
    const totalXP = xpSnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
    
    // Today's XP
    const todayXPSnapshots = todaySnapshots.filter((s) => {
      const acc = s.problemsAttempted > 0 ? (s.problemsCorrect / s.problemsAttempted) * 100 : 0;
      return acc >= 80;
    });
    const todayXP = todayXPSnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
    
    // Overall accuracy from player stats
    const accuracy = p.totalProblems > 0 ? (p.totalCorrect / p.totalProblems) * 100 : 0;
    
      // Fact mastery breakdown - use pre-indexed map
      const playerFacts = factsByPlayer.get(p.id) || [];
      const mastered = playerFacts.filter((f) => f.masteryLevel >= 5).length;
      const learning = playerFacts.filter((f) => f.masteryLevel > 0 && f.masteryLevel < 5).length;
      const struggling = playerFacts.filter((f) => f.masteryLevel === 0).length;

      return {
        ...p,
        displayName: getDisplayName(p),
        totalMinutes,
        todayMinutes,
        totalXP,
        todayXP,
        accuracy,
        mastered,
        learning,
        struggling,
      };
    }).sort((a, b) => b.todayMinutes - a.todayMinutes);
  }, [players, factMasteries, performanceSnapshots]);

  // Last 10 snapshots sorted by timestamp (most recent first)
  const recentSnapshots = useMemo(() => {
    const playerMap = new Map(players.map(p => [p.id, p]));
    
    return [...performanceSnapshots]
      .sort((a, b) => {
        const dateA = getTimestampDate(a.timestamp)?.getTime() ?? 0;
        const dateB = getTimestampDate(b.timestamp)?.getTime() ?? 0;
        return dateB - dateA;
      })
      .slice(0, 25)
      .map(s => ({
        ...s,
        playerName: getDisplayName(playerMap.get(s.playerId) || { name: 'Unknown' }),
        time: getTimestampDate(s.timestamp),
        accuracy: s.problemsAttempted > 0 ? Math.round((s.problemsCorrect / s.problemsAttempted) * 100) : 0,
        cqpm: s.sessionSeconds > 0 ? Math.round((s.problemsCorrect / s.sessionSeconds) * 60) : 0,
      }));
  }, [performanceSnapshots, players]);

  return (
    <div className="bg-slate-800 rounded-lg p-6 mb-6">
      <h2 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wide">
        Database Stats
      </h2>

      {/* Summary */}
      <div className="font-mono mb-4 text-slate-400">
        👥 Players: {players.length} • 📊 Fact Mastery: {factMasteries.length} • 📈 Snapshots: {performanceSnapshots.length}
      </div>

      {/* Recent Snapshots */}
      <h3 className="text-xs font-semibold text-slate-500 mb-3 uppercase">
        Last 25 Raids
      </h3>
      <div className="font-mono text-xs mb-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-slate-500 text-left border-b border-slate-700">
              <th className="py-1 pr-2">Time</th>
              <th className="py-1 pr-2">Player</th>
              <th className="py-1 pr-2">G</th>
              <th className="py-1 pr-2">Track</th>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Boss</th>
              <th className="py-1 pr-2">Score</th>
              <th className="py-1 pr-2">Acc</th>
              <th className="py-1 pr-2">CQPM</th>
              <th className="py-1 pr-2">Dmg</th>
              <th className="py-1 pr-2">Dur</th>
              <th className="py-1">W</th>
            </tr>
          </thead>
          <tbody>
            {recentSnapshots.map((s) => (
              <tr key={s.id} className="border-b border-slate-700/50">
                <td className="py-1 pr-2 text-slate-500">
                  {s.time?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' }) || '??:??'}
                </td>
                <td className="py-1 pr-2 text-slate-200 max-w-24 truncate">{s.playerName}</td>
                <td className="py-1 pr-2 text-slate-400">{s.grade}</td>
                <td className="py-1 pr-2 text-violet-400" title={s.track || undefined}>{getTrackDisplay(s.track)}</td>
                <td className="py-1 pr-2 text-slate-400">{s.raidType === 'solo' ? 'S' : s.raidType === 'multiplayer' ? 'M' : '-'}</td>
                <td className="py-1 pr-2 text-orange-400">{s.bossLevel ?? '-'}</td>
                <td className="py-1 pr-2 text-slate-300">{s.problemsCorrect}/{s.problemsAttempted}</td>
                <td className={`py-1 pr-2 ${s.accuracy >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>{s.accuracy}%</td>
                <td className="py-1 pr-2 text-blue-400">{s.cqpm}</td>
                <td className="py-1 pr-2 text-amber-400">{s.damageDealt}</td>
                <td className="py-1 pr-2 text-slate-500">{s.sessionSeconds}s</td>
                <td className={`py-1 ${s.victory ? 'text-emerald-400' : 'text-red-400'}`}>{s.victory ? '✓' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recentSnapshots.length === 0 && (
          <div className="text-slate-500 py-2">No snapshots yet</div>
        )}
      </div>

      {/* Player list */}
      <h3 className="text-xs font-semibold text-slate-500 mb-3 uppercase">
        Players - Sorted by Today's Activity
      </h3>

      <div className="font-mono text-xs">
        {playerStats.map((p) => (
          <div key={String(p.id)} className="py-2 border-b border-slate-700">
            <div>
              <span className="text-slate-200 font-semibold text-sm">{p.displayName}</span>
              {' '}
              <span className="text-violet-400">{Math.round(p.totalMinutes)}min</span>
              {' '}
              <span className="text-amber-400">⭐{Math.round(p.totalXP)} XP</span>
            </div>
            <div className="mt-1">
              <span className="text-slate-400">G{p.grade} {getRankEmoji(p.rank)} {p.rank || 'unranked'}</span>
              <span className="text-slate-300"> • {Math.round(p.accuracy)}%</span>
              <span className="text-slate-400"> • {p.totalRaids} raids</span>
              {p.todayMinutes > 0 && (
                <span className="text-amber-400 ml-2">
                  🕐 {Math.round(p.todayMinutes)}min → {Math.round(p.todayXP)} XP
                </span>
              )}
              <span className="text-emerald-500 ml-2">⭐{p.mastered}</span>
              <span className="text-blue-500"> 🔄{p.learning}</span>
              <span className="text-red-500"> ❌{p.struggling}</span>
            </div>
            <div className="text-[0.7rem] text-slate-500 mt-0.5">
              {p.email || 'no-email'}
            </div>
            {p.timebackId && (
              <div className="text-[0.65rem] text-slate-600 mt-0.5">
                TB: {p.timebackId}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
