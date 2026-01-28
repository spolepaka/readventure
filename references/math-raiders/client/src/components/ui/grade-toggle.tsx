import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const gradeToggleVariants = cva(
  "inline-flex items-center gap-3 bg-transparent",
  {
    variants: {
      size: {
        default: "h-14",
        sm: "h-11",
        lg: "h-16",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const gradeButtonVariants = cva(
  "relative inline-flex items-center justify-center font-medium transition-all duration-200 rounded-full outline-none",
  {
    variants: {
      size: {
        default: "w-14 h-14 text-base",
        sm: "w-12 h-12 text-sm",
        lg: "w-16 h-16 text-lg",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

interface GradeToggleProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof gradeToggleVariants> {
  value?: string
  onValueChange?: (value: string) => void
  defaultValue?: string
  disabled?: boolean
}

const GradeToggle = React.forwardRef<HTMLDivElement, GradeToggleProps>(
  ({ className, size, value, onValueChange, defaultValue = "3", disabled = false, ...props }, ref) => {
    const [selected, setSelected] = React.useState(value || defaultValue)
    
    React.useEffect(() => {
      if (value !== undefined) {
        setSelected(value)
      }
    }, [value])

    const handleSelect = React.useCallback((grade: string) => {
      if (disabled) return; // Prevent selection when locked
      setSelected(grade)
      onValueChange?.(grade)
    }, [onValueChange, disabled])

    const grades = React.useMemo(() => [
      { value: "0", label: "K", color: "gray", rarity: "Common" },
      { value: "1", label: "1", color: "green", rarity: "Uncommon" },
      { value: "2", label: "2", color: "blue", rarity: "Rare" },
      { value: "3", label: "3", color: "purple", rarity: "Epic" },
      { value: "4", label: "4", color: "orange", rarity: "Legendary" },
      { value: "5", label: "5", color: "red", rarity: "Mythic" },
    ], [])

    return (
      <div
        ref={ref}
        className={cn(gradeToggleVariants({ size }), className)}
        {...props}
      >
        {grades.map((grade) => {
          const isSelected = selected === grade.value
          return (
            <button
              key={grade.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-selected={isSelected}
              onClick={() => handleSelect(grade.value)}
              disabled={disabled}
              className={cn(
                gradeButtonVariants({ size }),
                // Base state
                "transform-gpu transition-all duration-200 ease-out",
                // Disabled state (but keep selected grade at full opacity)
                disabled && !isSelected && "opacity-50 cursor-not-allowed",
                disabled && isSelected && "cursor-default",
                // Unselected: Simple gray
                !isSelected && !disabled && [
                  "bg-gray-800/50 text-gray-400 border border-gray-700",
                  "hover:border-gray-500",
                  "hover:text-gray-200",
                ],
                !isSelected && disabled && [
                  "bg-gray-800/50 text-gray-400 border border-gray-700",
                ],
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2",
                // Selected state with glass effect (no scale, just color)
                isSelected && [
                  "!text-white font-semibold ring-2 ring-offset-0 border-0",
                  "shadow-lg",
                  "[text-shadow:_0_1px_2px_rgb(0_0_0_/_40%)]",
                  "hover:ring-[3px]",
                  "relative overflow-hidden",
                  // Glass shine effect
                  "before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent",
                ],
                // Grade-specific colors when selected (RPG rarity with glass effect)
                isSelected && grade.color === "gray" && "bg-gray-500/30 ring-gray-500",
                isSelected && grade.color === "green" && "bg-green-500/30 ring-green-500",
                isSelected && grade.color === "blue" && "bg-blue-500/30 ring-blue-500",
                isSelected && grade.color === "purple" && "bg-purple-500/30 ring-purple-500",
                isSelected && grade.color === "orange" && "bg-orange-500/30 ring-orange-500",
                isSelected && grade.color === "red" && "bg-red-500/30 ring-red-500",
              )}
            >
              <span className="relative z-10 text-2xl font-bold">{grade.label}</span>
            </button>
          )
        })}
      </div>
    )
  }
)
GradeToggle.displayName = "GradeToggle"

export { GradeToggle, gradeToggleVariants }
