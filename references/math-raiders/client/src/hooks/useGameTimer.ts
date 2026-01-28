import { useRef, useEffect } from 'react';
import { useAnimationFrame } from './useAnimationFrame';
import { getFastThresholdMs } from '../utils/gradeThresholds';

interface UseGameTimerOptions {
  startTime: number;
  enabled: boolean;
  grade: number;
  onTimeUpdate?: (time: number) => void;
}

/**
 * Game timer using RAF for 60fps smooth updates
 * Updates DOM directly without React re-renders
 * 
 * Usage:
 * 1. Add id="timer-display" to your timer text element
 * 2. Add id="timer-bar" to your progress bar element
 * 3. Call this hook with startTime and enabled state
 */
export function useGameTimer({ startTime, enabled, grade, onTimeUpdate }: UseGameTimerOptions) {
  const timeRef = useRef(0);
  
  // Reset display once when timer is blocked (not every frame)
  useEffect(() => {
    if (!enabled || startTime === 0) {
      timeRef.current = 0;
      const display = document.getElementById('timer-display');
      const bar = document.getElementById('timer-bar');
      if (display) display.textContent = '0.0s';
      if (bar) {
        bar.style.width = '0%';
        bar.className = 'h-full timer-bar-fast';
      }
    }
  }, [startTime, enabled]);
  
  useAnimationFrame(() => {
    if (!enabled || startTime === 0) {
      return;
    }
    
    const elapsed = Date.now() - startTime;
    timeRef.current = elapsed;
    
    // Optional callback for React components that need the value
    onTimeUpdate?.(elapsed);
    
    // Update DOM directly (no setState, no re-render)
    const display = document.getElementById('timer-display');
    const bar = document.getElementById('timer-bar');
    
    if (display) {
      display.textContent = `${(elapsed / 1000).toFixed(1)}s`;
    }
    
    if (bar) {
      const threshold = getFastThresholdMs(grade);
      // Bar fills over 3× threshold - more forgiving for learners
      // Yellow marker at 1/3 (threshold), red zone starts at 2/3 (2× threshold)
      const width = Math.min((elapsed / (threshold * 3)) * 100, 100);
      bar.style.width = `${width}%`;
      
      // Color zones: Green (mastered) → Yellow (learning) → Red (struggling)
      if (elapsed < threshold) {
        bar.className = 'h-full timer-bar-fast';      // 0-33%: automatic recall
      } else if (elapsed < threshold * 2) {
        bar.className = 'h-full timer-bar-medium';    // 33-66%: learning zone
      } else {
        bar.className = 'h-full timer-bar-slow';      // 66%+: needs practice
      }
    }
  });
  
  return timeRef;
}

