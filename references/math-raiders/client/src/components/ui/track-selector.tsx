import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import type { Track } from "@/data/tracks"

const trackSelectorVariants = cva(
  "inline-flex flex-col items-center gap-2 p-2 rounded-xl bg-transparent w-full",
  {
    variants: {
      size: {
        default: "min-h-[80px]",
        sm: "min-h-[70px]",
        lg: "min-h-[90px]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const trackButtonVariants = cva(
  "relative inline-flex flex-col items-center justify-center font-medium transition-all duration-200 rounded-lg outline-none gap-1",
  {
    variants: {
      size: {
        default: "h-auto min-w-[110px] px-4 py-3 text-sm",
        sm: "h-auto min-w-[100px] px-3 py-2 text-xs",
        lg: "h-auto min-w-[120px] px-5 py-4 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

interface TrackSelectorProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof trackSelectorVariants> {
  tracks: Track[]
  value?: string
  onValueChange?: (value: string) => void
  showAll?: boolean // Whether to show "Mixed Practice (ALL)" option
}

const TrackSelector = React.forwardRef<HTMLDivElement, TrackSelectorProps>(
  ({ className, size, tracks, value, onValueChange, showAll = true, ...props }, ref) => {
    const [selected, setSelected] = React.useState(value || (showAll ? 'ALL' : tracks[0]?.id))
    
    React.useEffect(() => {
      if (value !== undefined) {
        setSelected(value)
      }
    }, [value])

    const handleSelect = React.useCallback((trackId: string) => {
      setSelected(trackId)
      onValueChange?.(trackId)
    }, [onValueChange])

    // Combine tracks with "ALL" option if enabled
    const allOptions = React.useMemo(() => {
      const options = [...tracks];
      if (showAll) {
        options.unshift({
          id: 'ALL',
          name: 'Mixed Practice',
          description: 'All operations',
          icon: '✨'
        });
      }
      return options;
    }, [tracks, showAll]);

    return (
      <div
        ref={ref}
        className={cn(trackSelectorVariants({ size }), className)}
        {...props}
      >
        <div className="flex flex-wrap justify-center gap-2">
          {allOptions.map((track) => {
            const isSelected = selected === track.id
            return (
              <button
                key={track.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-selected={isSelected}
                onClick={() => handleSelect(track.id)}
                className={cn(
                  trackButtonVariants({ size }),
                  // Base state
                  "bg-transparent border border-gray-700",
                  "transform-gpu transition-[transform,box-shadow,border-color,background] duration-200 ease-out",
                  !isSelected && "text-gray-400",
                  // Hover only for unselected
                  !isSelected && [
                    "hover:translate-y-[-2px]",
                    "hover:shadow-md",
                    "hover:bg-gray-800/50",
                    "hover:text-gray-200",
                    "hover:border-gray-600"
                  ],
                  "active:translate-y-0",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-500/50 focus-visible:ring-offset-1",
                  // Selected state
                  isSelected && [
                    "!text-white font-semibold ring-2 ring-purple-500 ring-offset-0 border-0",
                    "bg-purple-600/20",
                    "shadow-lg shadow-purple-500/20",
                    "[text-shadow:_0_1px_2px_rgb(0_0_0_/_40%)]",
                    "hover:ring-[3px]",
                    "relative overflow-hidden",
                    // Subtle shine
                    "before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent",
                  ],
                )}
              >
                <span className="text-2xl mb-1">{track.icon}</span>
                <span className="relative z-10 text-center font-bold leading-tight">{track.name}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }
)
TrackSelector.displayName = "TrackSelector"

export { TrackSelector, trackSelectorVariants }




