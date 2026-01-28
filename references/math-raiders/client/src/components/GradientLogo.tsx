interface GradientLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export function GradientLogo({ size = 'lg' }: GradientLogoProps) {
  const sizeClasses = {
    sm: 'text-2xl sm:text-3xl',
    md: 'text-4xl sm:text-5xl',
    lg: 'text-5xl sm:text-6xl md:text-7xl',
  };

  return (
    <div className="relative inline-block group">
      {/* Perfect balance: clean, readable, kid-friendly, aesthetic, gamey */}
      <h1 className={`${sizeClasses[size]} font-extrabold select-none
                     transform hover:-rotate-1 transition-all duration-300`}
          style={{ fontFamily: "'Fredoka', sans-serif" }}>
        {size === 'lg' ? (
          <>
            <span className="block bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 bg-clip-text text-transparent 
                           drop-shadow-[0_4px_8px_rgba(99,102,241,0.25)]
                           bg-[length:200%_auto] animate-gradient-x">
              MATH
            </span>
            <span className="block bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 bg-clip-text text-transparent 
                           drop-shadow-[0_4px_8px_rgba(236,72,153,0.25)]
                           bg-[length:200%_auto] animate-gradient-x animation-delay-250 -mt-2">
              RAIDERS
            </span>
          </>
        ) : (
          <>
            <span className="bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 bg-clip-text text-transparent 
                           drop-shadow-[0_4px_8px_rgba(99,102,241,0.25)]
                       bg-[length:200%_auto] animate-gradient-x">
          MATH
        </span>
            <span className="ml-2 bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 bg-clip-text text-transparent 
                       drop-shadow-[0_4px_8px_rgba(236,72,153,0.25)]
                           bg-[length:200%_auto] animate-gradient-x animation-delay-250">
          RAIDERS
        </span>
          </>
        )}
      </h1>
      
      {/* Subtle glow on hover for game feel */}
      <div className="absolute inset-0 -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500
                      bg-gradient-to-r from-indigo-500/20 to-orange-500/20 blur-2xl scale-110" />
    </div>
  );
}
