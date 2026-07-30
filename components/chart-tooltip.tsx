import React from "react"

/**
 * Tooltip padrão pros gráficos Recharts do sistema.
 * Usa a classe bg-card, que já ganha vidro fosco (blur) automaticamente via globals.css.
 */
export function ChartTooltip({ active, payload, label, valueFormatter }: any) {
  if (!active || !payload?.length) return null
  const ponto = payload[0]?.payload
  const descricaoProduto = ponto?.descricao?.trim()
  return (
    <div className="bg-card border border-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1.5 min-w-[140px]">
      {label !== undefined && (
        <div className="mb-1">
          <p className="font-bold text-foreground">{label}</p>
          {descricaoProduto && <p className="text-[10px] text-muted-foreground mt-0.5">{descricaoProduto}</p>}
        </div>
      )}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
            {p.name}
          </span>
          <strong className="text-foreground tabular-nums">
            {valueFormatter ? valueFormatter(p.value, p) : `${p.value}${p.unit ?? ""}`}
          </strong>
        </div>
      ))}
    </div>
  )
}
