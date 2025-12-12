/**
 * Sound Manager for Readventure
 * 
 * Handles game sound effects with support for:
 * - Preloading sounds
 * - Playing sounds with volume control
 * - Muting/unmuting
 * - Sound categories (to disable during reading)
 */

export type SoundName = 'click' | 'hover' | 'locked' | 'tile-select' | 'success' | 'whoosh';

interface SoundConfig {
  src: string;
  volume: number;
  category: 'ui' | 'game' | 'celebration';
}

const SOUNDS: Record<SoundName, SoundConfig> = {
  'click': { src: '/sounds/click.mp3', volume: 0.4, category: 'ui' },
  'hover': { src: '/sounds/hover.mp3', volume: 0.2, category: 'ui' },
  'locked': { src: '/sounds/locked.mp3', volume: 0.5, category: 'game' },
  'tile-select': { src: '/sounds/tile-select.mp3', volume: 0.5, category: 'game' },
  'success': { src: '/sounds/success.mp3', volume: 0.6, category: 'celebration' },
  'whoosh': { src: '/sounds/whoosh.mp3', volume: 0.4, category: 'ui' },
};

class SoundManager {
  private sounds: Map<SoundName, HTMLAudioElement> = new Map();
  private isMuted: boolean = false;
  private isReadingMode: boolean = false;
  private initialized: boolean = false;

  constructor() {
    // Don't preload in constructor - wait for user interaction
  }

  /**
   * Initialize and preload all sounds
   * Should be called after user interaction (click/keypress)
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    
    for (const [name, config] of Object.entries(SOUNDS)) {
      const audio = new Audio(config.src);
      audio.volume = config.volume;
      audio.preload = 'auto';
      this.sounds.set(name as SoundName, audio);
    }
    
    this.initialized = true;
    console.log('🔊 Sound manager initialized');
  }

  /**
   * Play a sound by name
   */
  play(name: SoundName): void {
    if (this.isMuted) return;
    
    const config = SOUNDS[name];
    
    // Don't play game sounds during reading mode (only celebration allowed)
    if (this.isReadingMode && config.category !== 'celebration') {
      return;
    }
    
    const audio = this.sounds.get(name);
    if (!audio) {
      // Fallback: create and play immediately
      const fallbackAudio = new Audio(config.src);
      fallbackAudio.volume = config.volume;
      fallbackAudio.play().catch(() => {});
      return;
    }
    
    // Clone the audio to allow overlapping sounds
    const clone = audio.cloneNode() as HTMLAudioElement;
    clone.volume = config.volume;
    clone.play().catch(() => {
      // Silently fail - user hasn't interacted yet
    });
  }

  /**
   * Enable reading mode (disables game/ui sounds)
   */
  enterReadingMode(): void {
    this.isReadingMode = true;
  }

  /**
   * Exit reading mode (enables all sounds)
   */
  exitReadingMode(): void {
    this.isReadingMode = false;
  }

  /**
   * Check if in reading mode
   */
  inReadingMode(): boolean {
    return this.isReadingMode;
  }

  /**
   * Mute all sounds
   */
  mute(): void {
    this.isMuted = true;
  }

  /**
   * Unmute all sounds
   */
  unmute(): void {
    this.isMuted = false;
  }

  /**
   * Toggle mute state
   */
  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  /**
   * Check if muted
   */
  isSoundMuted(): boolean {
    return this.isMuted;
  }
}

// Export singleton instance
export const soundManager = new SoundManager();

// Also export for global access
if (typeof window !== 'undefined') {
  (window as any).soundManager = soundManager;
}

