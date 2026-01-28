# Math Raiders Sound Implementation Guide

> **START HERE:** Jump to "Generate Your Sounds First" section, start Suno generating, then come back to implement while you wait!

## 🚀 Quick Start for Junior Devs

### TL;DR
You're adding 5 sounds to a React game. The sounds play when:
1. ✅ Player answers correctly
2. ❌ Player answers wrong  
3. 🏆 Team wins the raid
4. ⭐ Player levels up
5. 🚀 Raid starts

### Prerequisites
- [ ] Node/Bun installed
- [ ] Project runs locally (`cd client && bun run dev`)
- [ ] Can play the game

### Smart Workflow (2 hours total)
1. **Start Suno generating** (5 min to queue up)
2. **While sounds generate**, implement code:
   - Add store changes (5 min)
   - Create sound hook (10 min) 
   - Add mute button (10 min)
   - Integrate sounds (30 min)
3. **Download sounds** when ready (10 min)
4. **Test everything** (30 min)

### 🎯 Pro Tip
Start WITHOUT sound files - use console.log to test! (See Step 6)

## 🎵 Generate Your Sounds First (30 min)

### Quick Suno Instructions
1. **Sign up at Suno.ai** (free = 5 generations/day)
2. **Generate all 5 sounds** using the prompts below
3. **Download as MP3** 
4. **Save them while you code!**

### The 5 Sound Prompts (Copy These!)

#### 1. correct.mp3
```
"[Instrumental] Bright major chord progression, video game victory, 
cheerful xylophone and bells, 1 second, uplifting, C major"
```

#### 2. wrong.mp3
```
"[Instrumental] Gentle descending notes, educational game, 
soft synth pad, supportive not harsh, 1 second, minor key"
```

#### 3. victory.mp3
```
"[Instrumental] Epic orchestral victory fanfare, heroic brass,
timpani roll, video game boss defeated, triumphant, 3 seconds"
```

#### 4. levelup.mp3
```
"[Instrumental] Magical sparkle ascending harp glissando,
fantasy game level up, ethereal chimes, whoosh, 2 seconds"
```

#### 5. start.mp3
```
"[Instrumental] Battle horn call, epic drums, game starting,
adrenaline building, orchestral hit, 2 seconds"
```

### After Generating:
1. Download each as MP3
2. Rename to match filenames above
3. Save to `client/public/sounds/`
4. Continue with code implementation below!

## Implementation

### 1. Add Sound to Game Store

```typescript
// In store/gameStore.ts, add to your store:
interface GameStore {
  // ... existing state
  soundEnabled: boolean;
  toggleSound: () => void;
}

// In the store:
soundEnabled: true,
toggleSound: () => set(state => ({ 
  soundEnabled: !state.soundEnabled 
})),
```

### 2. Create the Sound Hook

```typescript
// hooks/useGameSounds.ts
import { useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';

export function useGameSounds() {
  const soundEnabled = useGameStore(state => state.soundEnabled);
  
  const play = useCallback((sound: 'correct' | 'wrong' | 'victory' | 'levelup' | 'start') => {
    if (!soundEnabled) return;
    
    const volumes = { 
      wrong: 0.4,      // Quieter for gentle feedback
      correct: 0.6,    // Rewarding but not jarring
      victory: 0.8,    // Celebratory
      levelup: 0.7,    // Special moment
      start: 0.7       // Energizing
    };
    
    const audio = new Audio(`/sounds/${sound}.mp3`);
    audio.volume = volumes[sound];
    audio.play().catch(() => {}); // Ignore autoplay errors
  }, [soundEnabled]);

  return play;
}
```

### 3. Integration Points

```typescript
// In RaidScreen.tsx
import { useGameSounds } from '@/hooks/useGameSounds';

function RaidScreen() {
  const playSound = useGameSounds();
  
  // When answer is submitted
  const handleAnswer = (answer: number) => {
    if (isCorrect) {
      playSound('correct');
      // ... rest of logic
    } else {
      playSound('wrong');
      // ... rest of logic
    }
  };

  // When boss is defeated
  if (bossHealth <= 0) {
    playSound('victory');
    // ... rest of logic
  }

  // When raid starts
  useEffect(() => {
    playSound('start');
  }, []); // Play once on mount
}

// In LevelUpModalSimple.tsx
import { useGameSounds } from '@/hooks/useGameSounds';

function LevelUpModalSimple({ isOpen, ... }) {
  const playSound = useGameSounds();
  
  useEffect(() => {
    if (isOpen) {
      playSound('levelup');
    }
  }, [isOpen, playSound]);
}
```

### 4. Mute Button Component

```tsx
// components/SoundToggle.tsx
import { Volume2, VolumeX } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';

export function SoundToggle() {
  const { soundEnabled, toggleSound } = useGameStore();

  return (
    <button
      onClick={toggleSound}
      className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
      aria-label={soundEnabled ? "Mute sounds" : "Unmute sounds"}
    >
      {soundEnabled ? (
        <Volume2 className="w-5 h-5 text-white" />
      ) : (
        <VolumeX className="w-5 h-5 text-gray-400" />
      )}
    </button>
  );
}

// Add to Header.tsx or wherever your UI controls are:
<SoundToggle />
```

## 📍 Step-by-Step Integration Guide

### Step 1: Update Game Store (5 min)

**File**: `client/src/store/gameStore.ts`

**Find this** (around line 13):
```typescript
export interface GameState {
```

**Add these lines** inside the interface:
```typescript
    soundEnabled: boolean;
    toggleSound: () => void;
```

**Then find** `create<GameStore>((set, get) => ({` and **add**:
```typescript
    soundEnabled: true,
    toggleSound: () => set(state => ({ 
      soundEnabled: !state.soundEnabled 
    })),
```

### Step 2: Create Sound Hook (10 min)

**Create new file**: `client/src/hooks/useGameSounds.ts`

**Copy-paste the entire hook from section 2 above**

### Step 3: Add Mute Button (10 min)

**File**: `client/src/App.tsx`

**Find** (around line 200):
```typescript
<main className="flex-1 overflow-hidden">
```

**Add BEFORE it**:
```tsx
{/* Sound control - absolute positioned */}
<div className="absolute top-4 right-4 z-50">
  <SoundToggle />
</div>
```

**At the top of App.tsx, add import**:
```typescript
import { SoundToggle } from './components/SoundToggle';
```

**Create new file**: `client/src/components/SoundToggle.tsx`

**Copy-paste the entire component from section 4 above**

### Step 4: Integrate Sounds (30 min)

#### 4.1 Correct/Wrong Answer Sounds

**File**: `client/src/components/RaidScreen.tsx`

**Add imports at top**:
```typescript
import { useEffect } from 'react';
import { useGameSounds } from '@/hooks/useGameSounds';
```

**Find** (search for "Wrong answer reactions"):
```typescript
// Wrong answer reactions
```

**Add BEFORE this comment**:
```typescript
// Play sound feedback
const playSound = useGameSounds();
if (isCorrect) {
  playSound('correct');
} else {
  playSound('wrong');
}
```

#### 4.2 Victory Sound

**In same file** (`RaidScreen.tsx`)

**Find** (search for "Victory"):
```typescript
if (currentRaid && (currentRaid.state.tag === "Victory"
```

**Add this at the top of the component**:
```typescript
const playSound = useGameSounds();
```

**Then modify the useEffect**:
```typescript
useEffect(() => {
  if (currentRaid && currentRaid.state.tag === "Victory") {
    playSound('victory'); // Add this line
    setCombo(0);
    setShowFeedback(null);
  }
}, [currentRaid?.state, playSound]); // Add playSound to deps
```

#### 4.3 Level Up Sound

**File**: `client/src/components/LevelUpModalSimple.tsx`

**Add imports at top**:
```typescript
import { useEffect } from 'react';
import { useGameSounds } from '@/hooks/useGameSounds';
```

**Find**:
```typescript
export function LevelUpModalSimple({ isOpen,
```

**Add inside the component**:
```typescript
const playSound = useGameSounds();

useEffect(() => {
  if (isOpen) {
    playSound('levelup');
  }
}, [isOpen, playSound]);
```

#### 4.4 Raid Start Sound

**File**: `client/src/components/RaidScreen.tsx` (same file as 4.1)

**Find the component function** (look for `function RaidScreen` or `const RaidScreen`):

**Add this useEffect inside the component, near the top**:
```typescript
// Play start sound when raid begins
useEffect(() => {
  playSound('start');
}, []); // Empty deps = plays once on mount
```

**Note**: You already have `playSound` from step 4.1!

### Step 5: Add Sound Files (30 min)

1. **Create folder**: `client/public/sounds/`
2. **Generate sounds** using Suno (prompts provided above)
3. **Save as**:
   - `correct.mp3`
   - `wrong.mp3`
   - `victory.mp3`
   - `levelup.mp3`
   - `start.mp3`

### Step 6: Test Without Sound Files (for development)

**Temporary test**: In `useGameSounds.ts`, replace the play function:
```typescript
const play = useCallback((sound: 'correct' | 'wrong' | 'victory' | 'levelup' | 'start') => {
  if (!soundEnabled) return;
  
  // Temporary: Just log instead of playing
  console.log(`🔊 Playing sound: ${sound}`);
  
  // Uncomment when you have sound files:
  // const audio = new Audio(`/sounds/${sound}.mp3`);
  // audio.volume = volumes[sound];
  // audio.play().catch(() => {});
}, [soundEnabled]);
```

## Audio Guidelines

### Volume Levels
- **Correct**: 60% - Rewarding but not jarring
- **Wrong**: 40% - Softer to reduce negative association
- **Victory**: 80% - Celebratory moment
- **Level Up**: 70% - Special but not overwhelming
- **Raid Start**: 70% - Energizing but focused

### Educational Best Practices
1. **Immediate Feedback**: Play sounds with zero delay
2. **Consistency**: Same action = same sound every time
3. **Non-Punitive**: Wrong answer sound should feel neutral
4. **Teacher-Friendly**: Always include mute option
5. **Simple is Better**: 5 sounds don't need complex management

### File Structure
```
client/
  public/
    sounds/
      correct.mp3
      wrong.mp3
      victory.mp3
      levelup.mp3
      start.mp3
```

## Optional: Sound Editing

If your Suno sounds need cleanup:
1. **Download Audacity** (free)
2. **Trim silence** at start/end
3. **Normalize volume** to -3dB
4. **Add fade in/out** (0.1s)
5. **Export as MP3**

## Future Enhancements (Post-MVP)

- Background music during raids (10-20% volume)
- Streak-based sound variations
- Seasonal sound packs
- Student-customizable sound themes
- Spatial audio for multiplayer

## Why This Approach?

**Simple > Complex**
- No preloading = No memory waste
- No class = Idiomatic React
- Hook-based = Easy to test
- Store integration = Consistent with your app
- ~20 lines total = Less bugs

**Modern browsers handle:**
- Audio caching automatically
- Lazy loading efficiently  
- Multiple instances cleanly

## 🚨 Common Mistakes & Solutions

### Mistake 1: "Cannot find module '@/hooks/useGameSounds'"
**Solution**: Create the hooks folder first!
```bash
mkdir client/src/hooks
```

### Mistake 2: "Audio play() failed"
**Solution**: This is normal! Browsers block autoplay until user interaction.
- First click anywhere on the page
- Sound will work after that

### Mistake 3: Sound plays multiple times
**Solution**: Make sure useEffect has correct dependencies:
```typescript
useEffect(() => {
  playSound('start');
}, []); // Empty array = plays once!
```

### Mistake 4: No sound but no errors
**Check**:
1. Is soundEnabled true in the store?
2. Did you create the `/public/sounds/` folder?
3. Are the MP3 files named correctly?
4. Check browser console for 404 errors

### Mistake 5: TypeScript errors
**Add missing imports**:
```typescript
import { useEffect } from 'react';
import { useCallback } from 'react';
```

## ✅ Success Checklist

### You're done when:
- [ ] Clicking mute button shows 🔇 icon
- [ ] Console shows "🔊 Playing sound: correct" when testing
- [ ] No TypeScript errors
- [ ] No console errors (except autoplay warnings)
- [ ] Junior dev feels confident 😊

### Test in this order:
1. Start game → Should log "Playing sound: start"
2. Answer correctly → Should log "Playing sound: correct"
3. Answer wrong → Should log "Playing sound: wrong"
4. Win raid → Should log "Playing sound: victory"
5. Level up → Should log "Playing sound: levelup"

## Testing Checklist

- [ ] Sounds play on first interaction (not blocked by autoplay)
- [ ] Mute preference persists on reload (via store)
- [ ] No console errors from audio playback
- [ ] Sounds work on school Chromebooks
- [ ] Volume levels feel balanced
- [ ] Teacher can easily find mute button
