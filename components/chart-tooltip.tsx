import React from "react"

/**
 * Tooltip padrão pros gráficos Recharts do sistema.
 * Usa a classe bg-card, que já ganha vidro fosco (blur) automaticamente via globals.css.
 */
export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1.5 min-w-[140px]">
      {label !== undefined && <p className="font-bold text-foreground mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
            {p.name}
          </span>
          <strong className="text-foreground tabular-nums">{p.value}{p.unit ?? ""}</strong>
        </div>
      ))}
    </div>
  )
}
