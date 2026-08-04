"use client"

import React, { useState } from "react"
import { Clock } from "lucide-react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { HOURS, MINUTES, selectHour, selectMinute } from "@/lib/time-picker"

interface TimePickerProps {
  value: string // "HH:MM"
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}

export function TimePicker({ value, onChange, className = "", placeholder = "--:--" }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const [hh, mm] = value ? value.split(":") : ["", ""]

  function setHora(h: string) {
    onChange(selectHour(value, h))
  }
  function setMinuto(m: string) {
    onChange(selectMinute(value, m))
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className={className}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-border bg-input px-3 text-sm text-foreground transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <span className={value ? "text-foreground tabular-nums" : "text-muted-foreground"}>
              {value || placeholder}
            </span>
            <Clock className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </button>
        </PopoverPrimitive.Trigger>
      </div>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className="z-[100] w-40 rounded-xl border border-border bg-card p-2 shadow-xl outline-none"
        >
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
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
