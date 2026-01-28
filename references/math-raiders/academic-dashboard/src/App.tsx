import { useState, useEffect, useRef } from 'react';
import { DbConnection, ErrorContext } from '../spacetime';
import type { Player, PerformanceSnapshot } from '../spacetime';
import { StudentProgress } from './components/StudentProgress';

// Hardcoded pilot students - update as needed
const PILOT_STUDENTS = [
  'adriana.danieri@alpha.school',
  'isaac.david@alpha.school',
  'clark.cho@alpha.school',
  'hope.grunow@alpha.school',
  'johnny.grunow@alpha.school',
  'geraldine.gurrola@alpha.school',
  'seby.holzhauer@alpha.school',
  // G5 students added Jan 2026 (Janna's request - stalling on FastMath)
  'jaedyn-lee.daniels@2hourlearning.com',
  'gardner.edwards@2hourlearning.com',
  'greyson.boyle@alpha.school',
  'tykhon.kotkovskyi@alpha.school',
  'zayen.szpitalak@alpha.school',
  'stella.cole@alpha.school',
  // Santa Barbara + Austin students added Jan 26, 2026
  'rhys.robertson@alpha.school',
  'niam.choe@alpha.school',
  'elaina.robertson@alpha.school',
  'aleina.boyce@alpha.school',
  'george.troxell@alpha.school',
  'beau.stern@alpha.school',
  'alyan.slizza@alpha.school',
  // Harper added Jan 27, 2026 (Janna's request - struggling with Sub, practicing Add)
  'harper.lembo@alpha.school',
  // Pax, Liv, Charlotte, Griffin added Jan 27, 2026
  'pax.ovitz@alpha.school',
  'liv.brodsky@alpha.school',
  'charlotte.buquoi@2hourlearning.com',
  'griffin.wittenborn@alpha.school',
];

// SpacetimeDB config (production only - via Cloudflare tunnel for WSS)
const STDB_URI = 'wss://lip-jets-approx-pig.trycloudflare.com';
const STDB_MODULE = 'math-raiders';

// Google OAuth Client ID (set in Vercel env vars)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Declare google global for TypeScript
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            use_fedcm_for_prompt?: boolean;
            use_fedcm_for_button?: boolean;
          }) => void;
          renderButton: (element: HTMLElement, config: { theme: string; size: string; width: number }) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

export default function App() {
  // Auth state
  const [isAuthed, setIsAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Data state
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [snapshots, setSnapshots] = useState<PerformanceSnapshot[]>([]);
  
  const connRef = useRef<DbConnection | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  // Check auth on mount (skip in dev for easy testing)
  useEffect(() => {
    if (import.meta.env.DEV) {
      setIsAuthed(true);
      setAuthLoading(false);
      return;
    }
    
    fetch('/api/me')
      .then(res => res.json())
      .then(data => setIsAuthed(data.authenticated === true))
      .catch(() => {}) // Network error - fall through to login
      .finally(() => setAuthLoading(false));
  }, []);

  // Load Google Sign-In when not authed
  useEffect(() => {
    if (isAuthed || authLoading || import.meta.env.DEV) return;
    if (!GOOGLE_CLIENT_ID) {
      setAuthError('Google Client ID not configured');
      return;
    }

    // Load Google's GSI script
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      if (window.google && googleButtonRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCallback,
          use_fedcm_for_prompt: true,
          use_fedcm_for_button: true,
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'filled_black',
          size: 'large',
          width: 300,
        });
      }
    };
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, [isAuthed, authLoading]);

  // Handle Google sign-in callback
  const handleGoogleCallback = async (response: { credential: string }) => {
    setAuthError('');
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
      });
      
      if (res.ok) {
        setIsAuthed(true);
      } else {
        const data = await res.json();
        setAuthError(data.error || 'Sign in failed');
      }
    } catch {
      setAuthError('Sign in failed');
    }
  };

  // Connect to SpacetimeDB when authed
  const wasConnectedRef = useRef(false);
  
  useEffect(() => {
    if (!isAuthed) return;

    // Reset state for fresh connection
    setConnectionError('');
    wasConnectedRef.current = false;
    
    const token = import.meta.env.VITE_SPACETIMEDB_TOKEN_EC2;

    const onConnect = (conn: DbConnection) => {
      connRef.current = conn;
      wasConnectedRef.current = true;
      
      // Step 1: Subscribe to players (small table, ~50KB)
      conn.subscriptionBuilder()
        .onApplied((ctx) => {
          const allPlayers = Array.from(ctx.db.player.iter());
          setPlayers(allPlayers);
          
          // Step 2: Subscribe only to pilot snapshots (avoid fetching 5000+ rows)
          const pilotIds = allPlayers
            .filter(p => PILOT_STUDENTS.includes(p.email || ''))
            .map(p => p.id);
          
          if (pilotIds.length > 0) {
            conn.subscriptionBuilder()
              .onApplied(() => {
                setSnapshots(Array.from(ctx.db.performanceSnapshot.iter()));
                setIsConnected(true);
              })
              .onError((_ctx, err) => console.error('Snapshot subscription error:', err))
              .subscribe(pilotIds.map(id => 
                `SELECT * FROM performance_snapshot WHERE player_id = '${id}'`
              ));
          } else {
            setIsConnected(true); // No pilots found, still mark connected
          }
        })
        .onError((_ctx, err) => console.error('Player subscription error:', err))
        .subscribe(['SELECT * FROM player']);
      
      // Real-time updates (dedupe via filter to handle initial sync overlap)
      conn.db.player.onInsert((_ctx, row) => setPlayers(prev => [...prev.filter(p => p.id !== row.id), row]));
      conn.db.player.onUpdate((_ctx, _old, row) => setPlayers(prev => prev.map(p => p.id === row.id ? row : p)));
      
      conn.db.performanceSnapshot.onInsert((_ctx, row) => setSnapshots(prev => [...prev.filter(s => s.id !== row.id), row]));
    };

    const onDisconnect = () => {
      setIsConnected(false);
      // Only show "Disconnected" if we were previously connected (not during initial load)
      if (wasConnectedRef.current) {
        setConnectionError('Connection lost');
      }
    };
    const onConnectError = (_ctx: ErrorContext, err: Error) => {
      console.error('Connection error:', err);
      setConnectionError('Failed to connect to database');
    };

    // Connection timeout - if not connected in 15s, show error
    const timeout = setTimeout(() => {
      if (!connRef.current) {
        setConnectionError('Connection timeout - database may be down');
      }
    }, 15000);

    DbConnection.builder()
      .withUri(STDB_URI)
      .withModuleName(STDB_MODULE)
      .withToken(token)
      .onConnect(onConnect)
      .onDisconnect(onDisconnect)
      .onConnectError(onConnectError)
      .build();

    return () => {
      clearTimeout(timeout);
      connRef.current?.disconnect();
    };
  }, [isAuthed]);

  // Auto-reload when tab becomes visible if disconnected
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && connectionError) {
        window.location.reload();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [connectionError]);

  // Logout handler
  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    // Prevent auto-reauth on next visit
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    setIsAuthed(false);
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  // Login screen
  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="bg-slate-800 p-8 rounded-xl w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold text-white mb-2">
            Math Raiders
          </h1>
          <p className="text-slate-400 mb-8">Student Progress Dashboard</p>
          
          {/* Google Sign-In button renders here */}
          <div ref={googleButtonRef} className="flex justify-center mb-4" />
          
          {authError && (
            <div className="text-red-400 text-sm mt-4">{authError}</div>
          )}
          
          <p className="text-slate-500 text-xs mt-6">
            Authorized Alpha School admins only
          </p>
        </div>
      </div>
    );
  }

  // Filter to pilot students only
  const pilotPlayers = players.filter(p => PILOT_STUDENTS.includes(p.email || ''));

  // Dashboard
  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 px-6 py-6">
      {isConnected ? (
        <StudentProgress 
          players={pilotPlayers} 
          snapshots={snapshots}
          isConnected={isConnected}
          onLogout={handleLogout}
        />
      ) : connectionError ? (
        <div className="bg-slate-800 rounded-lg p-8 text-center">
          <div className="text-red-400 mb-2">⚠️ {connectionError}</div>
          <div className="text-slate-500 text-sm">Try refreshing the page</div>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg p-8 text-center text-slate-500">
          Connecting to database...
        </div>
      )}
    </div>
  );
}
