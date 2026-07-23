"use client"

import React from "react"

interface StatusDotProps {
  color?: "green" | "amber" | "red" | "muted"
  pulse?: boolean
  className?: string
}

const CORES: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-destructive",
  muted: "bg-muted-foreground/40",
}

/** Bolinha de status, com ping animado quando algo está ativo agora (ex: máquina em produção). */
export function StatusDot({ color = "green", pulse = true, className = "" }: StatusDotProps) {
  const cor = CORES[color] ?? CORES.green
  return (
    <span className={`relative inline-flex h-2.5 w-2.5 ${className}`}>
      {pulse && (
        <span className={`absolute inline-flex h-full w-full rounded-full ${cor} opacity-60 animate-ping`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${cor}`} />
    </span>
  )
}
