"use client"

import React, { useState, useRef, useEffect } from "react"
import { Clock } from "lucide-react"

interface TimePickerProps {
  value: string // "HH:MM"
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"))

export function TimePicker({ value, onChange, className = "", placeholder = "--:--" }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [hh, mm] = value ? value.split(":") : ["", ""]

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  function setHora(h: string) {
    onChange(`${h}:${mm || "00"}`)
  }
  function setMinuto(m: string) {
    onChange(`${hh || "00"}:${m}`)
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-10 px-3 flex items-center justify-between rounded-md border border-border bg-input text-sm text-foreground hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <span className={value ? "text-foreground tabular-nums" : "text-muted-foreground"}>
          {value || placeholder}
        </span>
        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-40 rounded-xl border border-border bg-card shadow-xl p-2">
          <div className="flex items-center justify-between px-1 pb-1.5 mb-1.5 border-b border-border">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Hora</span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Min</span>
          </div>
          <div className="flex gap-1 h-40">
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
              {HOURS.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHora(h)}
                  className={`w-full h-7 flex items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors
                    ${hh === h ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
                >
                  {h}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
              {MINUTES.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMinuto(m)}
                  className={`w-full h-7 flex items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-colors
                    ${mm === m ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false) }}
              className="text-[10px] font-bold text-muted-foreground hover:text-foreground uppercase tracking-wider transition-colors"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[10px] font-bold text-primary hover:text-primary/80 uppercase tracking-wider transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
