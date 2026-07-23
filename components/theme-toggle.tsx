"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Previne erros de hidratação (quando o servidor e o navegador discordam do tema inicial)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    // Placeholder invisível para evitar que o layout pule enquanto carrega
    return <div className="h-8 w-[210px] rounded-full" />
  }

  return (
    <div className="flex items-center p-1 rounded-full border border-border/50 bg-muted/20 backdrop-blur-sm">
      <button
        onClick={() => setTheme("light")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest uppercase transition-all ${
          theme === "light"
            ? "bg-background text-foreground shadow-sm border border-border/50"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
      >
        <Sun className="h-3 w-3" /> Claro
      </button>
      
      <button
        onClick={() => setTheme("dark")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest uppercase transition-all ${
          theme === "dark"
            ? "bg-background text-foreground shadow-sm border border-border/50"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
      >
        <Moon className="h-3 w-3" /> Escuro
      </button>
      
      <button
        onClick={() => setTheme("system")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest uppercase transition-all ${
          theme === "system"
            ? "bg-background text-foreground shadow-sm border border-border/50"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
      >
        <Monitor className="h-3 w-3" /> Sistema
      </button>
    </div>
  )
}
