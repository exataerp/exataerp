"use client"

import React, { useState, useRef, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { CalculationsDashboard } from "@/components/calculations-dashboard"
import { DraggableOperationsList } from "@/components/draggable-operations-list"
import { exportToExcel, importFromExcel, downloadTemplate } from "@/components/export-utils"
import { useToast } from "@/hooks/use-toast"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { GBOChart } from "@/components/gbo-chart"
import { supabase } from "@/components/supabase"
import { Plus, Download, Upload, FileSpreadsheet, CheckCircle2, FileImage, ChevronDown, Save, BookOpen, Pencil, Trash2, Search, ChevronRight, FilePlus2, X, Package } from "lucide-react"

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

interface MaquinaDatabase {
  id: string
  nome: string
  codigo: string
  tempo_setup_padrao?: number
}

interface BomItem {
  insumo_id: string
  insumo_codigo: string
  insumo_descricao: string
  unidade_medida: string
  quantidade: number
}

interface OperacaoDatabase {
  nome: string
  tempo: number
  unidade: "minutes" | "seconds"
  ordem?: number
  setup_time?: number
  maquina_id?: string
}

interface ProdutoDatabase {
  id: string
  codigo: string
  descricao: string
  operacoes?: OperacaoDatabase[]
}

const validateNumber = (value: string, min = 0): { isValid: boolean; error?: string } => {
  if (!value.trim()) return { isValid: false, error: "Campo obrigatório" }
  const num = Number.parseFloat(value)
  if (isNaN(num)) return { isValid: false, error: "Deve ser um número válido" }
  if (num < min) return { isValid: false, error: `Deve ser maior ou igual a ${min}` }
  return { isValid: true }
}

const validateText = (value: string): { isValid: boolean; error?: string } => {
  if (!value.trim()) return { isValid: false, error: "Campo obrigatório" }
  if (value.trim().length < 2) return { isValid: false, error: "Mínimo 2 caracteres" }
  return { isValid: true }
}

type CalcType = "takt" | "media" | "soma"

export function GBOTab({ user, empresaAtivaId }: { user: { id: string }, empresaAtivaId?: string | null }) {
  const [operations, setOperations] = useState<Operation[]>([])
  const [timeUnit, setTimeUnit] = useState<"minutes" | "seconds">("minutes")
  const [productCode, setProductCode] = useState("")
  const [productName, setProductName] = useState("")
  const [calcType, setCalcType] = useState<CalcType>("takt")
  const [newOperationName, setNewOperationName] = useState("")
  const [newOperationTime, setNewOperationTime] = useState("")
  const [newOperationSetup, setNewOperationSetup] = useState("")
  const [newOperationMaquinaId, setNewOperationMaquinaId] = useState("")
  const [maquinasGlobais, setMaquinasGlobais] = useState<MaquinaDatabase[]>([])
  
  const [errors, setErrors] = useState<{ operationName?: string; operationTime?: string; operationSetup?: string }>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [savedProducts, setSavedProducts] = useState<Array<{ code: string; description: string; steps: Array<{ name: string; cycleTime: number; setupTime: number; maquina_id?: string }> }>>([])
  const [showProductsPanel, setShowProductsPanel] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState<{ product: any; index: number } | null>(null)

  const [productSearch, setProductSearch] = useState("")
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)

  // BOM
  const [bomItems, setBomItems] = useState<BomItem[]>([])
  const [insumos, setInsumos] = useState<{ id: string; codigo: string; descricao: string; unidade_medida: string }[]>([])
  const [showBom, setShowBom] = useState(false)
  const [novoBomInsumoId, setNovoBomInsumoId] = useState("")
  const [novoBomQtd, setNovoBomQtd] = useState("")

  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const loadMaquinas = async () => {
    if (!empresaAtivaId) return
    try {
      const { data } = await supabase
        .from("maquinas")
        .select("id, nome, codigo, tempo_setup_padrao")
        .neq("status", "inativa")
        .eq("empresa_id", empresaAtivaId)
      if (data) setMaquinasGlobais(data as MaquinaDatabase[])
    } catch (e) {
      // Ignorado silenciosamente
    }
  }

  const loadInsumos = async () => {
    if (!empresaAtivaId) return
    const { data } = await supabase
      .from("insumos")
      .select("id, codigo, descricao, unidade_medida")
      .eq("empresa_id", empresaAtivaId)
      .order("codigo")
    if (data) setInsumos(data)
  }

  const loadBomDoProduto = async (codigo: string) => {
    if (!empresaAtivaId || !codigo) { setBomItems([]); return }
    const { data: prod } = await supabase
      .from("produtos")
      .select("id")
      .eq("codigo", codigo)
      .eq("empresa_id", empresaAtivaId)
      .single()
    if (!prod) { setBomItems([]); return }
    const { data: bom } = await supabase
      .from("bom_itens")
      .select("insumo_id, quantidade, unidade_medida, insumos(codigo, descricao, unidade_medida)")
      .eq("empresa_id", empresaAtivaId)
      .eq("produto_codigo", codigo)
    if (bom) {
      setBomItems(bom.map((b: any) => ({
        insumo_id: b.insumo_id,
        insumo_codigo: b.insumos?.codigo ?? "",
        insumo_descricao: b.insumos?.descricao ?? "",
        unidade_medida: b.unidade_medida,
        quantidade: b.quantidade,
      })))
    }
  }

  const loadSavedProducts = async () => {
    if (!empresaAtivaId) return
    try {
      const { data: prods, error } = await supabase
        .from("produtos")
        .select(`id, codigo, descricao, operacoes (nome, tempo, unidade, ordem, setup_time, maquina_id)`)
        .order("ordem", { foreignTable: "operacoes" })
        .eq("empresa_id", empresaAtivaId)

      if (error) throw error

      if (prods) {
        const formatted = (prods as ProdutoDatabase[]).map((p) => ({
          code: p.codigo,
          description: p.descricao,
          steps: (p.operacoes || []).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((o) => ({
            name: o.nome,
            cycleTime: o.unidade === "minutes" ? o.tempo * 60 : o.tempo,
            setupTime: o.unidade === "minutes" ? (o.setup_time || 0) * 60 : (o.setup_time || 0),
            maquina_id: o.maquina_id
          }))
        }))
        setSavedProducts(formatted)
        localStorage.setItem("gbo_products", JSON.stringify(formatted))
      }
    } catch (e) {
      const data = localStorage.getItem("gbo_products")
      if (data) setSavedProducts(JSON.parse(data))
    }
  }

  useEffect(() => {
    if (empresaAtivaId) {
      loadMaquinas()
      loadInsumos()
      const savedSession = localStorage.getItem(`exata_session_${empresaAtivaId}`)
      if (savedSession) {
        try {
          const parsed = JSON.parse(savedSession)
          if (parsed.operations) setOperations(parsed.operations)
          if (parsed.productCode) setProductCode(parsed.productCode)
          if (parsed.productName) setProductName(parsed.productName)
          if (parsed.calcType) setCalcType(parsed.calcType)
          if (parsed.timeUnit) setTimeUnit(parsed.timeUnit)
        } catch (e) {
          // Ignorado
        }
      }
      loadSavedProducts()
    }
    setIsLoaded(true)
    window.addEventListener("sync_gbo_products", loadSavedProducts)
    return () => window.removeEventListener("sync_gbo_products", loadSavedProducts)
  }, [empresaAtivaId])

  useEffect(() => {
    if (isLoaded && empresaAtivaId) {
      localStorage.setItem(`exata_session_${empresaAtivaId}`, JSON.stringify({ operations, productCode, productName, calcType, timeUnit }))
    }
  }, [operations, productCode, productName, calcType, timeUnit, isLoaded, empresaAtivaId])

  const totalCycleTime = useMemo(() => {
    if (operations.length === 0) return 0
    if (calcType === "soma") return operations.reduce((sum, op) => sum + op.time, 0)
    if (calcType === "media") return operations.reduce((sum, op) => sum + op.time, 0) / operations.length
    if (calcType === "takt") return Math.max(...operations.map((op) => op.time))
    return 0
  }, [operations, calcType])

  const handleMaquinaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    setNewOperationMaquinaId(val)
    const maq = maquinasGlobais.find(m => m.id === val)
    if (maq && maq.tempo_setup_padrao !== undefined) {
      setNewOperationSetup(maq.tempo_setup_padrao.toString())
    }
  }

  const addOperation = () => {
    const nameValidation = validateText(newOperationName)
    const timeValidation = validateNumber(newOperationTime)
    const newErrors: typeof errors = {}

    if (!nameValidation.isValid) newErrors.operationName = nameValidation.error
    if (!timeValidation.isValid) newErrors.operationTime = timeValidation.error

    setErrors(newErrors)

    if (!nameValidation.isValid || !timeValidation.isValid) {
      toast({ title: "Dados inválidos", description: "Verifique os campos destacados.", variant: "destructive" })
      return
    }

    const maq = maquinasGlobais.find(m => m.id === newOperationMaquinaId)
    const token = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

    const newOperation: Operation = {
      id: token,
      name: newOperationName.trim(),
      time: Number.parseFloat(newOperationTime),
      setupTime: newOperationSetup ? Number.parseFloat(newOperationSetup) : 0,
      unit: timeUnit,
      maquina_id: newOperationMaquinaId || undefined,
      maquina_nome: maq ? maq.nome : undefined,
      maquina_codigo: maq ? maq.codigo : undefined
    }

    setOperations([...operations, newOperation])
    setNewOperationName("")
    setNewOperationTime("")
    setNewOperationSetup("")
    setNewOperationMaquinaId("")
    setErrors({})
    toast({ title: "✅ Operação adicionada", description: `"${newOperation.name}" foi adicionada.` })
  }

  const removeOperation = (id: string) => {
    const operation = operations.find((op) => op.id === id)
    setOperations(operations.filter((op) => op.id !== id))
    if (operation) toast({ title: "Operação removida", description: `"${operation.name}" foi removida.` })
  }

  const editOperation = (id: string, newName: string, newTime: number) => {
    setOperations(operations.map((op) => (op.id === id ? { ...op, name: newName, time: newTime } : op)))
    toast({ title: "✅ Atualizado", description: `Operação "${newName}" atualizada.` })
  }

  const reorderOperations = (newOperations: Operation[]) => {
    setOperations(newOperations)
    toast({ title: "✅ Ordem atualizada", description: "A ordem das operações foi reorganizada." })
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") addOperation()
  }

  const handleNovoProduct = () => {
    setProductCode("")
    setProductName("")
    setOperations([])
    setBomItems([])
    setCalcType("takt")
    setTimeUnit("minutes")
    setNewOperationName("")
    setNewOperationTime("")
    setNewOperationSetup("")
    setNewOperationMaquinaId("")
    setNovoBomInsumoId("")
    setNovoBomQtd("")
    setErrors({})
    toast({ title: "Novo produto", description: "Campos limpos. Cadastre o novo produto." })
  }

  const buildNewProduct = () => ({
    code: productCode.trim(),
    description: productName.trim(),
    steps: operations.map((op) => ({
      name: op.name,
      cycleTime: timeUnit === "minutes" ? op.time * 60 : op.time,
      setupTime: timeUnit === "minutes" ? (op.setupTime || 0) * 60 : (op.setupTime || 0),
      maquina_id: op.maquina_id
    })),
  })

  const commitSaveProduct = async (product: ReturnType<typeof buildNewProduct>) => {
    setIsLoading(true)
    try {
      const { data: prodData, error: prodError } = await supabase
        .from("produtos")
        .upsert({ 
          codigo: product.code, 
          descricao: product.description,
          ...(empresaAtivaId && { empresa_id: empresaAtivaId }) 
        }, { onConflict: "empresa_id,codigo" })
        .select()
        .single()

      if (prodError) throw prodError

      await supabase.from("operacoes").delete().eq("produto_id", prodData.id)

      const opsToInsert = operations.map((op, index) => ({
        produto_id: prodData.id,
        ordem: index + 1,
        nome: op.name,
        tempo: op.time,
        unidade: op.unit,
        setup_time: op.setupTime,
        maquina_id: op.maquina_id || null,
        empresa_id: empresaAtivaId || null,
      }))

      const { error: opsError } = await supabase.from("operacoes").insert(opsToInsert)
      if (opsError) throw opsError

      // Salva BOM — apaga e recria
      await supabase.from("bom_itens").delete().eq("produto_codigo", product.code).eq("empresa_id", empresaAtivaId!)
      if (bomItems.length > 0) {
        const bomToInsert = bomItems.map(b => ({
          empresa_id: empresaAtivaId,
          produto_codigo: product.code,
          insumo_id: b.insumo_id,
          quantidade: b.quantidade,
          unidade_medida: b.unidade_medida,
        }))
        await supabase.from("bom_itens").insert(bomToInsert)
      }

      const existingData = localStorage.getItem("gbo_products")
      let productsArray = existingData ? JSON.parse(existingData) : []
      const existingIndex = productsArray.findIndex((p: { code: string }) => p.code === product.code)
      if (existingIndex >= 0) productsArray[existingIndex] = product
      else productsArray.push(product)
      localStorage.setItem("gbo_products", JSON.stringify(productsArray))

      window.dispatchEvent(new Event("sync_gbo_products"))
      await loadSavedProducts()
      setConfirmOverwrite(null)
      toast({ title: "✅ Sincronizado na Nuvem", description: "O roteiro está salvo e disponível no ecossistema Exata." })
    } catch (err: unknown) {
      toast({ title: "Erro ao salvar", description: (err as Error).message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveProduct = () => {
    if (!productCode.trim() || !productName.trim()) {
      toast({ title: "Erro de Cadastro", description: "O Código e o Nome do Produto são obrigatórios.", variant: "destructive" })
      return
    }
    if (operations.length === 0) {
      toast({ title: "Roteiro Vazio", description: "Adicione ao menos uma operação antes de salvar.", variant: "destructive" })
      return
    }
    const newProduct = buildNewProduct()
    const existingIndex = savedProducts.findIndex((p) => p.code === newProduct.code)
    if (existingIndex >= 0) {
      setConfirmOverwrite({ product: newProduct, index: existingIndex })
      return
    }
    commitSaveProduct(newProduct)
  }

  const handleLoadProduct = (product: typeof savedProducts[0]) => {
    const seed = Date.now()
    const ops = product.steps.map((step, i) => {
      const maq = maquinasGlobais.find(m => m.id === step.maquina_id)
      return {
        id: `${seed}-${Math.random().toString(36).substring(2, 7)}-${i}`,
        name: step.name,
        time: timeUnit === "minutes" ? step.cycleTime / 60 : step.cycleTime,
        setupTime: timeUnit === "minutes" ? step.setupTime / 60 : step.setupTime,
        unit: timeUnit,
        maquina_id: step.maquina_id,
        maquina_nome: maq ? maq.nome : undefined,
        maquina_codigo: maq ? maq.codigo : undefined
      }
    })
    setProductCode(product.code)
    setProductName(product.description)
    setOperations(ops)
    setShowProductsPanel(false)
    setProductSearch("")
    setExpandedProduct(null)
    loadBomDoProduto(product.code)

    // Scroll para o topo para revelar o gráfico
    window.scrollTo({ top: 0, behavior: "smooth" })

    toast({ title: "✅ Produto Carregado", description: `Roteiro "${product.description}" carregado para edição.` })
  }

  const handleDeleteProduct = async (code: string) => {
    if (!empresaAtivaId) {
      toast({ title: "Erro ao excluir", description: "Empresa não identificada. Recarregue a página.", variant: "destructive" })
      return
    }
    try {
      await supabase.from("produtos").delete().eq("codigo", code).eq("empresa_id", empresaAtivaId)
      
      const updated = savedProducts.filter((p) => p.code !== code)
      setSavedProducts(updated)
      localStorage.setItem("gbo_products", JSON.stringify(updated))
      window.dispatchEvent(new Event("sync_gbo_products"))
      if (expandedProduct === code) setExpandedProduct(null)
      toast({ title: "Produto Removido", description: `O roteiro "${code}" foi excluído da nuvem.` })
    } catch (e: unknown) {
      toast({ title: "Erro ao excluir", description: (e as Error).message, variant: "destructive" })
    }
  }

  const handleExportExcel = async () => {
    if (operations.length === 0) return
    setIsLoading(true)
    try {
      await exportToExcel(operations, timeUnit)
      toast({ title: "✅ Excel exportado", description: "A planilha foi baixada." })
    } catch {
      toast({ title: "❌ Erro", description: "Falha ao exportar Excel.", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  const handleExportChartPDF = () => {
    if (operations.length === 0) return
    setTimeout(() => window.print(), 300)
  }

  const handleImportExcel = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsLoading(true)
    try {
      const importedOperations = await importFromExcel(file)
      if (importedOperations.length === 0) {
        toast({ title: "Aviso", description: "O arquivo não contém operações válidas.", variant: "destructive" })
        return
      }
      setOperations(importedOperations)
      toast({ title: "✅ Importação concluída", description: `${importedOperations.length} operações carregadas.` })
    } catch {
      toast({ title: "❌ Erro", description: "Falha na importação.", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return savedProducts
    return savedProducts.filter(p =>
      p.code.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    )
  }, [savedProducts, productSearch])

  return (
    <React.Fragment>
      {confirmOverwrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Código já existe</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Já existe um produto com o código <span className="font-bold text-foreground">"{confirmOverwrite.product.code}"</span>. Deseja substituir o roteiro salvo pelo atual?
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmOverwrite(null)}
                className="flex-1 h-10 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => commitSaveProduct(confirmOverwrite.product)}
                className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-colors"
              >
                Substituir
              </button>
            </div>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />

      <div className="flex flex-col xl:flex-row gap-8 pb-12 print:p-0">
        <div className="xl:w-[35%] flex flex-col gap-6 print:hidden order-2 xl:order-1">

          <div className="bg-card p-6 rounded-2xl shadow-sm border border-border space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                Identificação do Produto
              </h3>
              <button
                onClick={handleNovoProduct}
                className="h-8 px-3 rounded-lg bg-primary/10 text-primary font-bold text-[10px] uppercase tracking-widest flex items-center gap-1.5 hover:bg-primary/20 transition-colors"
                title="Limpar campos para novo produto"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                Novo Produto
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Código</label>
                  <input type="text" placeholder="Ex: PRD-001" value={productCode} onChange={(e) => setProductCode(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Nome</label>
                  <input type="text" placeholder="Ex: Válvula" value={productName} onChange={(e) => setProductName(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Tipo de Cálculo</label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="w-full h-12 px-4 rounded-xl bg-input border border-border text-sm font-medium text-foreground flex items-center justify-between outline-none hover:bg-muted transition-all focus:ring-2 focus:ring-primary">
                        {calcType === "takt" ? "Takt" : calcType === "media" ? "Soma" : "Média"}
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] bg-card border border-border p-2 rounded-2xl shadow-xl z-[150]">
                      {["takt", "media", "soma"].map((c) => (
                        <DropdownMenuItem key={c} onClick={() => setCalcType(c as CalcType)}
                          className={`w-full text-left text-sm font-bold py-2.5 px-3 rounded-xl cursor-pointer transition-all ${calcType === c ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}>
                          {c === "takt" ? "Takt" : c === "media" ? "Média" : "Soma"}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Tempo de Ciclo</label>
                  <input type="text" readOnly value={`${totalCycleTime.toFixed(2)} ${timeUnit === "minutes" ? "min" : "seg"}`}
                    className="w-full h-12 px-4 rounded-xl border border-border bg-muted/50 text-muted-foreground text-sm outline-none cursor-not-allowed font-semibold" />
                </div>
              </div>
              {operations.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl flex items-center gap-3 mt-4">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <p className="text-sm font-semibold text-primary">
                    Tempo de Ciclo Total: {totalCycleTime.toFixed(2)} {timeUnit === "minutes" ? "min" : "seg"}
                  </p>
                </div>
              )}
            </div>
          </div>

          {savedProducts.length > 0 && (
            <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
              <button onClick={() => setShowProductsPanel(!showProductsPanel)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  <span className="font-bold text-foreground text-sm">Produtos na Nuvem</span>
                  <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">{savedProducts.length}</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showProductsPanel ? "rotate-180" : ""}`} />
              </button>
              {showProductsPanel && (
                <div className="border-t border-border">
                  <div className="px-4 py-3 border-b border-border">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Buscar por código ou nome..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="w-full h-9 pl-9 pr-8 rounded-lg border border-border bg-input text-foreground text-xs outline-none focus:ring-2 focus:ring-primary transition-all"
                      />
                      {productSearch && (
                        <button onClick={() => setProductSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="divide-y divide-border max-h-[380px] overflow-y-auto">
                    {filteredProducts.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-muted-foreground font-bold uppercase tracking-widest">
                        Nenhum produto encontrado
                      </div>
                    ) : (
                      filteredProducts.map((product) => (
                        <div key={product.code}>
                          <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                            <button
                              onClick={() => setExpandedProduct(expandedProduct === product.code ? null : product.code)}
                              className="flex items-center gap-2 min-w-0 flex-1 text-left"
                            >
                              <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${expandedProduct === product.code ? "rotate-90" : ""}`} />
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-xs font-bold text-foreground truncate">{product.description}</span>
                                <span className="text-[10px] text-muted-foreground">{product.code} · {product.steps.length} operações</span>
                              </div>
                            </button>
                            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                              <button
                                onClick={() => handleLoadProduct(product)}
                                title="Carregar para edição"
                                className="h-7 px-2.5 flex items-center gap-1 rounded-lg text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                              >
                                <Pencil className="h-3 w-3" />
                                Editar
                              </button>
                              <button
                                onClick={() => handleDeleteProduct(product.code)}
                                title="Excluir produto"
                                className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {expandedProduct === product.code && (
                            <div className="bg-muted/20 border-t border-border px-4 py-3 space-y-2">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Operações do Roteiro</p>
                              {product.steps.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">Nenhuma operação cadastrada</p>
                              ) : (
                                product.steps.map((step, i) => {
                                  const maq = maquinasGlobais.find(m => m.id === step.maquina_id)
                                  const cicloMin = (step.cycleTime / 60).toFixed(2)
                                  const setupMin = (step.setupTime / 60).toFixed(2)
                                  return (
                                    <div key={i} className="flex items-start gap-2 p-2 bg-card rounded-lg border border-border">
                                      <span className="text-[10px] font-bold text-muted-foreground w-5 flex-shrink-0 pt-0.5">{i + 1}.</span>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-foreground truncate">{step.name}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">
                                          Ciclo: {cicloMin} min · Setup: {setupMin} min
                                          {maq && <span> · {maq.codigo}</span>}
                                        </p>
                                      </div>
                                    </div>
                                  )
                                })
                              )}
                              <button
                                onClick={() => handleLoadProduct(product)}
                                className="w-full mt-2 h-8 flex items-center justify-center gap-1.5 bg-primary text-primary-foreground rounded-lg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all"
                              >
                                <Pencil className="h-3 w-3" /> Carregar para Edição
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-card p-6 rounded-2xl shadow-sm border border-border space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="font-bold text-foreground text-sm tracking-wide uppercase">Nova Operação</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-8 px-3 rounded-lg bg-input border border-border text-[10px] font-bold text-muted-foreground flex items-center gap-1 outline-none hover:bg-muted transition-all">
                    {timeUnit === "minutes" ? "Minutos" : "Segundos"} <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-32 bg-card border border-border p-1.5 rounded-xl shadow-xl z-[150]">
                  {(["minutes", "seconds"] as const).map((u) => (
                    <DropdownMenuItem key={u} onClick={() => setTimeUnit(u)}
                      className={`w-full text-left text-[10px] font-bold py-2 px-2.5 rounded-lg cursor-pointer transition-all ${timeUnit === u ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}>
                      {u === "minutes" ? "Minutos" : "Segundos"}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-3">
              <Select value={newOperationMaquinaId || "none"} onValueChange={(val) => handleMaquinaChange({ target: { value: val === "none" ? "" : val } } as any)}>
                <SelectTrigger className="w-full h-12 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                  <SelectValue placeholder="Sem máquina específica" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem máquina específica</SelectItem>
                  {maquinasGlobais.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.codigo} - {m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input placeholder="Nome da Operação" value={newOperationName} onKeyPress={handleKeyPress}
                onChange={(e) => { setNewOperationName(e.target.value); if (errors.operationName) setErrors((p) => ({ ...p, operationName: undefined })) }}
                className="w-full h-12 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
              <input type="number" step="0.01" min="0" placeholder="Tempo de Ciclo" value={newOperationTime} onKeyPress={handleKeyPress}
                onChange={(e) => { setNewOperationTime(e.target.value); if (errors.operationTime) setErrors((p) => ({ ...p, operationTime: undefined })) }}
                className="w-full h-12 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
              <input type="number" step="0.01" min="0" placeholder="Tempo de Setup" value={newOperationSetup} onKeyPress={handleKeyPress}
                onChange={(e) => { setNewOperationSetup(e.target.value); if (errors.operationSetup) setErrors((p) => ({ ...p, operationSetup: undefined })) }}
                className="w-full h-12 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
              <button onClick={addOperation} disabled={!newOperationName.trim() || !newOperationTime.trim() || isLoading}
                className="w-full h-12 flex items-center justify-center bg-primary text-primary-foreground rounded-xl font-bold text-xs uppercase tracking-widest shadow-md hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2">
                <Plus className="h-4 w-4 mr-2" /> Adicionar
              </button>
            </div>
          </div>

          {/* Importar / Exportar / Baixar Modelo — ocultos a pedido, código mantido pra reativar depois */}
          <div className="hidden">
          <div className="flex gap-3">
            <button onClick={handleImportExcel} disabled={isLoading} className="flex-1 h-12 flex items-center justify-center bg-card border border-border text-muted-foreground font-bold text-xs rounded-xl hover:bg-muted transition-colors shadow-sm">
              <Upload className="h-4 w-4 mr-2" /> Importar
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button disabled={isLoading} className="flex-1 h-12 flex items-center justify-center bg-card border border-border text-muted-foreground font-bold text-xs rounded-xl hover:bg-muted transition-colors shadow-sm">
                  <Download className="h-4 w-4 mr-2" /> Exportar
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-card rounded-2xl shadow-xl border border-border p-2">
                <DropdownMenuItem onClick={handleExportChartPDF} disabled={operations.length === 0} className="cursor-pointer text-sm font-medium py-2 px-3 rounded-lg hover:bg-muted text-foreground">
                  <FileImage className="h-4 w-4 mr-2 text-destructive" /> Exportar Gráfico (PDF)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportExcel} disabled={operations.length === 0} className="cursor-pointer text-sm font-medium py-2 px-3 rounded-lg hover:bg-muted text-foreground">
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" /> Exportar Dados (Excel)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <button onClick={downloadTemplate} disabled={isLoading} className="w-full h-12 flex items-center justify-center bg-card border border-border text-muted-foreground font-bold text-xs rounded-xl hover:bg-muted transition-colors shadow-sm">
            <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" /> Baixar Modelo Padrão (Excel)
          </button>
          </div>


          <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
            <DraggableOperationsList operations={operations} timeUnit={timeUnit} onReorder={reorderOperations} onRemove={removeOperation} onEdit={editOperation} />
          </div>
        </div>

        <div className="xl:w-[65%] flex flex-col gap-6 print:w-full order-1 xl:order-2">
          {operations.length > 0 ? (
            <React.Fragment>
              <div className="print:hidden">
                <CalculationsDashboard operations={operations} timeUnit={timeUnit} taktTime={calcType === "takt" && operations.length > 0 ? (timeUnit === "minutes" ? totalCycleTime * 60 : totalCycleTime) : undefined} taktTimeUnit="seconds" demandUnit="un" />
              </div>
              <div id="gbo-chart-container" className="bg-card rounded-3xl shadow-sm border border-border p-6 print:border-none print:shadow-none print:p-0">
                <GBOChart operations={operations} timeUnit={timeUnit} taktTime={calcType === "takt" && operations.length > 0 ? (timeUnit === "minutes" ? totalCycleTime * 60 : totalCycleTime) : undefined} taktTimeUnit="seconds" demandUnit="un" />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-start gap-3 mt-2 print:hidden">
                {/* BOM */}
                <div className="flex-1 min-w-0 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => setShowBom(!showBom)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-primary" />
                      <span className="font-bold text-foreground text-sm">Lista de Materiais (BOM)</span>
                      <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">{bomItems.length} item{bomItems.length !== 1 ? "s" : ""}</span>
                      {bomItems.length === 0 && <span className="text-[10px] text-amber-500 font-bold">— necessário para controle de estoque</span>}
                    </div>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showBom ? "rotate-180" : ""}`} />
                  </button>

                  {showBom && (
                    <div className="border-t border-border">
                      {bomItems.length > 0 && (
                        <div className="divide-y divide-border">
                          {bomItems.map((b, i) => (
                            <div key={i} className="flex items-center justify-between px-6 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-foreground">{b.insumo_codigo} — {b.insumo_descricao}</p>
                                  <p className="text-[10px] text-muted-foreground">{b.quantidade} {b.unidade_medida} por peça produzida</p>
                                </div>
                              </div>
                              <button
                                onClick={() => setBomItems(prev => prev.filter((_, idx) => idx !== i))}
                                className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0 ml-3"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="px-5 py-4 bg-muted/20 space-y-3">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Adicionar Insumo à BOM</p>
                        <div className="flex gap-2">
                          <Select value={novoBomInsumoId} onValueChange={setNovoBomInsumoId}>
                            <SelectTrigger className="w-full h-10 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                              <SelectValue placeholder="Selecione o insumo" />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border">
                              {insumos.filter(i => !bomItems.find(b => b.insumo_id === i.id)).map(i => (
                                <SelectItem key={i.id} value={i.id}>{i.codigo} — {i.descricao}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <input
                            type="number" min="0.001" step="0.001"
                            placeholder="Qtd/peça"
                            value={novoBomQtd}
                            onChange={e => setNovoBomQtd(e.target.value)}
                            className="w-28 h-10 px-3 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
                          />
                          <button
                            onClick={() => {
                              const ins = insumos.find(i => i.id === novoBomInsumoId)
                              if (!ins || !novoBomQtd || parseFloat(novoBomQtd) <= 0) return
                              setBomItems(prev => [...prev, {
                                insumo_id: ins.id,
                                insumo_codigo: ins.codigo,
                                insumo_descricao: ins.descricao,
                                unidade_medida: ins.unidade_medida,
                                quantidade: parseFloat(novoBomQtd),
                              }])
                              setNovoBomInsumoId("")
                              setNovoBomQtd("")
                            }}
                            disabled={!novoBomInsumoId || !novoBomQtd || parseFloat(novoBomQtd) <= 0}
                            className="h-10 px-4 flex items-center gap-1 bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add
                          </button>
                        </div>
                        {insumos.length === 0 && (
                          <p className="text-[10px] text-amber-500">Cadastre itens na aba Estoque primeiro para montar a BOM.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <Button onClick={handleSaveProduct} disabled={isLoading} className="bg-primary hover:opacity-90 text-primary-foreground font-bold uppercase tracking-widest h-12 px-8 rounded-xl shadow-md transition-all shrink-0 whitespace-nowrap">
                  <Save className="h-5 w-5 mr-2" /> {isLoading ? "Sincronizando..." : "Salvar e Sincronizar Nuvem"}
                </Button>
              </div>
            </React.Fragment>
          ) : (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-card border border-border rounded-2xl shadow-sm print:hidden">
              <div className="p-4 rounded-full bg-input mb-4">
                <Plus className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Nenhuma operação adicionada</h3>
              <p className="text-sm text-muted-foreground mt-2">Preencha o formulário ao lado para gerar o gráfico</p>
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  )
}
