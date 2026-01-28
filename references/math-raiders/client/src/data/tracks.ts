// Track definitions for Math Raiders
// Maps grade levels to available training tracks

export interface Track {
  id: string;
  name: string;
  description: string;
  icon: string;
  operation?: 'add' | 'subtract' | 'multiply' | 'divide';
}

export const TRACKS_BY_GRADE: Record<number, Track[]> = {
  0: [
    {
      id: 'TRACK12',
      name: 'Addition Within 10',
      description: 'Addition within 10',
      icon: '⚡',
      operation: 'add'
    }
  ],
  
  1: [
    {
      id: 'TRACK12',
      name: 'Addition Within 10',
      description: 'Addition within 10',
      icon: '⚡',
      operation: 'add'
    }
  ],
  
  2: [
    {
      id: 'TRACK9',
      name: 'Addition 0-9',
      description: 'Single-digit addition',
      icon: '⚡',
      operation: 'add'
    },
    {
      id: 'TRACK10',
      name: 'Subtraction from 20',
      description: 'Single-digit subtraction',
      icon: '🔥',
      operation: 'subtract'
    }
  ],
  
  3: [
    {
      id: 'TRACK6',
      name: 'Addition to 20',
      description: 'Addition up to 20',
      icon: '⚡',
      operation: 'add'
    },
    {
      id: 'TRACK8',
      name: 'Subtraction to 20',
      description: 'Subtraction up to 20',
      icon: '🔥',
      operation: 'subtract'
    },
    {
      id: 'TRACK11',
      name: 'Multiplication 0-9',
      description: 'Times tables 0-9',
      icon: '💎',
      operation: 'multiply'
    }
  ],
  
  4: [
    {
      id: 'TRACK7',
      name: 'Multiplication 0-12',
      description: 'Times tables 0-12',
      icon: '💎',
      operation: 'multiply'
    },
    {
      id: 'TRACK5',
      name: 'Division 0-12',
      description: 'Division 0-12',
      icon: '👑',
      operation: 'divide'
    }
  ],
  
  5: [
    {
      id: 'TRACK6',
      name: 'Addition to 20',
      description: 'Addition up to 20',
      icon: '⚡',
      operation: 'add'
    },
    {
      id: 'TRACK8',
      name: 'Subtraction to 20',
      description: 'Subtraction up to 20',
      icon: '🔥',
      operation: 'subtract'
    },
    {
      id: 'TRACK7',
      name: 'Multiplication 0-12',
      description: 'Times tables 0-12',
      icon: '💎',
      operation: 'multiply'
    },
    {
      id: 'TRACK5',
      name: 'Division 0-12',
      description: 'Division 0-12',
      icon: '👑',
      operation: 'divide'
    }
  ]
};

// Special "ALL" track for mixed practice
export const ALL_TRACK: Track = {
  id: 'ALL',
  name: 'Mixed Practice',
  description: 'All operations',
  icon: '✨'
};

export function getTracksForGrade(grade: number): Track[] {
  return TRACKS_BY_GRADE[grade] || [];
}

export function shouldShowTrackSelector(grade: number): boolean {
  return getTracksForGrade(grade).length >= 1;  // Show selector if any tracks exist
}

export function shouldShowAllButton(grade: number): boolean {
  return getTracksForGrade(grade).length > 1;  // Only show ALL button if 2+ tracks
}

export function getDefaultTrack(grade: number): string {
  const tracks = getTracksForGrade(grade);
  if (tracks.length === 0) return 'ALL';
  if (grade >= 5) return 'ALL';  // G5+ = fluency across all ops
  return tracks[0].id;           // K-4 = scaffold with first track
}

/**
 * Get track for a player's grade level
 * 
 * Priority:
 * 1. Manual selection (localStorage) → user explicitly clicked a track
 * 2. TimeBack latest track → syncs with FastMath progress (if valid for grade)
 * 3. Grade-based default → ALL for G5+, first track for K-4
 */
export function getTrackForGrade(playerId: string, grade: number): string {
  const manualKey = `track-${playerId}-grade${grade}`;
  const stored = localStorage.getItem(manualKey);
  
  // Priority 1: Manual selection (user clicked a track button)
  if (stored) {
    const validTracks = getTracksForGrade(grade);
    const isValid = stored === 'ALL' || validTracks.some(t => t.id === stored);
    if (isValid) return stored;
    // Invalid track stored - clear it
    localStorage.removeItem(manualKey);
  }
  
  // Priority 2: TimeBack-synced track (follows FastMath progress)
  const timebackTrack = localStorage.getItem('timeback-latest-track');
  if (timebackTrack) {
    const validTracks = getTracksForGrade(grade);
    const isValid = validTracks.some(t => t.id === timebackTrack);
    if (isValid) return timebackTrack;
    // Track not valid for this grade - fall through to default
  }
  
  // Priority 3: Grade-based default
  return getDefaultTrack(grade);
}




