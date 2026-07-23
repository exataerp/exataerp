"use client"

import React, { useState, useMemo } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts"
import { Input } from "@/components/ui/input"
import { Pencil } from "lucide-react"

interface Operation {
  id: string
  name: string
  time: number
  setupTime: number
  unit: "minutes" | "seconds"
  maquina_id?: string
  maquina_nome?: string
  maquina_codigo?: string
}

interface GBOChartProps {
  operations: Operation[]
  timeUnit: "minutes" | "seconds"
  taktTime?: number
  taktTimeUnit?: "minutes" | "seconds" | "hours"
  demandUnit?: string
}

interface ChartDataPoint {
  name: string
  time: number
  isBottleneck: boolean
  exceedsTakt: boolean
  index: number
  originalUnit: "minutes" | "seconds"
}

interface CustomTooltipProps {
  active?: boolean
  payload?: { payload: ChartDataPoint }[]
  label?: string
}

export const GBOChart = React.memo(function GBOChart({ operations, timeUnit, taktTime, taktTimeUnit, demandUnit = "un" }: GBOChartProps) {
  const [chartTitle, setChartTitle] = useState("Gráfico de Balanceamento de Operações")
  const [isEditingTitle, setIsEditingTitle] = useState(false)

  const { chartData, averageTime, taktTimeInDisplayUnit, originalTaktValue, yAxisMax } = useMemo(() => {
    const convertToSeconds = (time: number, unit: "minutes" | "seconds"): number => {
      return unit === "minutes" ? time * 60 : time
    }

    const convertFromSeconds = (timeInSeconds: number, targetUnit: "minutes" | "seconds"): number => {
      return targetUnit === "minutes" ? timeInSeconds / 60 : timeInSeconds
    }

    const operationsInSeconds = operations.map((op) => ({
      ...op,
      timeInSeconds: convertToSeconds(op.time, op.unit),
    }))

    const operationsInDisplayUnit = operationsInSeconds.map((op) => ({
      ...op,
      timeInDisplayUnit: convertFromSeconds(op.timeInSeconds, timeUnit),
    }))

    const averageTimeInSeconds = operationsInSeconds.length > 0 
      ? operationsInSeconds.reduce((sum, op) => sum + op.timeInSeconds, 0) / operationsInSeconds.length
      : 0
    const avgTime = convertFromSeconds(averageTimeInSeconds, timeUnit)

    const taktDisplay = taktTime ? convertFromSeconds(taktTime, timeUnit) : undefined

    const origTakt = taktTime ? (
      taktTimeUnit === "hours" ? taktTime / 3600 :
      taktTimeUnit === "minutes" ? taktTime / 60 :
      taktTime
    ) : undefined

    const maxOperationTime = operationsInDisplayUnit.length > 0 ? Math.max(...operationsInDisplayUnit.map((op) => op.timeInDisplayUnit)) : 0
    const maxOperationWithPadding = maxOperationTime * 1.1
    const taktWithPadding = taktDisplay ? taktDisplay * 1.1 : 0
    
    const yMax = Math.ceil(Math.max(maxOperationWithPadding, taktWithPadding, 1))

    const data: ChartDataPoint[] = operationsInDisplayUnit.map((operation, index) => {
      const isMaxTime = operation.timeInSeconds === Math.max(...operationsInSeconds.map((op) => op.timeInSeconds))
      const exceedsTakt = taktTime ? operation.timeInSeconds > taktTime : false
      const isBottleneck = isMaxTime || exceedsTakt

      return {
        name: operation.name,
        time: operation.timeInDisplayUnit,
        isBottleneck,
        exceedsTakt,
        index: index + 1,
        originalUnit: operation.unit,
      }
    })

    return {
      chartData: data,
      averageTime: avgTime,
      taktTimeInDisplayUnit: taktDisplay,
      originalTaktValue: origTakt,
      yAxisMax: yMax
    }
  }, [operations, timeUnit, taktTime, taktTimeUnit, demandUnit])

  const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-semibold">{label}</p>
          <p className="text-sm">
            <span className="text-muted-foreground">Tempo: </span>
            <span className={data.isBottleneck ? "text-chart-5 font-semibold" : "text-foreground"}>
              {data.time.toFixed(1)} {timeUnit}
            </span>
          </p>
          {data.originalUnit !== timeUnit && (
            <p className="text-xs text-muted-foreground">
              Original: {operations.find((op) => op.name === data.name)?.time.toFixed(1)} {data.originalUnit}
            </p>
          )}
          {data.isBottleneck && <p className="text-xs text-chart-5 font-medium mt-1">🔴 Operação Gargalo</p>}
        </div>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="w-full">
          <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingTitle(true)}>
            {isEditingTitle ? (
              <Input
                autoFocus
                value={chartTitle}
                onChange={(e) => setChartTitle(e.target.value)}
                onBlur={() => setIsEditingTitle(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
                className="text-xl font-bold h-8 w-full max-w-md bg-transparent border-primary/30 text-primary"
              />
            ) : (
              <h2 className="text-xl font-bold text-foreground">
                {chartTitle}
                <Pencil className="h-4 w-4 inline-block ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground print:hidden" />
              </h2>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Visualização dos tempos operacionais com destaque para restrições sistêmicas
          </p>
        </div>
      </div>

      <div className="flex items-center gap-6 mb-6 text-sm bg-muted/20 p-3 rounded-lg border border-border/50">
        <span className="text-muted-foreground">
          <strong>Média:</strong> <span className="text-foreground">{averageTime.toFixed(1)} {timeUnit}</span>
        </span>
        {taktTimeInDisplayUnit && (
          <span className="text-muted-foreground">
            <strong>Takt:</strong> <span className="text-foreground">{taktTimeInDisplayUnit.toFixed(1)} {timeUnit}</span>
            {taktTimeUnit !== timeUnit && originalTaktValue && (
              <span className="text-xs opacity-60 ml-2">
                ({originalTaktValue.toFixed(2)} {taktTimeUnit}/{demandUnit})
              </span>
            )}
          </span>
        )}
      </div>

      <div className="h-[450px] w-full mt-2 print:h-[50vh]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 35, bottom: 65 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" vertical={false} />
            <XAxis 
              dataKey="name" 
              angle={-45} 
              textAnchor="end" 
              height={65} 
              interval={0} 
              fontSize={11}
              tickMargin={15}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickLine={false}
            />
            <YAxis
              label={{ value: `Tempo (${timeUnit})`, angle: -90, position: "insideLeft", offset: 15, fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              fontSize={11}
              domain={[0, yAxisMax]}
              tickFormatter={(value: number | string) => parseFloat(Number(value).toFixed(1)).toString()}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted)/0.4)' }} />
            <ReferenceLine y={averageTime} stroke="hsl(var(--chart-3))" strokeDasharray="5 5" opacity={0.7} />
            {taktTimeInDisplayUnit && (
              <ReferenceLine y={taktTimeInDisplayUnit} stroke="hsl(var(--foreground))" strokeDasharray="8 4" strokeWidth={2} opacity={0.8} />
            )}
            <Bar dataKey="time" radius={[6, 6, 0, 0]} isAnimationActive={false} maxBarSize={60}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.exceedsTakt ? "hsl(var(--destructive))" : entry.isBottleneck ? "hsl(var(--primary)/0.7)" : "hsl(var(--primary))"}
                  className="transition-all duration-300 hover:opacity-80"
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-6 mt-4 text-xs flex-wrap font-medium text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-primary"></div>
          <span>Operação Normal</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-destructive"></div>
          <span>Excede Takt Time</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-chart-3 border-dashed"></div>
          <span>Tempo Médio</span>
        </div>
        {taktTimeInDisplayUnit && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-foreground border-t-2 border-dashed"></div>
            <span>Takt Time</span>
          </div>
        )}
      </div>
    </div>
  )
})
