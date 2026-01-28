import { useState, useEffect, useMemo } from 'react';
import type { Player, PerformanceSnapshot } from '../../spacetime';

interface Props {
  players: Player[];
  snapshots: PerformanceSnapshot[];
}

interface SpeedScore {
  date: string;
  grade: number;
  track: string;
  cqpm: number;
}

interface TrackStats {
  track: string;
  trackName: string;
  startCqpm: number;
  peakCqpm: number;
  totalMinutes: number;
  rate: number | null;
  anFinal: number | null;
  mrDaily: { date: string; mrMin: number; mrPeakCqpm: number }[];
  anHistory: { date: string; cqpm: number }[];
}

interface StudentData {
  email: string;
  name: string;
  currentTrack: string;
  currentTrackName: string;
  currentStart: number;
  currentPeak: number;
  currentRate: number | null;
  totalMinutes: number;
  tracks: TrackStats[];
}

// Track name mapping (matches admin panel)
const TRACK_NAMES: Record<string, string> = {
  'TRACK12': '+≤10',
  'TRACK9': '+0-9',
  'TRACK10': '-≤20',
  'TRACK6': '+≤20',
  'TRACK8': '-≤20',
  'TRACK11': '×0-9',
  'TRACK7': '×0-12',
  'TRACK5': '÷0-12',
  'ALL': 'Mix',
};

const getTimestamp = (s: PerformanceSnapshot) =>
  s.timestamp?.__timestamp_micros_since_unix_epoch__
    ? Number(s.timestamp.__timestamp_micros_since_unix_epoch__) / 1000
    : 0;

const getDateStr = (ts: number) => {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
};

export function CaseStudies({ players, snapshots }: Props) {
  const [anScores, setAnScores] = useState<Record<string, SpeedScore[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch AN Speed Scores for all pilot students
  useEffect(() => {
    async function fetchAN() {
      const scores: Record<string, SpeedScore[]> = {};
      
      for (const player of players) {
        if (!player.email) continue;
        try {
          const res = await fetch(`/api/timeback/speed-scores?email=${encodeURIComponent(player.email)}`);
          if (res.ok) {
            const data = await res.json();
            scores[player.email] = data.speedScores || [];
          }
        } catch (err) {
          console.error(`Failed to fetch AN for ${player.email}:`, err);
        }
      }
      
      setAnScores(scores);
      setLoading(false);
    }
    
    if (players.length > 0) {
      fetchAN();
    }
  }, [players]);

  // Pre-index snapshots by player email
  const snapshotsByEmail = useMemo(() => {
    const map = new Map<string, PerformanceSnapshot[]>();
    for (const s of snapshots) {
      const player = players.find(p => p.id === s.playerId);
      if (!player?.email) continue;
      const arr = map.get(player.email) || [];
      arr.push(s);
      map.set(player.email, arr);
    }
    return map;
  }, [players, snapshots]);

  // Build student data - one entry per student
  const studentData = useMemo(() => {
    const result: StudentData[] = [];
    
    for (const player of players) {
      if (!player.email) continue;
      
      const playerSnapshots = snapshotsByEmail.get(player.email) || [];
      const studentAN = anScores[player.email] || [];
      
      if (playerSnapshots.length === 0) continue;
      
      // Find all unique tracks and build stats for each
      const trackSet = new Set(playerSnapshots.map(s => s.track));
      const tracks: TrackStats[] = [];
      
      // Find current (most recent) track
      const sortedSnapshots = [...playerSnapshots].sort((a, b) => getTimestamp(b) - getTimestamp(a));
      const currentTrack = sortedSnapshots[0]?.track || '';
      
      let totalMinutes = 0;
      
      for (const track of trackSet) {
        const trackSnapshots = playerSnapshots
          .filter(s => s.track === track && s.sessionSeconds >= 90)
          .sort((a, b) => getTimestamp(a) - getTimestamp(b));
        
        const allTrackSnapshots = playerSnapshots.filter(s => s.track === track);
        const trackMinutes = allTrackSnapshots.reduce((sum, s) => sum + s.sessionSeconds / 60, 0);
        totalMinutes += trackMinutes;
        
        if (trackSnapshots.length === 0) continue;
        
        // Start = peak on first day
        const firstDayDate = getDateStr(getTimestamp(trackSnapshots[0]));
        const firstDaySnapshots = trackSnapshots.filter(s => getDateStr(getTimestamp(s)) === firstDayDate);
        const startCqpm = Math.max(...firstDaySnapshots.map(s => s.problemsCorrect / (s.sessionSeconds / 60)));
        
        // Peak = best ever
        const peakCqpm = Math.max(...trackSnapshots.map(s => s.problemsCorrect / (s.sessionSeconds / 60)));
        
        // Rate = min per CQPM gained
        const cqpmGained = peakCqpm - startCqpm;
        const rate = cqpmGained > 0 ? trackMinutes / cqpmGained : null;
        
        // AN for this track
        const trackAN = studentAN.filter(s => s.track === track);
        const anHistory = trackAN.map(s => ({ date: s.date, cqpm: s.cqpm }));
        const anFinal = trackAN.length > 0 ? trackAN[trackAN.length - 1].cqpm : null;
        
        // MR daily
        const mrDailyMap = new Map<string, { mrMin: number; mrPeakCqpm: number }>();
        for (const s of allTrackSnapshots) {
          const date = getDateStr(getTimestamp(s));
          const existing = mrDailyMap.get(date) || { mrMin: 0, mrPeakCqpm: 0 };
          existing.mrMin += s.sessionSeconds / 60;
          if (s.sessionSeconds >= 90) {
            const cqpm = s.problemsCorrect / (s.sessionSeconds / 60);
            existing.mrPeakCqpm = Math.max(existing.mrPeakCqpm, cqpm);
          }
          mrDailyMap.set(date, existing);
        }
        const mrDaily = Array.from(mrDailyMap.entries())
          .map(([date, data]) => ({ date, ...data }))
          .sort((a, b) => a.date.localeCompare(b.date));
        
        tracks.push({
          track,
          trackName: TRACK_NAMES[track] || track,
          startCqpm,
          peakCqpm,
          totalMinutes: trackMinutes,
          rate,
          anFinal,
          mrDaily,
          anHistory,
        });
      }
      
      // Sort tracks by most recent activity
      tracks.sort((a, b) => {
        const aLast = a.mrDaily[a.mrDaily.length - 1]?.date || '';
        const bLast = b.mrDaily[b.mrDaily.length - 1]?.date || '';
        return bLast.localeCompare(aLast);
      });
      
      const currentTrackStats = tracks.find(t => t.track === currentTrack) || tracks[0];
      
      result.push({
        email: player.email,
        name: player.name || player.email.split('@')[0],
        currentTrack,
        currentTrackName: TRACK_NAMES[currentTrack] || currentTrack,
        currentStart: currentTrackStats?.startCqpm || 0,
        currentPeak: currentTrackStats?.peakCqpm || 0,
        currentRate: currentTrackStats?.rate || null,
        totalMinutes,
        tracks,
      });
    }
    
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [players, snapshotsByEmail, anScores]);

  // Filter by search
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return studentData;
    const q = searchQuery.toLowerCase();
    return studentData.filter(s => s.name.toLowerCase().includes(q));
  }, [studentData, searchQuery]);

  const toggleRow = (email: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 mt-6">
        <div className="text-slate-400">Loading student data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Detailed Breakdowns</h2>
        <input
          type="text"
          placeholder="Search students..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 focus:outline-none focus:border-slate-500 w-48"
        />
      </div>
      
      <div className="bg-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-700/50">
          {filteredData.length} students · Click to expand
        </div>
        
        <div className="divide-y divide-slate-700/50">
          {filteredData.map(student => {
            const isExpanded = expandedRows.has(student.email);
            
            return (
              <div key={student.email}>
                {/* Summary Row */}
                <div
                  className="flex items-center px-4 py-3 cursor-pointer hover:bg-slate-700/30"
                  onClick={() => toggleRow(student.email)}
                >
                  <div className="w-6 text-slate-500 text-sm">
                    {isExpanded ? '▼' : '▶'}
                  </div>
                  <div className="flex-1 grid grid-cols-6 gap-4 items-center">
                    <div className="col-span-2">
                      <div className="font-medium text-white">{student.name}</div>
                      <div className="text-xs text-slate-500">{student.currentTrackName}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-300">{student.currentStart.toFixed(1)}</div>
                      <div className="text-xs text-slate-500">Start</div>
                    </div>
                    <div className="text-center">
                      <div className="text-emerald-400 font-medium">{student.currentPeak.toFixed(1)}</div>
                      <div className="text-xs text-slate-500">Peak</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-300">{Math.round(student.totalMinutes)}</div>
                      <div className="text-xs text-slate-500">Min</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-300">{student.currentRate?.toFixed(1) || '—'}</div>
                      <div className="text-xs text-slate-500">Rate</div>
                    </div>
                  </div>
                </div>
                
                {/* Expanded Details */}
                {isExpanded && (
                  <div className="bg-slate-900/50 px-6 py-4 space-y-4">
                    {student.tracks.map(track => (
                      <div key={track.track} className="bg-slate-800 rounded-lg overflow-hidden">
                        <div className="bg-slate-700/50 px-4 py-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-white">{track.trackName}</span>
                          <div className="flex gap-4 text-xs text-slate-400">
                            <span>Start: {track.startCqpm.toFixed(1)}</span>
                            <span>Peak: {track.peakCqpm.toFixed(1)}</span>
                            <span>{Math.round(track.totalMinutes)} min</span>
                            <span>Rate: {track.rate?.toFixed(1) || '—'}</span>
                            {track.anFinal && <span className="text-emerald-400">AN: {Math.round(track.anFinal)} ✓</span>}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                          {/* MR Practice */}
                          <div>
                            <div className="text-xs text-slate-500 mb-2">MR Practice</div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-slate-400">
                                  <th className="text-left py-1">Date</th>
                                  <th className="text-center py-1">Min</th>
                                  <th className="text-center py-1">Peak</th>
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
                                        <span className={i === track.anHistory.length - 1 ? 'text-emerald-400 font-semibold' : 'text-amber-400'}>
                                          {Math.round(an.cqpm)}{i === track.anHistory.length - 1 ? ' ✓' : ''}
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
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
