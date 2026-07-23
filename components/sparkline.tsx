import React from "react"
import { AreaChart, Area, ResponsiveContainer } from "recharts"

interface SparklineProps {
  data: number[]
  color?: string // classe de cor tailwind tipo "text-primary"
  height?: number
}

/** Mini gráfico de tendência, sem eixos nem grade — só a forma da curva com área em gradiente. */
export function Sparkline({ data, color = "text-primary", height = 32 }: SparklineProps) {
  if (!data || data.length < 2) return null
  const id = React.useId().replace(/:/g, "")
  const points = data.map((v, i) => ({ i, v }))

  return (
    <div style={{ height }} className={color}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke="currentColor"
            strokeWidth={1.5}
            fill={`url(#spark-${id})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
