import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { Player, PerformanceSnapshot } from '../../spacetime';
import { calculatePlayerXP, type Snapshot } from '../utils/calculateXP';

interface Props {
  players: Player[];
  snapshots: PerformanceSnapshot[];
  isConnected: boolean;
  onLogout: () => void;
}

interface SpeedScore {
  date: string;
  grade: number;
  track: string;
  cqpm: number;
}

interface ANScore {
  date: string;
  cqpm: number;
}

interface TrackBreakdown {
  track: string;
  trackName: string;
  // MR metrics
  startCqpm: number;      // Peak on first day (90s+)
  endCqpm: number;        // Peak on last day (current state)
  peakCqpm: number;       // Best ever (90s+)
  totalMinutes: number;
  accuracy: number;       // Total accuracy for track
  mrRate: number | null;  // MR min / MR CQPM gained
  mrDaily: { date: string; mrMin: number; mrPeakCqpm: number; accuracy: number }[];
  // AN metrics
  anHistory: ANScore[];
  anBefore: ANScore | null;  // Last AN before first MR session
  anAfter: ANScore | null;   // Latest AN after first MR session
  anRate: number | null;     // MR min / AN CQPM gained (the key metric)
}

// Track ID → readable operation name
const TRACK_NAMES: Record<string, string> = {
  'TRACK12': 'Add ≤10',
  'TRACK9': 'Add 0-9',
  'TRACK10': 'Sub ≤20',
  'TRACK6': 'Add ≤20',
  'TRACK8': 'Sub ≤20',
  'TRACK11': 'Mult 0-9',
  'TRACK7': 'Mult 0-12',
  'TRACK5': 'Div 0-12',
  'ALL': 'Mix',
};

// CQPM target per grade (must pass this to complete current track)
function getGradeCQPMTarget(grade: number): number {
  if (grade === 0) return 20;
  if (grade >= 1 && grade <= 3) return 30;
  if (grade === 4) return 35;
  return 40; // G5
}

function getTrackName(trackId: string): string {
  return TRACK_NAMES[trackId] || trackId;
}

function getDisplayName(player: { name?: string | null; email?: string | null }): string {
  if (!player.name) return 'Unknown';
  if (player.name.startsWith('Player') && player.email) {
    const parts = player.email.split('@')[0].split('.');
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }
  return player.name;
}

const getTimestamp = (s: PerformanceSnapshot) => 
  s.timestamp?.__timestamp_micros_since_unix_epoch__ 
    ? Number(s.timestamp.__timestamp_micros_since_unix_epoch__) / 1000 
    : 0;

const getDateStr = (ts: number) => {
  const d = new Date(ts);
  // Use local date, not UTC
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatShortDate = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = `${months[d.getMonth()]} ${d.getDate()}`;
  // Add year if not current year
  return d.getFullYear() !== now.getFullYear() ? `${base} '${String(d.getFullYear()).slice(2)}` : base;
};

const getDateKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

type SortKey = 'displayName' | 'grade' | 'topTrack' | 'activeDays' | 'totalMinutes' | 'minPerDay' | 'accuracy' | 'avgCqpm' | 'peakCqpm' | 'cqpmTarget' | 'totalXP' | 'xpPerDay' | 'lastPlayed';

export function StudentProgress({ players, snapshots, isConnected, onLogout }: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [anScores, setAnScores] = useState<Record<string, SpeedScore[]>>({});
  const [anLoading, setAnLoading] = useState(false);
  const [anError, setAnError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dashboard-sort');
      if (saved) {
        try { return JSON.parse(saved); } catch { /* ignore */ }
      }
    }
    return { key: 'minPerDay', direction: 'desc' };
  });

  useEffect(() => {
    localStorage.setItem('dashboard-sort', JSON.stringify(sortConfig));
  }, [sortConfig]);

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Stable key for players to prevent redundant fetches
  const playerEmails = useMemo(() => 
    players.filter(p => p.email).map(p => p.email).sort().join(','),
    [players]
  );
  
  // Track fetch state to prevent race conditions
  const fetchIdRef = useRef(0);
  const hasFetchedRef = useRef(false);
  
  // Fetch AN Speed Scores for all students in parallel
  // Only shows loading indicator on initial fetch, not refetches
  useEffect(() => {
    if (!playerEmails) return;
    
    const currentFetchId = ++fetchIdRef.current;
    const isInitialFetch = !hasFetchedRef.current;
    let showLoadingTimeout: ReturnType<typeof setTimeout>;
    let minDurationTimeout: ReturnType<typeof setTimeout>;
    let loadingStartTime = 0;
    let cancelled = false;
    
    // Only show loading on initial fetch (150ms delay to avoid flicker)
    if (isInitialFetch) {
      showLoadingTimeout = setTimeout(() => {
        if (!cancelled) {
          setAnLoading(true);
          loadingStartTime = Date.now();
        }
      }, 150);
    }
    
    async function fetchAN() {
      setAnError(null);
      
      try {
        const playersWithEmail = players.filter(p => p.email);
        const emails = playersWithEmail.map(p => p.email!);
        
        // Single batch request to EC2 worker (not Vercel)
        const workerUrl = 'https://lip-jets-approx-pig.trycloudflare.com';
        const res = await fetch(`${workerUrl}/api/get-speed-scores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails }),
        });
        
        // Ignore stale responses
        if (cancelled || currentFetchId !== fetchIdRef.current) return;
        
        if (!res.ok) {
          throw new Error(`Worker returned ${res.status}`);
        }
        
        const scores: Record<string, SpeedScore[]> = await res.json();
        setAnScores(scores);
      } catch (err) {
        if (cancelled || currentFetchId !== fetchIdRef.current) return;
        console.error('Failed to fetch AN scores:', err);
        setAnError('Failed to load AlphaNumbers data');
      } finally {
        if (cancelled || currentFetchId !== fetchIdRef.current) return;
        
        hasFetchedRef.current = true;
        
        // Only manage loading state if this was the initial fetch
        if (isInitialFetch) {
          const elapsed = Date.now() - loadingStartTime;
          const minDuration = 300;
          
          if (loadingStartTime > 0 && elapsed < minDuration) {
            minDurationTimeout = setTimeout(() => {
              if (!cancelled) setAnLoading(false);
            }, minDuration - elapsed);
          } else {
            clearTimeout(showLoadingTimeout);
            setAnLoading(false);
          }
        }
      }
    }
    
    fetchAN();
    
    return () => {
      cancelled = true;
      clearTimeout(showLoadingTimeout);
      clearTimeout(minDurationTimeout);
    };
  }, [playerEmails, players]);

  // Pre-index snapshots by player
  const snapshotsByPlayer = useMemo(() => {
    const map = new Map<string, PerformanceSnapshot[]>();
    for (const s of snapshots) {
      const arr = map.get(s.playerId) || [];
      arr.push(s);
      map.set(s.playerId, arr);
    }
    return map;
  }, [snapshots]);

  // Calculate stats per player
  const playerStats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);

    return players.map(p => {
      const playerSnapshots = snapshotsByPlayer.get(p.id) || [];
      
      // Time calculations
      const totalMinutes = playerSnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
      
      const todaySnapshots = playerSnapshots.filter(s => {
        const ts = getTimestamp(s);
        return ts > 0 && new Date(ts) >= todayStart;
      });
      const todayMinutes = todaySnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
      
      const weekSnapshots = playerSnapshots.filter(s => {
        const ts = getTimestamp(s);
        return ts > 0 && new Date(ts) >= weekStart;
      });
      const weekMinutes = weekSnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
      
      // Total active days (all time, unique dates)
      const allDays = new Set(
        playerSnapshots.map(s => getDateKey(getTimestamp(s))).filter(k => k !== '1970-0-1')
      );
      const activeDays = allDays.size;
      
      // Min/Day (average minutes per active day this week)
      const minPerDay = activeDays > 0 ? totalMinutes / activeDays : 0;
      
      // Current track (most recently practiced)
      const sortedByTime = [...playerSnapshots].sort((a, b) => getTimestamp(b) - getTimestamp(a));
      const topTrack = sortedByTime.length > 0 ? (sortedByTime[0].track || '') : '';
      
      // Meaningful sessions for CURRENT TRACK only (>= 90 seconds)
      const meaningfulSessions = playerSnapshots.filter(s => 
        s.sessionSeconds >= 90 && s.track === topTrack
      );
      
      // Avg CQPM from meaningful sessions on current track
      const totalCorrect = meaningfulSessions.reduce((sum, s) => sum + s.problemsCorrect, 0);
      const totalSeconds = meaningfulSessions.reduce((sum, s) => sum + s.sessionSeconds, 0);
      const avgCqpm = totalSeconds > 0 ? totalCorrect / (totalSeconds / 60) : 0;
      
      // Peak CQPM from meaningful sessions on current track
      const peakCqpm = meaningfulSessions.length > 0
        ? Math.max(...meaningfulSessions.map(s => s.problemsCorrect / (s.sessionSeconds / 60)))
        : 0;
      
      // XP calculation
      const xpSnapshots: Snapshot[] = playerSnapshots.map(s => ({
        playerId: s.playerId,
        track: s.track,
        sessionSeconds: s.sessionSeconds,
        problemsCorrect: s.problemsCorrect,
        problemsAttempted: s.problemsAttempted,
        timestamp: getTimestamp(s),
      }));
      const xpResult = calculatePlayerXP(xpSnapshots);
      
      // Overall accuracy (all sessions)
      const totalAttempted = playerSnapshots.reduce((sum, s) => sum + s.problemsAttempted, 0);
      const allCorrect = playerSnapshots.reduce((sum, s) => sum + s.problemsCorrect, 0);
      const accuracy = totalAttempted > 0 ? (allCorrect / totalAttempted) * 100 : 0;
      
      // Last played
      const lastPlayed = p.lastPlayed?.__timestamp_micros_since_unix_epoch__
        ? new Date(Number(p.lastPlayed.__timestamp_micros_since_unix_epoch__) / 1000)
        : null;

      const cqpmTarget = getGradeCQPMTarget(p.grade);
      
      // Build per-track breakdown for drilldown
      // Only show tracks with MR activity (AN shown alongside, not independently)
      const studentAN = anScores[p.email || ''] || [];
      const trackSet = new Set(playerSnapshots.map(s => s.track));
      const trackBreakdown: TrackBreakdown[] = [];
      
      for (const track of trackSet) {
        const trackSnapshots = playerSnapshots
          .filter(s => s.track === track && s.sessionSeconds >= 90)
          .sort((a, b) => getTimestamp(a) - getTimestamp(b));
        
        const allTrackSnapshots = playerSnapshots.filter(s => s.track === track);
        const trackMinutes = allTrackSnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
        const trackCorrect = allTrackSnapshots.reduce((sum, s) => sum + s.problemsCorrect, 0);
        const trackAttempted = allTrackSnapshots.reduce((sum, s) => sum + s.problemsAttempted, 0);
        const trackAccuracy = trackAttempted > 0 ? (trackCorrect / trackAttempted) * 100 : 0;
        
        // Get AN data for this track (always shown if track has any MR activity)
        const trackAN = studentAN
          .filter(s => s.track === track)
          .sort((a, b) => a.date.localeCompare(b.date));
        
        // MR metrics (only if we have MR data)
        const hasMR = trackSnapshots.length > 0;
        const firstMRDate = hasMR ? getDateStr(getTimestamp(trackSnapshots[0])) : '';
        
        let startCqpm = 0, endCqpm = 0, trackPeakCqpm = 0, mrRate: number | null = null;
        if (hasMR) {
          // Start = peak on first day (MR internal)
          const firstDaySnapshots = trackSnapshots.filter(s => getDateStr(getTimestamp(s)) === firstMRDate);
          startCqpm = Math.max(...firstDaySnapshots.map(s => s.problemsCorrect / (s.sessionSeconds / 60)));
          
          // End = peak on last day (current state)
          const lastMRDate = getDateStr(getTimestamp(trackSnapshots[trackSnapshots.length - 1]));
          const lastDaySnapshots = trackSnapshots.filter(s => getDateStr(getTimestamp(s)) === lastMRDate);
          endCqpm = Math.max(...lastDaySnapshots.map(s => s.problemsCorrect / (s.sessionSeconds / 60)));
          
          // Peak = best ever (MR internal)
          trackPeakCqpm = Math.max(...trackSnapshots.map(s => s.problemsCorrect / (s.sessionSeconds / 60)));
          
          // MR Rate = min per CQPM gained (internal metric)
          const mrCqpmGained = trackPeakCqpm - startCqpm;
          mrRate = mrCqpmGained > 0 ? trackMinutes / mrCqpmGained : null;
        }
        
        // AN for this track
        const anHistory = trackAN.map(s => ({ date: s.date, cqpm: s.cqpm }));
        
        // Baseline = latest AN on or before first MR date (or all if no MR)
        // End = latest AN strictly after first MR date
        const onOrBeforeMR = hasMR ? trackAN.filter(s => s.date <= firstMRDate) : trackAN;
        const afterMR = hasMR ? trackAN.filter(s => s.date > firstMRDate) : [];
        
        const anBefore = onOrBeforeMR.length > 0
          ? { date: onOrBeforeMR[onOrBeforeMR.length - 1].date, cqpm: onOrBeforeMR[onOrBeforeMR.length - 1].cqpm }
          : null;
        
        const anAfter = afterMR.length > 0
          ? { date: afterMR[afterMR.length - 1].date, cqpm: afterMR[afterMR.length - 1].cqpm }
          : null;
        
        // AN Rate = MR min / AN CQPM gained (THE metric Janna uses)
        let anRate: number | null = null;
        if (anBefore && anAfter) {
          const anCqpmGained = anAfter.cqpm - anBefore.cqpm;
          anRate = anCqpmGained > 0 ? trackMinutes / anCqpmGained : null;
        }
        
        // MR daily breakdown
        const mrDailyMap = new Map<string, { mrMin: number; mrPeakCqpm: number; correct: number; attempted: number }>();
        for (const s of allTrackSnapshots) {
          const date = getDateStr(getTimestamp(s));
          const existing = mrDailyMap.get(date) || { mrMin: 0, mrPeakCqpm: 0, correct: 0, attempted: 0 };
          existing.mrMin += s.sessionSeconds / 60;
          existing.correct += s.problemsCorrect;
          existing.attempted += s.problemsAttempted;
          if (s.sessionSeconds >= 90) {
            const cqpm = s.problemsCorrect / (s.sessionSeconds / 60);
            existing.mrPeakCqpm = Math.max(existing.mrPeakCqpm, cqpm);
          }
          mrDailyMap.set(date, existing);
        }
        const mrDaily = Array.from(mrDailyMap.entries())
          .map(([date, data]) => ({ 
            date, 
            mrMin: data.mrMin, 
            mrPeakCqpm: data.mrPeakCqpm,
            accuracy: data.attempted > 0 ? (data.correct / data.attempted) * 100 : 0
          }))
          .sort((a, b) => a.date.localeCompare(b.date));
        
        trackBreakdown.push({
          track,
          trackName: getTrackName(track),
          startCqpm,
          endCqpm,
          peakCqpm: trackPeakCqpm,
          totalMinutes: trackMinutes,
          accuracy: trackAccuracy,
          mrRate,
          mrDaily,
          anHistory,
          anBefore,
          anAfter,
          anRate,
        });
      }
      
      // Sort tracks by most recent activity
      trackBreakdown.sort((a, b) => {
        const aLast = a.mrDaily[a.mrDaily.length - 1]?.date || '';
        const bLast = b.mrDaily[b.mrDaily.length - 1]?.date || '';
        return bLast.localeCompare(aLast);
      });
      
      return {
        ...p,
        displayName: getDisplayName(p),
        totalMinutes,
        todayMinutes,
        weekMinutes,
        activeDays,
        minPerDay,
        topTrack: getTrackName(topTrack),
        topTrackRaw: topTrack,
        avgCqpm,
        peakCqpm,
        cqpmTarget,
        accuracy,
        totalXP: xpResult.totalXP,
        lastPlayed,
        totalRaids: p.totalRaids || 0,
        trackBreakdown,
      };
    }).sort((a, b) => (b.minPerDay || 0) - (a.minPerDay || 0));
  }, [players, snapshotsByPlayer, anScores]);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (players.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg p-8 text-center text-slate-500">
        No students found
      </div>
    );
  }

  const filteredStats = searchTerm
    ? playerStats.filter(p => 
        p.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.email && p.email.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    : playerStats;

  const sortedStats = [...filteredStats].sort((a, b) => {
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    const getValue = (p: typeof a): number | string | Date | null => {
      switch (sortConfig.key) {
        case 'displayName': return p.displayName;
        case 'grade': return p.grade;
        case 'topTrack': return p.topTrack || '';
        case 'activeDays': return p.activeDays;
        case 'totalMinutes': return p.totalMinutes;
        case 'minPerDay': return p.activeDays > 0 ? p.totalMinutes / p.activeDays : 0;
        case 'accuracy': return p.accuracy;
        case 'avgCqpm': return p.avgCqpm;
        case 'peakCqpm': return p.peakCqpm;
        case 'cqpmTarget': return p.cqpmTarget;
        case 'totalXP': return p.totalXP;
        case 'xpPerDay': return p.activeDays > 0 ? p.totalXP / p.activeDays : 0;
        case 'lastPlayed': return p.lastPlayed;
        default: return 0;
      }
    };
    const aVal = getValue(a);
    const bVal = getValue(b);
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return dir * aVal.localeCompare(bVal);
    }
    if (aVal instanceof Date && bVal instanceof Date) {
      return dir * (aVal.getTime() - bVal.getTime());
    }
    return dir * ((aVal as number) - (bVal as number));
  });

  return (
    <div className="space-y-4 w-fit mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Math Raiders - Student Progress</h1>
        <div className="flex items-center gap-4">
          {isConnected ? (
            <span className="text-xs text-emerald-400">● Live</span>
          ) : (
            <span className="text-xs text-amber-400">○ Connecting...</span>
          )}
          <button
            onClick={onLogout}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Search + Loading/Error status */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search students…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
        {anLoading && (
          <div className="text-sm text-slate-400 flex items-center gap-2 whitespace-nowrap">
            <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        )}
        {anError && (
          <div className="text-sm text-red-400 whitespace-nowrap">{anError}</div>
        )}
      </div>
      <div className="bg-slate-800 rounded-lg overflow-x-auto">
        <table className="[font-variant-numeric:tabular-nums]">
          <thead className="bg-slate-700 sticky top-0 z-10">
            <tr className="text-xs text-slate-400 uppercase">
              <th className="w-6 bg-slate-700"></th>
              <th className="text-left px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('displayName')}>
                Student {sortConfig.key === 'displayName' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('grade')}>
                Grade {sortConfig.key === 'grade' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('topTrack')}>
                Track {sortConfig.key === 'topTrack' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('activeDays')}>
                Days {sortConfig.key === 'activeDays' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('totalMinutes')}>
                Mins {sortConfig.key === 'totalMinutes' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('minPerDay')}>
                Min/Day {sortConfig.key === 'minPerDay' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('accuracy')}>
                Accuracy {sortConfig.key === 'accuracy' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('avgCqpm')} title="Average CQPM from raids ≥90 seconds">
                Avg CQPM (90s+) {sortConfig.key === 'avgCqpm' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('peakCqpm')} title="Best CQPM from raids ≥90 seconds">
                Peak CQPM (90s+) {sortConfig.key === 'peakCqpm' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-center px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('cqpmTarget')} title="CQPM needed to pass current track">
                Target {sortConfig.key === 'cqpmTarget' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
              <th className="text-right px-4 py-3 cursor-pointer hover:text-white whitespace-nowrap bg-slate-700" onClick={() => handleSort('lastPlayed')}>
                Last Played {sortConfig.key === 'lastPlayed' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {sortedStats.map(p => {
              const isExpanded = expandedRows.has(p.id);
              
              return (
                <React.Fragment key={p.id}>
                  <tr 
                    className="hover:bg-slate-700/30 cursor-pointer"
                    onClick={() => toggleRow(p.id)}
                  >
                    <td className="w-6 pl-2 text-slate-500 text-sm">
                      {isExpanded ? '▼' : '▶'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{p.displayName}</div>
                      <div className="text-xs text-slate-500">{p.email}</div>
                    </td>
                    <td className="text-center px-4 py-3 text-slate-300">
                      {p.grade === 0 ? 'K' : `G${p.grade}`}
                    </td>
                    <td className="text-center px-4 py-3 text-slate-300 whitespace-nowrap">
                      {p.topTrack || '—'}
                    </td>
                    <td className="text-center px-4 py-3 text-slate-300">
                      {p.activeDays}
                    </td>
                    <td className="text-center px-4 py-3 text-slate-300">
                      {Math.round(p.totalMinutes)}
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className={
                        p.activeDays > 0 && (p.totalMinutes / p.activeDays) > 10 ? 'text-emerald-400' : 
                        p.activeDays > 0 && (p.totalMinutes / p.activeDays) >= 6 ? 'text-amber-400' : 
                        p.activeDays > 0 ? 'text-red-400' :
                        'text-slate-500'
                      }>
                        {p.activeDays > 0 ? (p.totalMinutes / p.activeDays).toFixed(1) : '—'}
                      </span>
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className={p.accuracy >= 80 ? 'text-emerald-400' : 'text-red-400'}>
                        {p.accuracy > 0 ? `${Math.round(p.accuracy)}%` : '—'}
                      </span>
                    </td>
                    <td className="text-center px-4 py-3 text-slate-300">
                      {p.avgCqpm > 0 ? p.avgCqpm.toFixed(1) : '—'}
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className={p.peakCqpm >= p.cqpmTarget ? 'text-emerald-400 font-medium' : 'text-slate-300'}>
                        {p.peakCqpm > 0 ? p.peakCqpm.toFixed(1) : '—'}
                      </span>
                      {p.peakCqpm >= p.cqpmTarget && p.peakCqpm > 0 && (
                        <span className="ml-1 text-emerald-400">✓</span>
                      )}
                    </td>
                    <td className="text-center px-4 py-3 text-slate-500">
                      {p.cqpmTarget}
                    </td>
                    <td className="text-right px-4 py-3 whitespace-nowrap">
                      <span className={p.lastPlayed && formatRelativeTime(p.lastPlayed) === 'Today' ? 'text-emerald-400' : 'text-slate-500'}>
                        {p.lastPlayed ? formatRelativeTime(p.lastPlayed) : '—'}
                      </span>
                    </td>
                  </tr>
                  {/* Expanded Drilldown */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={12} className="p-0">
                        <div className="bg-slate-900/50 px-6 py-4 space-y-4">
                          {p.trackBreakdown.map(track => (
                            <div key={track.track} className="bg-slate-800 rounded-lg overflow-hidden">
                              <div className="bg-slate-700/50 px-4 py-2 flex items-center gap-6 text-xs text-slate-400">
                                <span className="text-sm font-medium text-white whitespace-nowrap">{track.trackName}</span>
                                <span className="text-slate-300">
                                  {track.mrDaily.length} days, {Math.round(track.totalMinutes)} min, {Math.round(track.accuracy)}%
                                </span>
                                <span>
                                  AlphaNumbers: {track.anBefore ? `${Math.round(track.anBefore.cqpm)} (${formatShortDate(track.anBefore.date)})` : '—'}
                                  {track.anAfter && track.anAfter.date !== track.anBefore?.date && (
                                    <> → {Math.round(track.anAfter.cqpm)} ({formatShortDate(track.anAfter.date)})</>
                                  )}
                                  {track.anRate && track.anBefore && track.anAfter && (
                                    <span className="ml-2">
                                      | {Math.round(track.totalMinutes)} min / {Math.round(track.anAfter.cqpm - track.anBefore.cqpm)} CQPM = <span className="text-emerald-400">{track.anRate.toFixed(1)} min/CQPM</span>
                                    </span>
                                  )}
                                </span>
                                <span>
                                  MathRaiders: {track.startCqpm.toFixed(0)}
                                  {track.endCqpm !== track.startCqpm && ` → ${track.endCqpm.toFixed(0)}`}
                                  {track.peakCqpm > track.endCqpm && ` (peak ${track.peakCqpm.toFixed(0)})`}
                                </span>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                                {/* MR Practice */}
                                <div>
                                  <div className="text-xs text-slate-500 mb-2">MR Practice</div>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-xs text-slate-400">
                                        <th className="text-left py-1">Date</th>
                                        <th className="text-center py-1">Mins</th>
                                        <th className="text-center py-1">Peak</th>
                                        <th className="text-center py-1">Acc</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {track.mrDaily.map(day => (
                                        <tr key={day.date} className="border-t border-slate-700/30">
                                          <td className="py-1 text-slate-300">{day.date}</td>
                                          <td className="text-center py-1 text-slate-300">{day.mrMin.toFixed(1)}</td>
                                          <td className="text-center py-1 text-slate-300">
                                            {day.mrPeakCqpm > 0 ? day.mrPeakCqpm.toFixed(1) : '—'}
                                          </td>
                                          <td className="text-center py-1">
                                            <span className={day.accuracy >= 80 ? 'text-emerald-400' : 'text-red-400'}>
                                              {day.accuracy > 0 ? `${Math.round(day.accuracy)}%` : '—'}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                
                                {/* AN History */}
                                <div>
                                  <div className="text-xs text-slate-500 mb-2">AN History</div>
                                  {track.anHistory.length > 0 ? (
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="text-xs text-slate-400">
                                          <th className="text-left py-1">Date</th>
                                          <th className="text-center py-1">CQPM</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {track.anHistory.map((an, i) => (
                                          <tr key={i} className="border-t border-slate-700/30">
                                            <td className="py-1 text-slate-300">{an.date}</td>
                                            <td className="text-center py-1">
                                              <span className={an.cqpm >= p.cqpmTarget ? 'text-emerald-400 font-semibold' : 'text-amber-400'}>
                                                {Math.round(an.cqpm)}{an.cqpm >= p.cqpmTarget ? ' ✓' : ''}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div className="text-slate-500 text-sm">No AN data</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate() - 1);
  
  if (date >= todayStart) {
    return 'Today';
  } else if (date >= yesterdayStart) {
    return 'Yesterday';
  } else {
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }
}
