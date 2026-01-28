# Math Raiders Sound Files

Drop your MP3 files here with these exact names:

- `menu-music.mp3` - Background music for lobby/menu screens
- `dungeon-music.mp3` - Background music that loops during raids
- `correct.mp3` - Plays when answer is correct
- `wrong.mp3` - Plays when answer is wrong  
- `victory.mp3` - Plays when raid is won
- `levelup.mp3` - Plays when leveling up
- `start.mp3` - Plays when raid begins (transitions to combat)

## Testing

The game currently logs sounds to console. Once you add these files, uncomment the audio code in:
`client/src/hooks/useGameSounds.ts`

