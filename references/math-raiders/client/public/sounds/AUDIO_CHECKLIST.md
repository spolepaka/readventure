# Math Raiders Audio Files Checklist

## Required MP3 Files

### Background Music (Looping)
- [ ] `menu-music.mp3` - Plays in lobby and matchmaking screens (30% volume)
- [ ] `dungeon-music.mp3` - Plays during raids (30% volume)

### Sound Effects (One-shot)
- [ ] `correct.mp3` - Plays when answer is correct (60% volume)
- [ ] `wrong.mp3` - Plays when answer is wrong (40% volume)
- [ ] `victory.mp3` - Plays when raid is won (80% volume)
- [ ] `levelup.mp3` - Plays when leveling up (70% volume)

## Implementation Status

### ✅ Phase 1: Background Music System
- Created `useBackgroundMusic` hook
- Added to App.tsx
- Handles menu music for lobby/matchmaking

### ✅ Phase 2: Raid Music
- Already implemented in RaidScreen
- Plays dungeon-music.mp3 during raids
- Stops when raid ends

### ⏳ Phase 3: Enable Sound Effects
Once you have the MP3 files:
1. Uncomment lines 14-25 in `client/src/hooks/useGameSounds.ts`
2. Test all sounds work correctly

## Music Behavior

**Menu Music:**
- Starts when entering lobby
- Continues in matchmaking
- Stops when raid begins
- Resumes when returning to lobby

**Raid Music:**
- Starts when raid screen loads
- Loops throughout raid
- Stops on victory/defeat
- Respects mute toggle

**Sound Effects:**
- Layer over any background music
- Play at their set volumes
- Short, punchy feedback sounds












































