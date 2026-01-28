import { memo, useRef, useEffect } from 'react';
import { ProblemRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type Problem = Infer<typeof ProblemRow>;

interface AnswerInputProps {
  answer: string;
  onAnswerChange: (value: string) => void;
  onSubmit: (submittedAnswer: string) => void;
  showFeedback: { correct: boolean } | null;
  currentProblem: Problem | null;
  playerId: string | null;
  firstProblem: boolean;
  ripples: { id: number; timestamp: number }[];
  isWaiting: boolean;
  disabled?: boolean;
}

export const AnswerInput = memo(function AnswerInput({
  answer,
  onAnswerChange,
  onSubmit,
  showFeedback,
  currentProblem,
  playerId,
  firstProblem,
  ripples,
  isWaiting,
  disabled = false
}: AnswerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Keep input focused when answer clears or input re-enables (after retry feedback)
  useEffect(() => {
    if (answer === '' && currentProblem && !disabled) {
      inputRef.current?.focus();
    }
  }, [answer, currentProblem, disabled]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onAnswerChange(newValue);
    
    // Auto-submit when digit count matches expected answer
    if (currentProblem && newValue && newValue.trim() !== '') {
      const parsed = parseInt(newValue, 10);
      const expectedDigits = currentProblem.answer.toString().length;
      const inputDigits = newValue.length;
      
      if (!isNaN(parsed) && inputDigits === expectedDigits) {
        const problemIdAtSubmit = currentProblem.id;
        // 30ms = ~2 frames of visual confirmation (feels instant, subliminal feedback)
        setTimeout(() => {
          // Only submit if still on same problem
          if (currentProblem && currentProblem.id === problemIdAtSubmit) {
            onSubmit(newValue);
          }
        }, 30);
      }
    }
  };
  
  return (
    <div className="relative w-full">
      {/* CSS Ripple Effects - success animation */}
      {ripples.map(ripple => (
        <div
          key={ripple.id}
          className="success-ripple"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        />
      ))}
      
      {/* Network waiting indicator - only shows if >350ms */}
      {isWaiting && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
          <div className="flex gap-1">
            {[0, 150, 300].map(delay => (
              <div
                key={delay}
                className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        </div>
      )}
      
      <input
        ref={inputRef}
        type="text"
        inputMode={
          // Pure touch device (iPad, phone) → 'none' (number pad handles input)
          // 2-in-1 or desktop → 'numeric' (allow keyboard)
          ('ontouchstart' in window || navigator.maxTouchPoints > 0) && 
          !window.matchMedia('(pointer: fine)').matches 
            ? 'none' 
            : 'numeric'
        }
        pattern="[0-9]*"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={answer}
        onChange={handleChange}
        onWheel={(e) => e.preventDefault()}
        onInput={(e) => {
          // Only allow digits
          e.currentTarget.value = e.currentTarget.value.replace(/[^0-9]/g, '');
        }}
        className={`w-full px-6 py-4 text-4xl font-black text-center rounded-2xl tabular-nums
          focus:outline-none focus-visible:outline-none
          ${showFeedback && !showFeedback.correct 
            ? 'answer-input-wrong text-red-100' 
            : showFeedback && showFeedback.correct 
            ? 'answer-input-correct text-emerald-100'
            : answer.length > 0
            ? 'answer-input-typing text-white'
            : 'answer-input-idle text-gray-300'
          }
          placeholder:text-gray-500 placeholder:tracking-wider
          transform-gpu
        `}
        style={{
          letterSpacing: '0.05em',
          textShadow: showFeedback && showFeedback.correct
            ? '0 0 8px rgba(16,185,129,0.4)'
            : showFeedback && !showFeedback.correct
            ? '0 0 12px rgba(239,68,68,0.4)'
            : answer.length > 0 
            ? '0 0 20px rgba(168,85,247,0.6)'
            : 'none'
        }}
        placeholder={firstProblem ? "Type the answer!" : ""}
        autoFocus
        disabled={disabled}
      />
    </div>
  );
});

