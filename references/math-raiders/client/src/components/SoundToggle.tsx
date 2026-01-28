import { Volume2, VolumeX } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import { useState, useEffect } from 'react';

export function SoundToggle() {
  // Use selectors to prevent re-renders when unrelated state changes
  const soundEnabled = useGameStore(state => state.soundEnabled);
  const toggleSound = useGameStore(state => state.toggleSound);
  const [needsInteraction, setNeedsInteraction] = useState(true);

  useEffect(() => {
    // Clear the indicator after first interaction
    const handleInteraction = () => {
      setNeedsInteraction(false);
    };

    document.addEventListener('click', handleInteraction);
    document.addEventListener('keydown', handleInteraction);
    document.addEventListener('touchstart', handleInteraction);

    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
    };
  }, []);

  return (
    <button
      onClick={toggleSound}
      className="relative p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
      aria-label={soundEnabled ? "Mute sounds" : "Unmute sounds"}
    >
      {soundEnabled ? (
        <Volume2 className="w-5 h-5 text-white" />
      ) : (
        <VolumeX className="w-5 h-5 text-gray-400" />
      )}
      {soundEnabled && needsInteraction && (
        <span className="absolute -right-1 -top-1 w-2 h-2 bg-yellow-400 rounded-full animate-pulse" 
              title="Click anywhere to start music" />
      )}
    </button>
  );
}

