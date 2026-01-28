import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown } from 'lucide-react';
import { GradientLogo } from './GradientLogo';
import { getPlayerId } from '../utils/identity';

// Emoji options for player avatars - fun personalization!
const EMOJI_OPTIONS = [
  '😀', '😎', '🤠', '🥷', '👽', '🤖', '👻', '🦄',
  '🐵', '🐶', '🐺', '🦊', '🦁', '🐯', '🐨', '🐼',
  '🐸', '🐙', '🦋', '🐝', '🦖', '🦕', '🐉', '🦜',
  '🌟', '⚡', '🔥', '💎', '🎯', '🎮', '🎲', '🎪'
];

export function ConnectionScreen() {
  const [selectedEmoji, setSelectedEmoji] = useState('⚡');
  const [playerName, setPlayerName] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  
  // Data values
  const connecting = useGameStore(state => state.connectionState.tag === 'connecting');
  const connectionError = useGameStore(state => state.connectionError);
  
  // Stable action
  const connect = useGameStore(state => state.connect);

  const handleConnect = () => {
    const name = playerName || 'Raider';
    // Connect without Playcademy token (dev mode - gateway creates dev session)
    connect(name, undefined, undefined);
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Grid overlay with pulse */}
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `
            linear-gradient(rgba(139,92,246,0.25) 1px, transparent 1px),
            linear-gradient(90deg, rgba(139,92,246,0.25) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
          animation: 'gridPulse 4s ease-in-out infinite',
        }}
      />
      
      {/* Content */}
      <Card className="w-full max-w-2xl backdrop-blur-sm bg-black/40 border-white/10 relative z-10">
        <CardHeader className="text-center space-y-3 pb-6">
          {/* Gradient Logo - no more bouncing */}
          <div className="flex justify-center">
            <GradientLogo />
          </div>
          
          {/* Tagline - confident declaration */}
          <h2 className="text-2xl font-black text-white tracking-wide mt-2 font-game">
            THE BOSS AWAITS
          </h2>
        </CardHeader>
      
      <CardContent className="pt-2">
        <div className="space-y-10">
          {/* Avatar Selection - Show popular choices directly */}
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-3 mb-1">
              <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent flex-1 max-w-[80px]" />
              <Label htmlFor="avatar" className="text-sm font-black text-white/90 uppercase tracking-[0.2em] text-center">Pick your power</Label>
              <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent flex-1 max-w-[80px]" />
            </div>
            <div className="flex gap-2 justify-center">
              {/* Show 5 popular emojis directly */}
              {['⚡', '🥷', '🔥', '💀', '🐺'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setSelectedEmoji(emoji)}
                  className={`w-16 h-16 rounded-lg border-2 transition-all hover:scale-110 ${
                    selectedEmoji === emoji 
                      ? 'border-purple-400 bg-purple-400/20 scale-110' 
                      : 'border-white/20 hover:border-white/40'
                  }`}
                >
                  <span className="text-3xl">{emoji}</span>
                </button>
              ))}
              {/* More options button - shows selected emoji if not in popular list */}
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className={`w-16 h-16 rounded-lg border-2 transition-all hover:scale-110 flex items-center justify-center relative group ${
                  !['⚡', '🥷', '🔥', '💀', '🐺'].includes(selectedEmoji)
                    ? 'border-purple-400 bg-purple-400/20 scale-110'
                    : 'border-white/20 hover:border-white/40'
                }`}
              >
                <span className={!['⚡', '🥷', '🔥', '💀', '🐺'].includes(selectedEmoji) ? "text-3xl" : "text-2xl"}>
                  {!['⚡', '🥷', '🔥', '💀', '🐺'].includes(selectedEmoji) 
                    ? selectedEmoji 
                    : '+'
                  }
                </span>
                {/* Show chevron indicator when custom emoji is selected */}
                {!['⚡', '🥷', '🔥', '💀', '🐺'].includes(selectedEmoji) && (
                  <ChevronDown className="absolute bottom-0.5 right-0.5 w-3 h-3 text-purple-400/70 group-hover:text-purple-400 transition-colors" />
                )}
              </button>
            </div>
            
            {/* Emoji picker dropdown */}
            <div className="relative">
              {showEmojiPicker && (
                <Card className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-md p-4 bg-gray-900/95 backdrop-blur-md border-white/30 shadow-2xl shadow-purple-500/20 z-[999]">
                  <div className="grid grid-cols-8 gap-2 max-h-48 overflow-y-auto">
                    {EMOJI_OPTIONS.map((emoji) => (
                      <Button
                        key={emoji}
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setSelectedEmoji(emoji);
                          setShowEmojiPicker(false);
                        }}
                        className={`text-2xl hover:scale-110 transition-transform p-2 ${
                          selectedEmoji === emoji 
                            ? 'bg-purple-400/30 ring-2 ring-purple-400' 
                            : ''
                        }`}
                      >
                        {emoji}
                      </Button>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>

          {/* Name Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-3 mb-1">
              <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent flex-1 max-w-[80px]" />
              <Label htmlFor="name" className="text-sm font-black text-white/90 uppercase tracking-[0.2em] text-center">What's your name</Label>
              <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent flex-1 max-w-[80px]" />
            </div>
            <Input
              id="name"
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !connecting) {
                  handleConnect();
                }
              }}
              placeholder="MathWizard, NumberNinja..."
              maxLength={20}
              className="h-14 text-lg text-center font-semibold bg-white/5 border-white/20 placeholder:text-white/50 focus:border-purple-400 transition-colors"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* Connect Button - Arcade Cabinet Style */}
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="relative w-full h-14 text-xl font-black text-gray-900 rounded-lg uppercase tracking-wider transform transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none font-game"
            style={{
              background: 'linear-gradient(180deg, #FCD34D 0%, #F59E0B 90%, #D97706 100%)',
              boxShadow: connecting ? 
                '0 2px 0 #92400E, 0 3px 8px rgba(0,0,0,0.3)' :
                '0 4px 0 #92400E, 0 6px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.2)',
              textShadow: '0 1px 0 rgba(255,255,255,0.5)',
              animation: !connecting ? 'arcade-glow-pulse 3s ease-in-out infinite' : 'none',
            }}
            onMouseEnter={(e) => {
              if (!connecting) {
                e.currentTarget.style.animation = 'none';
                e.currentTarget.style.boxShadow = '0 5px 0 #92400E, 0 7px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 0 rgba(0,0,0,0.2), 0 0 20px rgba(251, 191, 36, 0.3)';
              }
            }}
            onMouseLeave={(e) => {
              if (!connecting) {
                e.currentTarget.style.animation = 'arcade-glow-pulse 3s ease-in-out infinite';
                e.currentTarget.style.boxShadow = '0 4px 0 #92400E, 0 6px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.2)';
              }
            }}
            onMouseDown={(e) => {
              if (!connecting) {
                e.currentTarget.style.boxShadow = '0 1px 0 #92400E, 0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.2)';
              }
            }}
            onMouseUp={(e) => {
              if (!connecting) {
                e.currentTarget.style.boxShadow = '0 4px 0 #92400E, 0 6px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.2)';
              }
            }}
          >
            {/* Button text */}
            <span className="relative flex items-center justify-center gap-2">
              {connecting ? (
                <>
                  <span className="animate-spin">⚔️</span>
                  <span className="animate-pulse">Connecting...</span>
                </>
              ) : (
                <>
                  <span className="text-shadow-sm">Play Now</span>
                  <span className="text-2xl transition-transform group-hover:translate-x-1">→</span>
                </>
              )}
            </span>
          </button>
          
          {/* Error message */}
          {connectionError && (
            <div className="p-3 rounded-lg bg-red-900/20 border border-red-800/30 text-red-300 text-sm text-center">
              {connectionError}
            </div>
          )}
        </div>
      </CardContent>
      </Card>
    </div>
  );
} 