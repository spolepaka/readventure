import { useEffect, useRef, useState } from 'react';
import { useGameStore } from './store/gameStore';
import type { Player, Raid, Problem } from './spacetime';
import { ConnectionScreen } from './components/ConnectionScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { MatchmakingScreen } from './components/MatchmakingScreen';
import { RaidScreen } from './components/RaidScreen';
import { ResultsScreen } from './components/ResultsScreen';
import { FloatingMathSymbols } from './components/FloatingMathSymbols';
import { AnimatedBackground } from './components/AnimatedBackground';
import { DamageOverlay } from './components/DamageOverlay';
import { CountdownOverlay } from './components/CountdownOverlay';
import { Target } from 'lucide-react';
import { PlaycademyClient } from '@playcademy/sdk';
import { SoundToggle } from './components/SoundToggle';
import { useBackgroundMusic } from './hooks/useBackgroundMusic';
import { resolveStudentGrade } from './utils/resolveStudentGrade';
import { determineGamePhase } from './store/gameStore';
import { PlaycademyLoadingScreen } from './components/PlaycademyLoadingScreen';

// Store Playcademy client for reconnection (needs token on reconnect)
let playcademyClientRef: PlaycademyClient | null = null;

function App() {
  // Playcademy integration state
  const [isLoadingSDK, setIsLoadingSDK] = useState(true);
  const [sdkError, setSdkError] = useState(false);

  // Initialize background music
  useBackgroundMusic();
  
  // Select all state we need
  const player = useGameStore((state) => state.currentPlayer);
  const playerId = useGameStore((state) => state.playerId);
  const currentRaid = useGameStore((state) => state.currentRaid);
  const currentProblem = useGameStore((state) => state.currentProblem);
  const raidPlayers = useGameStore((state) => state.raidPlayers);
  const connection = useGameStore((state) => 
    state.connectionState.tag === 'connected' ? state.connectionState.conn : null
  );
  const disconnect = useGameStore((state) => state.disconnect);
  const connect = useGameStore((state) => state.connect);
  
  const connectionState = useGameStore((state) => state.connectionState);
  const isOnline = useGameStore((state) => state.isOnline);
  const reconnect = useGameStore((state) => state.reconnect);
  const setTokenGetter = useGameStore((state) => state.setTokenGetter);
  
  // Simple state machine:
  // - Loading screen = until player exists (covers SDK init, connecting, hydrating)
  // - Modal = reconnection issues only (player exists but disconnected)
  const isConnecting = connectionState.tag === 'connecting';
  const isDisconnected = connectionState.tag === 'disconnected';
  
  // Delayed button state - shows after 1.5s if still disconnected
  const [showRetryButton, setShowRetryButton] = useState(false);
  
  useEffect(() => {
    if (isDisconnected && !isConnecting) {
      const timer = setTimeout(() => setShowRetryButton(true), 1500);
      return () => clearTimeout(timer);
    }
    setShowRetryButton(false);
  }, [isDisconnected, isConnecting]);
  
  // Show loading screen until we have a player - simplest correct condition
  const shouldShowLoadingScreen = isLoadingSDK || !player;
  // Only show modal for REconnections (player exists but connection lost)
  const shouldShowModal = !shouldShowLoadingScreen && player && (
    isDisconnected || 
    (!isOnline && document.visibilityState === 'visible')
  );
  
  const gamePhase = determineGamePhase(player, currentRaid, currentProblem);
  
  const isRaid = gamePhase === 'raid';
  const mainRef = useRef<HTMLDivElement | null>(null);

  // Initialize Playcademy SDK and auto-connect
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let hasInitialized = false;
    
    // Dev mode: 3s timeout falls back to dev player for local testing
    // Production: 15s timeout shows error (no silent fallback to wrong account)
    if (import.meta.env.DEV) {
      timeoutId = setTimeout(() => {
        if (!hasInitialized) {
          console.warn('[MathRaiders] Playcademy SDK timeout, running in dev mode');
          hasInitialized = true;
          setIsLoadingSDK(false);
          connect('⚡ Dev Player', undefined, undefined);
        }
      }, 3000);
    } else {
      // Production: longer timeout, then show error (don't silently use wrong account)
      timeoutId = setTimeout(() => {
        if (!hasInitialized) {
          console.error('[MathRaiders] Playcademy SDK failed to initialize after 15s');
          hasInitialized = true;
          setSdkError(true);  // Show error screen with retry button
          // Don't connect - user can click retry to reload
        }
      }, 15000);
    }
    
    // Initialize Playcademy SDK
    PlaycademyClient.init()
      .then(async (client: PlaycademyClient) => {
        if (!hasInitialized) {
          hasInitialized = true;
          
          // Store client for reconnection
          playcademyClientRef = client;
          
          // Set up token getter for centralized reconnect
          setTokenGetter(() => client.getToken() || undefined);

          setIsLoadingSDK(false);
          
          try {
            // Get authenticated user from Playcademy
            const user = await client.users.me();
            // Only log minimal info in production
            if (import.meta.env.DEV) {
              console.log('[MathRaiders] User connected:', user.username);
            }
            
            const email = user.email || undefined;
            const displayName = user.username || user.name || 
              (email ? (() => {
                const emailName = email.split('@')[0];
                const parts = emailName.split('.');
                const firstName = parts[0];
                return firstName.charAt(0).toUpperCase() + firstName.slice(1);
              })() : `Player${user.id.slice(0, 4)}`);
            // TimeBack ID - try all possible locations for maximum compatibility
            // 1. New namespace API (staging/future)
            // 2. New user.timeback.id (staging/future)
            // 3. Old user.timebackId (current production)
            const timebackId = (client.timeback as any).user?.id 
                || (user as any).timeback?.id 
                || (user as any).timebackId 
                || undefined;
            
            // Resolve student's grade level (AlphaMath → server DB/default)
            const resolvedGrade = await resolveStudentGrade(user, timebackId);
            
            // Get Playcademy JWT for gateway verification
            const playcademyToken = client.getToken() || undefined;
            
            // Connect with verified identity (gateway creates session, server trusts it)
            // Token is source of truth: /verify returns email from verified JWT
            connect(displayName, resolvedGrade, playcademyToken, timebackId);
          } catch (err) {
            console.error('[MathRaiders] Failed to get user:', err);
            // Fallback without Playcademy token (gateway will create dev session)
            connect('Playcademy Player', undefined, undefined);
          }
        }
        if (timeoutId) clearTimeout(timeoutId);
      })
      .catch((err: unknown) => {
        if (!hasInitialized) {
          console.warn('[MathRaiders] Playcademy SDK failed, running in dev mode:', err);
          hasInitialized = true;
          setIsLoadingSDK(false);
          // Dev mode: connect without Playcademy token (gateway will create dev session)
          connect('Dev Player', undefined, undefined);
        }
        if (timeoutId) clearTimeout(timeoutId);
      });
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []); // Run once on mount only
  
  // Handle browser online/offline events
  const setOnlineStatus = useGameStore(state => state.setOnlineStatus);
  
  // Handle browser online/offline + visibility changes → centralized reconnect()
  useEffect(() => {
    const handleOnline = () => {
      console.log('[BROWSER] Back online');
      setOnlineStatus(true);
      reconnect();  // Centralized - guards built in
    };
    
    const handleOffline = () => {
      console.log('[BROWSER] Went offline');
      if (document.visibilityState === 'visible') {
        setOnlineStatus(false);
      }
    };
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[VISIBILITY] Screen woke up');
        reconnect();  // Centralized - guards built in
      }
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [setOnlineStatus, reconnect]);
  
  // Ensure we never retain a scrolled position when entering raid/matchmaking
  useEffect(() => {
    if (gamePhase === 'raid' || gamePhase === 'matchmaking') {
      // Reset scroll position - safe to ignore errors if elements don't exist
      mainRef.current?.scrollTo?.({ top: 0, behavior: 'auto' });
      window.scrollTo?.({ top: 0, behavior: 'auto' })
    }
  }, [gamePhase]);

  // Render different screens based on game phase
  const renderScreen = () => {
    // Override connect screen in production when using Playcademy
    if (gamePhase === 'connect' && !isLoadingSDK) {
      // Skip connection screen when authenticated through Playcademy
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-2xl font-bold text-white mb-2">Connecting...</div>
            <div className="text-gray-400">Authenticated via Playcademy</div>
          </div>
        </div>
      );
    }
    
    switch (gamePhase) {
      case 'connect':
        return <ConnectionScreen />;
      case 'lobby':
        return <LobbyScreen />;
      case 'matchmaking':
        return <MatchmakingScreen />;
      case 'raid':
        return <RaidScreen />;
      case 'results':
        return <ResultsScreen />;
      default:
        return <ConnectionScreen />;
    }
  };
  
  // Show full screen loading (SDK init or first connection) or error
  if (shouldShowLoadingScreen || sdkError) {
    return <PlaycademyLoadingScreen error={sdkError} />;
  }
  
  return (
    <div className="min-h-screen">
      {/* Unified animated background for all screens */}
      <AnimatedBackground />
      
      {shouldShowModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-gray-900/95 border-2 border-red-500/50 rounded-2xl p-8 max-w-md mx-4 text-center">
            <div className="text-6xl mb-4">🌐</div>
            {isConnecting ? (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">Reconnecting...</h2>
                <p className="text-gray-300 mb-6">Hang tight!</p>
                <div className="flex items-center justify-center gap-2 text-yellow-400">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-400 border-t-transparent"></div>
                  <span>Connecting...</span>
                </div>
              </>
            ) : showRetryButton ? (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">Oops! Lost Connection</h2>
                <p className="text-gray-300 mb-6">Don't worry - let's get you back in!</p>
                <button
                  onClick={reconnect}
                  className="w-full py-4 px-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white text-xl font-bold rounded-xl transition-all transform hover:scale-105 active:scale-95 shadow-lg mb-4"
                >
                  🔄 Try Again
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="text-gray-400 hover:text-white text-sm underline"
                >
                  Refresh page
                </button>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">Reconnecting...</h2>
                <p className="text-gray-300 mb-6">Just a moment...</p>
                <div className="flex items-center justify-center gap-2 text-yellow-400">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-400 border-t-transparent"></div>
                  <span>Trying to reconnect...</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* Additional game effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Floating math symbols during raid - now static for performance */}
        {gamePhase === 'raid' && <FloatingMathSymbols />}
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col h-[100dvh] min-h-screen">

        {/* Sound control - absolute positioned */}
        <div className="absolute top-4 left-4 z-50">
          <SoundToggle />
        </div>

        {/* Game Content */}
        <main ref={mainRef} className={`flex-1 ${isRaid ? 'overflow-hidden' : 'overflow-auto'} flex min-h-0`}>
          <div className={`container mx-auto px-4 ${isRaid ? 'py-2' : 'py-8'} flex-1 flex items-center justify-center`}>
            <div className="w-full h-full">
              {renderScreen()}
            </div>
          </div>
        </main>

        {/* Bottom stats bar during raid - proper flex item, not overlay */}
        {isRaid && connection?.identity && player && (() => {
          // Calculate real-time stats
          const myStats = raidPlayers.find(p => p.playerId === playerId);
          const accuracy = myStats && myStats.problemsAnswered > 0 
            ? Math.round((myStats.correctAnswers * 100) / myStats.problemsAnswered) 
            : 0;
          
          return (
            <div className="flex-shrink-0 bg-black/20 backdrop-blur-md border-t border-white/10 px-4 py-3">
              <div className="container mx-auto">
                <div className="flex justify-center">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-5 h-5 text-emerald-400" />
                      <span className="text-sm text-gray-400 ui-sc">Accuracy</span>
                    </div>
                    <span className={`text-lg font-medium ui-num transition-colors duration-300 ${accuracy >= 80 ? 'text-emerald-400' : 'text-gray-400'}`}>{accuracy}%</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      
      {/* Damage overlay - Independent system, won't re-render from boss animations */}
      <DamageOverlay />
      
      {/* Countdown overlay - 3-2-1-GO before raid starts */}
      <CountdownOverlay />
    </div>
  );
}

export default App;
