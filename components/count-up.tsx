"use client"

import React, { useEffect, useRef, useState } from "react"

interface CountUpProps {
  value: number
  duration?: number // ms
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
}

/** Anima um número subindo de 0 até o valor real quando ele muda. */
export function CountUp({ value, duration = 500, decimals = 0, prefix = "", suffix = "", className = "" }: CountUpProps) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = fromRef.current
    const to = Number.isFinite(value) ? value : 0
    const start = performance.now()

    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cúbico
      const current = from + (to - from) * eased
      setDisplay(current)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  const formatted = display.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return <span className={className}>{prefix}{formatted}{suffix}</span>
}
