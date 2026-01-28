import { useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';

/**
 * Web Audio API sound system - Zustand for audio
 * 
 * - One AudioContext (unlocked once on user interaction)
 * - Pre-decoded AudioBuffers (instant playback)
 * - No HTMLAudioElement management
 * - <5ms latency
 */

const SOUNDS = {
  correct: '/sounds/correct.mp3',
  wrong: '/sounds/wrong.wav',
  victory: '/sounds/victory.mp3',
  levelup: '/sounds/levelup.mp3',
} as const;

const VOLUMES: Record<SoundName, number> = {
  correct: 0.6,
  wrong: 0.4,
  victory: 0.8,
  levelup: 0.7,
};

type SoundName = keyof typeof SOUNDS;

// Module-level singleton (shared across all hook instances)
let audioContext: AudioContext | null = null;
let isUnlocked = false;
const buffers: Map<SoundName, AudioBuffer> = new Map();
let isLoading = false;

/**
 * Initialize AudioContext and preload all sounds
 */
async function initAudio() {
  if (audioContext || isLoading) return;
  isLoading = true;
  
  try {
    // Create context (may be suspended until user interaction)
    audioContext = new AudioContext();
    
    // Preload and decode all sounds
    await Promise.all(
      Object.entries(SOUNDS).map(async ([name, path]) => {
        try {
          const response = await fetch(path);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioContext!.decodeAudioData(arrayBuffer);
          buffers.set(name as SoundName, audioBuffer);
        } catch (e) {
          console.warn(`Failed to load sound: ${name}`, e);
        }
      })
    );
    
    console.log('[Audio] Loaded', buffers.size, 'sounds');
  } catch (e) {
    console.warn('[Audio] Failed to initialize:', e);
  }
  
  isLoading = false;
}

/**
 * Unlock audio context on user interaction (Safari requirement)
 */
function unlockAudio() {
  if (isUnlocked || !audioContext) return;
  
  if (audioContext.state === 'suspended') {
    audioContext.resume().then(() => {
      isUnlocked = true;
      console.log('[Audio] Context unlocked');
    });
  } else {
    isUnlocked = true;
  }
}

// Start loading immediately
initAudio();

/**
 * React hook for game sounds
 */
export function useGameSounds() {
  const soundEnabled = useGameStore(state => state.soundEnabled);
  const hasSetupUnlock = useRef(false);
  
  // Set up unlock listener once
  useEffect(() => {
    if (hasSetupUnlock.current) return;
    hasSetupUnlock.current = true;
    
    const handleInteraction = () => {
      unlockAudio();
      // Keep listeners for a bit in case first unlock fails
      setTimeout(() => {
        window.removeEventListener('touchstart', handleInteraction);
        window.removeEventListener('click', handleInteraction);
        window.removeEventListener('keydown', handleInteraction);
      }, 1000);
    };
    
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    
    return () => {
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);
  
  const play = useCallback((sound: SoundName) => {
    if (!soundEnabled) return;
    if (!audioContext) return;
    
    const buffer = buffers.get(sound);
    if (!buffer) return;
    
    // Create source node (cheap, auto-cleans up)
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    
    // Create gain node for volume control
    const gainNode = audioContext.createGain();
    gainNode.gain.value = VOLUMES[sound];
    
    // Connect: source -> gain -> destination
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Play immediately
    source.start(0);
  }, [soundEnabled]);

  return play;
}
