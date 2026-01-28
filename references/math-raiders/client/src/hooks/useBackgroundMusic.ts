import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';

// Audio served from public/sounds/ folder (bundled with app)
const AUDIO_BASE = '/sounds/';

export function useBackgroundMusic() {
  const currentRaid = useGameStore(state => state.currentRaid);
  const soundEnabled = useGameStore(state => state.soundEnabled);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  
  // Refs to track current values for stable listener
  const soundEnabledRef = useRef(soundEnabled);
  const currentRaidRef = useRef(currentRaid);
  const hasUserInteractedRef = useRef(hasUserInteracted);
  
  // Update refs when values change
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    currentRaidRef.current = currentRaid;
    hasUserInteractedRef.current = hasUserInteracted;
  }, [soundEnabled, currentRaid, hasUserInteracted]);
  const [menuMusic] = useState(() => {
    const audio = new Audio(`${AUDIO_BASE}menu-music.mp3`);
    audio.loop = true;
    audio.volume = 0.3;
    audio.load(); // iOS requires explicit load
    return audio;
  });
  
  const [raidMusic] = useState(() => {
    const audio = new Audio(`${AUDIO_BASE}dungeon-music.mp3`);
    audio.loop = true;
    audio.volume = 0.4;
    audio.load(); // iOS requires explicit load
    return audio;
  });

  // Try to play music on first user interaction anywhere in the app
  // Stable listener with empty deps - doesn't re-register on every state change
  useEffect(() => {
    const handleFirstInteraction = () => {
      // Read current values from refs (always up-to-date)
      if (!hasUserInteractedRef.current && soundEnabledRef.current) {
        // Call play() IMMEDIATELY - iOS requires this as first statement
        const raid = currentRaidRef.current;
        const playPromise = raid 
          ? (raid.state.tag === 'Victory' || raid.state.tag === 'Failed' ? null : raidMusic.play())
          : menuMusic.play();
        
        setHasUserInteracted(true);
        
        if (playPromise) {
          playPromise.catch(() => {}); // Silence expected errors
        }
      }
    };

    // Listen for user interaction
    // touchend (not touchstart) - iOS trusts touchend more for audio unlock
    // click for desktop/keyboard
    document.addEventListener('touchend', handleFirstInteraction);
    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('keydown', handleFirstInteraction);

    return () => {
      document.removeEventListener('touchend', handleFirstInteraction);
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - listener stays stable, reads current values via closure

  useEffect(() => {
    if (!soundEnabled) {
      // Stop all music when sound is disabled
      menuMusic.pause();
      raidMusic.pause();
      return;
    }
    
    // Only try to play if user has interacted with the page
    if (!hasUserInteracted) {
      if (import.meta.env.DEV) {
        console.log('[MUSIC] Waiting for user interaction before starting music');
      }
      return;
    }
    
    if (currentRaid) {
      const state = currentRaid.state.tag;
      
      // Silence for end screens (victory sound plays separately)
      if (state === 'Victory' || state === 'Failed' || state === 'Rematch') {
        menuMusic.pause();
        raidMusic.pause();
      } 
      // Menu music for lobby/waiting states
      else if (state === 'Matchmaking') {
        raidMusic.pause();
        raidMusic.currentTime = 0;
        menuMusic.play().catch(err => console.log('[MUSIC] Menu music play error:', err));
      }
      // Raid music for active play states
      else {
        // InProgress, Countdown, Paused
        menuMusic.pause();
        menuMusic.currentTime = 0;
        raidMusic.play().catch(err => console.log('[MUSIC] Raid music play error:', err));
      }
    } else {
      // Not in raid: play menu music
      raidMusic.pause();
      raidMusic.currentTime = 0;
      menuMusic.play().catch(err => console.log('[MUSIC] Menu music play error:', err));
    }
  }, [currentRaid, soundEnabled, hasUserInteracted, menuMusic, raidMusic]);
}











