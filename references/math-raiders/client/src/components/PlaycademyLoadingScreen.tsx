import { useEffect, useState } from 'react';
import { GradientLogo } from './GradientLogo';

interface PlaycademyLoadingScreenProps {
  error?: boolean;  // Show error state with retry
}

export function PlaycademyLoadingScreen({ error = false }: PlaycademyLoadingScreenProps) {
  const [dots, setDots] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(3);
  
  // Animate dots (only when loading, not error)
  useEffect(() => {
    if (error) return;
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);
    return () => clearInterval(interval);
  }, [error]);
  
  // Countdown timer (only when loading, not error)
  useEffect(() => {
    if (error) return;
    const interval = setInterval(() => {
      setTimeRemaining(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [error]);
  
  const handleRetry = () => {
    window.location.reload();
  };
  
  return (
    <div className="min-h-screen bg-[#0F0B1E] flex items-center justify-center relative overflow-hidden">
      {/* Animated grid background */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(rgba(139,92,246,0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(139,92,246,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
          animation: 'gridPulse 4s ease-in-out infinite',
        }}
      />
      
      {/* Content */}
      <div className="text-center relative z-10 space-y-8">
        {/* Logo - no pulse when error */}
        <div className={error ? '' : 'animate-pulse'}>
          <GradientLogo />
        </div>
        
        {error ? (
          /* Error state */
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">
              Connection Failed
            </h2>
            <p className="text-gray-400 max-w-xs mx-auto">
              Couldn't connect to Playcademy. Please check your internet and try again.
            </p>
            <button
              onClick={handleRetry}
              className="px-8 py-3 bg-gradient-to-r from-purple-500 to-purple-600 
                         hover:from-purple-400 hover:to-purple-500
                         text-white font-bold rounded-lg
                         transform hover:scale-105 active:scale-95 transition-all
                         shadow-lg shadow-purple-500/30"
            >
              🔄 Retry
            </button>
          </div>
        ) : (
          /* Loading state */
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-white">
              Connecting to Playcademy{dots}
            </h2>
            
            {/* Progress bar */}
            <div className="w-64 mx-auto">
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-purple-500 to-purple-600 transition-all duration-1000"
                  style={{ width: `${((3 - timeRemaining) / 3) * 100}%` }}
                />
              </div>
            </div>
            
            {/* Status messages */}
            <div className="text-sm text-gray-400 space-y-1">
              {timeRemaining > 2 && (
                <p className="animate-fadeIn">🔐 Authenticating with Playcademy</p>
              )}
              {timeRemaining <= 2 && timeRemaining > 1 && (
                <p className="animate-fadeIn">👤 Loading your profile</p>
              )}
              {timeRemaining <= 1 && (
                <p className="animate-fadeIn">🎮 Preparing your game</p>
              )}
            </div>
            
            {/* Fallback notice (dev only) */}
            {timeRemaining === 0 && import.meta.env.DEV && (
              <p className="text-xs text-gray-500 animate-fadeIn mt-4">
                Starting in development mode...
              </p>
            )}
          </div>
        )}
      </div>
      
      {/* Corner indicator */}
      {!error && (
        <div className="absolute bottom-4 right-4 text-xs text-gray-500">
          {timeRemaining > 0 ? `${timeRemaining}s` : 'Loading...'}
        </div>
      )}
    </div>
  );
}

















































