"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GripVertical, Trash2, Pencil, Check, X } from "lucide-react"

// Interface 100% alinhada com o GBO e Export Utils
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

interface DraggableOperationsListProps {
  operations: Operation[]
  timeUnit: "minutes" | "seconds"
  onReorder: (operations: Operation[]) => void
  onRemove: (id: string) => void
  onEdit?: (id: string, name: string, time: number) => void
}

export function DraggableOperationsList({
  operations,
  timeUnit,
  onReorder,
  onRemove,
  onEdit,
}: DraggableOperationsListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editTime, setEditTime] = useState("")

  const handleDragStart = (index: number) => setDraggedIndex(index)

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newOperations = [...operations]
    const draggedOp = newOperations[draggedIndex]
    newOperations.splice(draggedIndex, 1)
    newOperations.splice(index, 0, draggedOp)

    onReorder(newOperations)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => setDraggedIndex(null)

  const startEditing = (op: Operation) => {
    setEditingId(op.id)
    setEditName(op.name)
    setEditTime(op.time.toString())
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditName("")
    setEditTime("")
  }

  const saveEditing = (id: string) => {
    const time = parseFloat(editTime)
    if (!editName.trim() || isNaN(time) || time <= 0) return

    if (onEdit) {
      onEdit(id, editName.trim(), time)
    }
    setEditingId(null)
  }

  if (operations.length === 0) return null

  return (
    <div className="space-y-2 mt-6">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
        Operações Adicionadas ({operations.length})
      </h3>
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
        {operations.map((op, index) => (
          <div
            key={op.id}
            draggable={editingId !== op.id}
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-3 p-3 bg-card border rounded-lg transition-all ${
              draggedIndex === index ? "opacity-50 border-primary" : "border-border hover:border-primary/50"
            }`}
          >
            <div className={`p-1 text-muted-foreground ${editingId === op.id ? "opacity-30" : "cursor-grab active:cursor-grabbing hover:text-foreground"}`}>
              <GripVertical className="h-4 w-4" />
            </div>
            
            <div className="flex-1 flex items-center justify-between min-w-0">
              {editingId === op.id ? (
                <div className="flex items-center gap-2 flex-1 mr-2">
                  <Input 
                    value={editName} 
                    onChange={(e) => setEditName(e.target.value)} 
                    className="h-8 text-sm tech-glow bg-background" 
                    placeholder="Nome"
                    autoFocus
                  />
                  <Input 
                    type="number" 
                    step="0.1" 
                    min="0"
                    value={editTime} 
                    onChange={(e) => setEditTime(e.target.value)} 
                    className="h-8 w-20 text-sm tech-glow bg-background" 
                    placeholder="Tempo"
                    onKeyDown={(e) => e.key === 'Enter' && saveEditing(op.id)}
                  />
                </div>
              ) : (
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{op.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Ciclo: {op.time.toFixed(1)} {op.unit} {op.setupTime > 0 ? `| Setup: ${op.setupTime} ${op.unit}` : ""}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-1 ml-2">
                {editingId === op.id ? (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-green-500 hover:text-green-500 hover:bg-green-500/10" onClick={() => saveEditing(op.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={cancelEditing}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => startEditing(op)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => onRemove(op.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
