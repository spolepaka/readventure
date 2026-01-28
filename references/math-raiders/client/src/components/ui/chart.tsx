import * as React from "react"
import { cn } from "@/lib/utils"

export interface ChartConfig {
  [key: string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
  }
}

interface ChartContextProps {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

export function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }
  return context
}

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig
  children: React.ReactNode
}

export const ChartContainer = React.forwardRef<
  HTMLDivElement,
  ChartContainerProps
>(({ className, children, config, ...props }, ref) => {
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        className={cn(
          "[&_.recharts-cartesian-grid]:stroke-muted [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-axis-line]:stroke-border",
          className
        )}
        {...props}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: Object.entries(config).reduce(
              (acc, [key, value]) =>
                value.color
                  ? acc +
                    `
                    [data-chart="${key}"] {
                      --color-${key}: ${value.color};
                    }
                  `
                  : acc,
              ""
            ),
          }}
        />
        {children}
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = "ChartContainer"

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{
    color?: string
    dataKey?: string
    value?: React.ReactNode
    payload?: unknown
  }>
  label?: string
  labelFormatter?: (value: any) => React.ReactNode
  formatter?: (value: any, name: any) => React.ReactNode
  cursor?: boolean
}

export const ChartTooltip = React.forwardRef<
  HTMLDivElement,
  ChartTooltipProps
>(({ active, payload, label, labelFormatter, formatter, cursor = true }, ref) => {
  const { config } = useChart()

  if (!active || !payload?.length) {
    return null
  }

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border bg-background p-2 shadow-sm",
        cursor && "cursor-default"
      )}
    >
      {label && (
        <div className="mb-1 px-2 py-1.5 text-sm font-medium">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {payload.map((item, index) => {
          const key = item.dataKey || ""
          const itemConfig = config[key] || {}
          const value = formatter
            ? formatter(item.value, key)
            : item.value

          return (
            <div
              key={index}
              className="flex items-center gap-2 px-2 py-1 text-sm"
            >
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: item.color || `hsl(var(--color-${key}))`,
                }}
              />
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {itemConfig.label || key}
                </span>
                <span className="font-mono font-medium tabular-nums">
                  {value}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
ChartTooltip.displayName = "ChartTooltip"

interface ChartLegendProps {
  payload?: Array<{
    value: string
    type?: string
    id?: string
    color?: string
  }>
  verticalAlign?: "top" | "bottom"
  align?: "left" | "center" | "right"
}

export const ChartLegend = React.forwardRef<
  HTMLDivElement,
  ChartLegendProps
>(({ payload, verticalAlign = "bottom", align = "center" }, ref) => {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        align === "left" && "justify-start",
        align === "center" && "justify-center",
        align === "right" && "justify-end"
      )}
    >
      {payload.map((item, index) => {
        const key = item.value
        const itemConfig = config[key] || {}

        return (
          <div key={index} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: item.color || `hsl(var(--color-${key}))`,
              }}
            />
            <span className="text-sm font-medium">
              {itemConfig.label || key}
            </span>
          </div>
        )
      })}
    </div>
  )
})
ChartLegend.displayName = "ChartLegend"

// Re-export Recharts tooltip content with styling
export const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  ChartTooltipProps & { indicator?: "line" | "dot" | "dashed" }
>(({ active, payload, label, labelFormatter, formatter, indicator = "dot" }, ref) => {
  const { config } = useChart()

  if (!active || !payload?.length) {
    return null
  }

  const indicatorStyles = {
    dot: "h-2.5 w-2.5 rounded-full",
    line: "h-4 w-0.5",
    dashed: "h-4 w-0.5 border-l-2 border-dashed bg-transparent",
  }

  return (
    <div
      ref={ref}
      className="rounded-lg border bg-background p-2 shadow-sm"
    >
      {label && (
        <div className="mb-1 px-2 py-1.5 text-sm font-medium">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {payload.map((item, index) => {
          const key = item.dataKey || ""
          const itemConfig = config[key] || {}
          const value = formatter
            ? formatter(item.value, key)
            : item.value

          return (
            <div
              key={index}
              className="flex items-center gap-2 px-2 py-1 text-sm"
            >
              <div
                className={indicatorStyles[indicator]}
                style={{
                  backgroundColor: indicator === "dashed" ? undefined : item.color || `hsl(var(--color-${key}))`,
                  borderColor: indicator === "dashed" ? item.color || `hsl(var(--color-${key}))` : undefined,
                }}
              />
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {itemConfig.label || key}
                </span>
                <span className="font-mono font-medium tabular-nums">
                  {value}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
ChartTooltipContent.displayName = "ChartTooltipContent"

// Re-export Recharts legend content with styling
export const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  ChartLegendProps
>(({ payload, verticalAlign = "bottom", align = "center" }, ref) => {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        align === "left" && "justify-start",
        align === "center" && "justify-center",
        align === "right" && "justify-end"
      )}
    >
      {payload.map((item, index) => {
        const key = item.value
        const itemConfig = config[key] || {}

        return (
          <div key={index} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: item.color || `hsl(var(--color-${key}))`,
              }}
            />
            <span className="text-sm font-medium">
              {itemConfig.label || key}
            </span>
          </div>
        )
      })}
    </div>
  )
})
ChartLegendContent.displayName = "ChartLegendContent"
