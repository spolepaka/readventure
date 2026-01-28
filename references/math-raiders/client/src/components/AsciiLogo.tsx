import { useMemo } from 'react';

export function AsciiLogo() {
  // Clean, readable ASCII art for MATH RAIDERS
  const asciiArt = useMemo(() => [
    " ███▄ ▄███▓ ▄▄▄     ▄▄▄█████▓ ██░ ██ ",
    "▓██▒▀█▀ ██▒▒████▄   ▓  ██▒ ▓▒▓██░ ██▒",
    "▓██    ▓██░▒██  ▀█▄ ▒ ▓██░ ▒░▒██▀▀██░",
    "▒██    ▒██ ░██▄▄▄▄██░ ▓██▓ ░ ░▓█ ░██ ",
    "▒██▒   ░██▒ ▓█   ▓██▒ ▒██▒ ░ ░▓█▒░██▓",
    "░ ▒░   ░  ░ ▒▒   ▓▒█░ ▒ ░░    ▒ ░░▒░▒",
    "░  ░      ░  ▒   ▒▒ ░   ░     ▒ ░▒░ ░",
    "░      ░     ░   ▒    ░       ░  ░░ ░",
    "",
    " ██▀███   ▄▄▄       ██▓▓█████▄ ▓█████  ██▀███    ██████ ",
    "▓██ ▒ ██▒▒████▄    ▓██▒▒██▀ ██▌▓█   ▀ ▓██ ▒ ██▒▒██    ▒ ",
    "▓██ ░▄█ ▒▒██  ▀█▄  ▒██▒░██   █▌▒███   ▓██ ░▄█ ▒░ ▓██▄   ",
    "▒██▀▀█▄  ░██▄▄▄▄██ ░██░░▓█▄   ▌▒▓█  ▄ ▒██▀▀█▄    ▒   ██▒",
    "░██▓ ▒██▒ ▓█   ▓██▒░██░░▒████▓ ░▒████▒░██▓ ▒██▒▒██████▒▒",
    "░ ▒▓ ░▒▓░ ▒▒   ▓▒█░░▓   ▒▒▓  ▒ ░░ ▒░ ░░ ▒▓ ░▒▓░▒ ▒▓▒ ▒ ░",
    "  ░▒ ░ ▒░  ▒   ▒▒ ░ ▒ ░ ░ ▒  ▒  ░ ░  ░  ░▒ ░ ▒░░ ░▒  ░ ░",
    "  ░░   ░   ░   ▒    ▒ ░ ░ ░  ░    ░     ░░   ░ ░  ░  ░  "
  ], []);

  return (
    <div className="relative select-none inline-block">
      {/* Main ASCII art with gradient */}
      <pre className="font-mono text-[6px] sm:text-[8px] md:text-[10px] lg:text-xs font-normal leading-[1] whitespace-pre overflow-hidden">
        {asciiArt.map((line, i) => (
          <div 
            key={i}
            className="relative"
            style={{
              background: `linear-gradient(90deg, 
                #3B82F6 0%, 
                #8B5CF6 35%, 
                #EC4899 70%, 
                #F97316 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 0 20px rgba(139, 92, 246, 0.5))',
            }}
          >
            {line || '\u00A0'}
          </div>
        ))}
      </pre>
      
      {/* Dot pattern overlay for that halftone effect */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.2) 1px, transparent 1px)`,
          backgroundSize: '2px 2px',
          mixBlendMode: 'screen'
        }}
      />
    </div>
  );
}