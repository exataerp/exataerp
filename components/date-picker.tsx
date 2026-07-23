"use client"

import React, { useState, useRef, useEffect } from "react"
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react"

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
]
const DAYS_PT = ["D", "S", "T", "Q", "Q", "S", "S"]

interface DatePickerProps {
  value: string // "YYYY-MM-DD"
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}

function parseDate(val: string): Date | null {
  if (!val) return null
  const [y, m, d] = val.split("-").map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatDisplay(val: string): string {
  if (!val) return ""
  const [y, m, d] = val.split("-")
  if (!y || !m || !d) return ""
  return `${d}/${m}/${y}`
}

export function DatePicker({ value, onChange, className = "", placeholder = "dd/mm/aaaa" }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const parsed = parseDate(value)
  const today = new Date()
  const [view, setView] = useState<Date>(parsed ?? today)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (parsed) setView(parsed)
  }, [value])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const year = view.getFullYear()
  const month = view.getMonth()

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let i = 1; i <= daysInMonth; i++) cells.push(i)

  function prevMonth() {
    setView(new Date(year, month - 1, 1))
  }
  function nextMonth() {
    setView(new Date(year, month + 1, 1))
  }
  function selectDay(day: number) {
    const d = new Date(year, month, day)
    onChange(toISO(d))
    setOpen(false)
  }
  function isSelected(day: number) {
    if (!parsed) return false
    return parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day
  }
  function isToday(day: number) {
    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-10 px-3 flex items-center justify-between rounded-md border border-border bg-input text-sm text-foreground hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <span className={value ? "text-foreground" : "text-muted-foreground"}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 rounded-xl border border-border bg-card shadow-xl p-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={prevMonth}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">
              {MONTHS_PT[month]} {year}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_PT.map((d, i) => (
              <div key={i} className="h-7 flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase">
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => (
              <div key={i} className="flex items-center justify-center">
                {day === null ? (
                  <div className="h-7 w-7" />
                ) : (
                  <button
                    type="button"
                    onClick={() => selectDay(day)}
                    className={`h-7 w-7 flex items-center justify-center rounded-lg text-xs font-medium transition-colors
                      ${isSelected(day)
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : isToday(day)
                        ? "border border-primary text-primary font-bold hover:bg-primary/10"
                        : "text-foreground hover:bg-muted"
                      }`}
                  >
                    {day}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false) }}
              className="text-[10px] font-bold text-muted-foreground hover:text-foreground uppercase tracking-wider transition-colors"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => { onChange(toISO(today)); setOpen(false) }}
              className="text-[10px] font-bold text-primary hover:text-primary/80 uppercase tracking-wider transition-colors"
            >
              Hoje
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
