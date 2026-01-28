import { useState, useEffect, useRef, useCallback } from 'react';
import { DbConnection, ErrorContext } from '../spacetime';
import type { Player, Session, Raid, RaidPlayer, FactMastery, PerformanceSnapshot } from '../spacetime';
import { LiveActivity } from './components/LiveActivity';
import { DatabaseStats } from './components/DatabaseStats';
import { AdminActions } from './components/AdminActions';
import { BackupRestore } from './components/BackupRestore';

// Simple debounce: collapses rapid calls into one after delay
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

const SERVERS: Record<string, { uri: string; module: string; label: string }> = {
  'ec2-math-raiders': { uri: 'ws://18.224.110.93:3000', module: 'math-raiders', label: 'EC2 Production' },
  'maincloud': { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders', label: 'Maincloud' },
  'maincloud-staging': { uri: 'https://maincloud.spacetimedb.com', module: 'math-raiders-staging', label: 'Maincloud Staging' },
  'local': { uri: 'ws://localhost:3000', module: 'math-raiders', label: 'Local' },
};

function ServerSelector() {
  const urlParams = new URLSearchParams(window.location.search);
  const currentServer = urlParams.get('server') || 'ec2-math-raiders';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newServer = e.target.value;
    const url = new URL(window.location.href);
    url.searchParams.set('server', newServer);
    window.location.href = url.toString();
  };

  return (
    <select
      value={currentServer}
      onChange={handleChange}
      className="bg-slate-900 text-slate-200 border border-slate-700 rounded-md px-4 py-2 text-sm ml-4"
    >
      {Object.entries(SERVERS).map(([key, { label }]) => (
        <option key={key} value={key}>{label}</option>
      ))}
    </select>
  );
}

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [raids, setRaids] = useState<Raid[]>([]);
  const [raidPlayers, setRaidPlayers] = useState<RaidPlayer[]>([]);
  const [factMasteries, setFactMasteries] = useState<FactMastery[]>([]);
  const [performanceSnapshots, setPerformanceSnapshots] = useState<PerformanceSnapshot[]>([]);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  
  const connRef = useRef<DbConnection | null>(null);

  // On-demand loading of heavy tables with real-time updates
  //
  // Problem: SpacetimeDB fires onInsert for EVERY row during initial sync (16k+ calls)
  // Solution: Debounced listeners - collapses burst of calls into 1 setState
  //
  // Pattern: Set up debounced listeners BEFORE subscribe. During initial sync,
  // all 16k onInsert calls just reset the debounce timer. After 100ms quiet,
  // ONE re-read from cache happens. Future real-time changes also debounce.
  const loadStats = useCallback(() => {
    const conn = connRef.current;
    if (!conn || statsLoading) return;
    
    setStatsLoading(true);
    console.log('📊 Loading stats...');
    
    // Create debounced refresh functions (100ms delay)
    // All rapid calls during initial sync collapse into 1 setState
    const refreshFacts = debounce(() => {
      console.log('📊 Refreshing facts from cache');
      setFactMasteries(Array.from(conn.db.factMastery.iter()));
    }, 100);
    
    const refreshSnapshots = debounce(() => {
      console.log('📊 Refreshing snapshots from cache');
      setPerformanceSnapshots(Array.from(conn.db.performanceSnapshot.iter()));
    }, 100);
    
    // Set up listeners BEFORE subscribe - they'll debounce the initial sync
    conn.db.factMastery.onInsert(refreshFacts);
    conn.db.factMastery.onUpdate(refreshFacts);
    conn.db.factMastery.onDelete(refreshFacts);
    conn.db.performanceSnapshot.onInsert(refreshSnapshots);
    conn.db.performanceSnapshot.onUpdate(refreshSnapshots);
    conn.db.performanceSnapshot.onDelete(refreshSnapshots);
    
    conn.subscriptionBuilder()
      .onApplied((ctx) => {
        // Initial load - read directly from cache (no debounce needed here)
        const facts = Array.from(ctx.db.factMastery.iter());
        const snapshots = Array.from(ctx.db.performanceSnapshot.iter());
        console.log('📊 Stats loaded:', facts.length, 'facts,', snapshots.length, 'snapshots');
        setFactMasteries(facts);
        setPerformanceSnapshots(snapshots);
        setStatsLoaded(true);
        setStatsLoading(false);
      })
      .onError((_ctx, err) => {
        console.error('❌ Stats load error:', err);
        setStatsLoading(false);
      })
      .subscribe([
        'SELECT * FROM fact_mastery',
        'SELECT * FROM performance_snapshot',
      ]);
  }, [statsLoading]);

  useEffect(() => {
    // Get server from URL
    const urlParams = new URLSearchParams(window.location.search);
    const serverKey = urlParams.get('server') || 'ec2-math-raiders';
    const server = SERVERS[serverKey] || SERVERS['ec2-math-raiders'];
    
    // Get appropriate token
    const isEC2 = server.uri.includes('18.224');
    const token = isEC2
      ? import.meta.env.VITE_SPACETIMEDB_TOKEN_EC2
      : import.meta.env.VITE_SPACETIMEDB_TOKEN;

    const onConnect = (conn: DbConnection) => {
      console.log('✅ Connected to SpacetimeDB');
      connRef.current = conn;
      
      // Subscribe to all tables
      conn.subscriptionBuilder()
        .onApplied((ctx) => {
          console.log('📡 Subscriptions active');
          setIsConnected(true);
          
          // Load initial data from cache (core tables only - fast!)
          setPlayers(Array.from(ctx.db.player.iter()));
          setSessions(Array.from(ctx.db.session.iter()));
          setRaids(Array.from(ctx.db.raid.iter()));
          setRaidPlayers(Array.from(ctx.db.raidPlayer.iter()));
          // factMastery and performanceSnapshot NOT loaded here - too slow
          // They're loaded on-demand when needed for backup/stats
        })
        .onError((_ctx, err) => console.error('❌ Subscription error:', err))
        .subscribe([
          'SELECT * FROM session',
          'SELECT * FROM raid',
          'SELECT * FROM raid_player',
          'SELECT * FROM player',
          // fact_mastery and performance_snapshot loaded on-demand for backup
          // Dramatically speeds up initial load
        ]);
      
      // Set up real-time listeners (dedupe via Map to handle onInsert firing during initial sync)
      conn.db.player.onInsert((_ctx, row) => setPlayers(prev => {
        const map = new Map(prev.map(p => [p.id, p]));
        map.set(row.id, row);
        return Array.from(map.values());
      }));
      conn.db.player.onUpdate((_ctx, _old, row) => setPlayers(prev => prev.map(p => p.id === row.id ? row : p)));
      conn.db.player.onDelete((_ctx, row) => setPlayers(prev => prev.filter(p => p.id !== row.id)));
      
      conn.db.session.onInsert((_ctx, row) => setSessions(prev => {
        const map = new Map(prev.map(s => [s.connectionId.toHexString(), s]));
        map.set(row.connectionId.toHexString(), row);
        return Array.from(map.values());
      }));
      conn.db.session.onDelete((_ctx, row) => setSessions(prev => prev.filter(s => s.connectionId.toHexString() !== row.connectionId.toHexString())));
      
      conn.db.raid.onInsert((_ctx, row) => setRaids(prev => {
        const map = new Map(prev.map(r => [r.id, r]));
        map.set(row.id, row);
        return Array.from(map.values());
      }));
      conn.db.raid.onUpdate((_ctx, _old, row) => setRaids(prev => prev.map(r => r.id === row.id ? row : r)));
      conn.db.raid.onDelete((_ctx, row) => setRaids(prev => prev.filter(r => r.id !== row.id)));
      
      conn.db.raidPlayer.onInsert((_ctx, row) => setRaidPlayers(prev => {
        const map = new Map(prev.map(rp => [rp.id, rp]));
        map.set(row.id, row);
        return Array.from(map.values());
      }));
      conn.db.raidPlayer.onUpdate((_ctx, _old, row) => setRaidPlayers(prev => prev.map(rp => rp.id === row.id ? row : rp)));
      conn.db.raidPlayer.onDelete((_ctx, row) => setRaidPlayers(prev => prev.filter(rp => rp.id !== row.id)));
      
      // factMastery and performanceSnapshot listeners removed - not in initial subscription
      // Add back if you need real-time updates for stats
    };

    const onDisconnect = () => {
      console.log('🔌 Disconnected');
      setIsConnected(false);
    };

    const onConnectError = (_ctx: ErrorContext, err: Error) => {
      console.error('❌ Connection error:', err);
    };

    DbConnection.builder()
      .withUri(server.uri)
      .withModuleName(server.module)
      .withToken(token)
      .onConnect(onConnect)
      .onDisconnect(onDisconnect)
      .onConnectError(onConnectError)
      .build();

    return () => {
      connRef.current?.disconnect();
    };
  }, []);

  return (
    <div className="bg-slate-900 min-h-screen text-slate-200 font-sans">
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-center mb-8">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            🎮 Math Raiders Admin
          </h1>
          <ServerSelector />
          {isConnected ? (
            <span className="text-xs text-emerald-400 ml-4">● Connected</span>
          ) : (
            <span className="text-xs text-amber-400 ml-4">○ Connecting...</span>
          )}
        </div>

        {isConnected ? (
          <>
            <LiveActivity 
              sessions={sessions}
              players={players}
              raids={raids}
              raidPlayers={raidPlayers}
            />
            
            {/* Stats: load on demand */}
            {!statsLoaded ? (
              <div className="bg-slate-800 rounded-lg p-6 mb-6 text-center">
                <button
                  onClick={loadStats}
                  disabled={statsLoading}
                  className={`${statsLoading ? 'bg-slate-500 cursor-not-allowed' : 'bg-violet-500 hover:bg-violet-600 cursor-pointer'} text-white rounded-md px-6 py-3 text-sm font-medium transition-colors`}
                >
                  {statsLoading ? '⏳ Loading Stats...' : '📊 Load Player Stats'}
                </button>
                <div className="mt-2 text-xs text-slate-500">
                  Loads fact_mastery & performance_snapshot tables (may take a few seconds)
                </div>
              </div>
            ) : (
              <>
                <DatabaseStats 
                  players={players}
                  factMasteries={factMasteries}
                  performanceSnapshots={performanceSnapshots}
                />
                <BackupRestore 
                  players={players}
                  factMasteries={factMasteries}
                  performanceSnapshots={performanceSnapshots}
                  conn={connRef.current}
                />
              </>
            )}
            
            <AdminActions 
              players={players}
              conn={connRef.current}
            />
          </>
        ) : (
          <div className="bg-slate-800 rounded-lg p-8 text-center text-slate-500">
            Connecting to SpacetimeDB...
          </div>
        )}
      </div>
    </div>
  );
}
