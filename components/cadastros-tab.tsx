"use client"

import { useMemo, useState } from "react"
import {
  Boxes,
  Building2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Factory,
  PackageSearch,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
} from "lucide-react"
import type { AbaId } from "@/lib/permissions"
import { CADASTROS_GRUPOS, totalCadastros, type CadastroStatus } from "@/lib/cadastros-catalog"

const ICONES_GRUPO = {
  "produtos-materiais": Boxes,
  "producao-engenharia": Factory,
  "pessoas-estrutura": Users,
  "clientes-comercial": Building2,
  "fornecedores-compras": Truck,
  "estoque-logistica": PackageSearch,
  "financeiro-fiscal": CircleDollarSign,
  qualidade: ClipboardCheck,
  "patrimonio-manutencao": Wrench,
  "empresa-sistema": Settings,
} as const

const STATUS: Record<CadastroStatus, { label: string; classe: string }> = {
  disponivel: { label: "Disponível", classe: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  base_existente: { label: "Base existente", classe: "bg-primary/10 text-primary" },
  planejado: { label: "Planejado", classe: "bg-muted text-muted-foreground" },
}

interface CadastrosTabProps {
  onNavigate: (tab: AbaId) => void
  canAccess: (tab: AbaId) => boolean
}

export function CadastrosTab({ onNavigate, canAccess }: CadastrosTabProps) {
  const [busca, setBusca] = useState("")
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(["produtos-materiais"]))
  const termo = busca.trim().toLocaleLowerCase("pt-BR")

  const grupos = useMemo(() => {
    if (!termo) return CADASTROS_GRUPOS

    return CADASTROS_GRUPOS.flatMap((grupo) => {
      const grupoCombina = `${grupo.nome} ${grupo.descricao}`.toLocaleLowerCase("pt-BR").includes(termo)
      const itens = grupoCombina
        ? grupo.itens
        : grupo.itens.filter((item) => `${item.nome} ${item.descricao}`.toLocaleLowerCase("pt-BR").includes(termo))

      return itens.length > 0 ? [{ ...grupo, itens }] : []
    })
  }, [termo])

  const alternarGrupo = (id: string) => {
    setAbertos((atuais) => {
      const proximos = new Set(atuais)
      if (proximos.has(id)) proximos.delete(id)
      else proximos.add(id)
      return proximos
    })
  }

  return (
    <section className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Dados mestres</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-foreground">Cadastros</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Informações compartilhadas por produção, estoque, compras, vendas, financeiro e demais módulos do Exata.
          </p>
        </div>

        <label className="relative block w-full xl:w-80">
          <span className="sr-only">Buscar cadastro</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar cadastro..."
            className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Resumo label="Grupos organizados" valor={CADASTROS_GRUPOS.length} />
        <Resumo label="Acessos disponíveis" valor={totalCadastros("disponivel")} />
        <Resumo label="Bases já existentes" valor={totalCadastros("base_existente")} />
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-sm text-foreground">
        <strong>Arquitetura evolutiva:</strong>{" "}
        os itens marcados como base existente já possuem estrutura no Exata, mas ainda receberão uma tela centralizada. Itens planejados não criam dados ou tabelas duplicadas.
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <Search className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-bold text-foreground">Nenhum cadastro encontrado</p>
          <p className="mt-1 text-xs text-muted-foreground">Tente buscar por outro nome ou área do ERP.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map((grupo) => {
            const Icone = ICONES_GRUPO[grupo.id as keyof typeof ICONES_GRUPO] ?? Boxes
            const aberto = termo.length > 0 || abertos.has(grupo.id)

            return (
              <article key={grupo.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => alternarGrupo(grupo.id)}
                  aria-expanded={aberto}
                  aria-controls={`cadastros-${grupo.id}`}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icone className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-foreground">{grupo.nome}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{grupo.descricao}</span>
                  </span>
                  <span className="hidden text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:block">
                    {grupo.itens.length} itens
                  </span>
                  <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
                </button>

                {aberto ? (
                  <div id={`cadastros-${grupo.id}`} className="grid grid-cols-1 gap-px border-t border-border bg-border md:grid-cols-2 xl:grid-cols-3">
                    {grupo.itens.map((item) => {
                      const acessivel = item.destino ? canAccess(item.destino) : false
                      const interativo = Boolean(item.destino && acessivel)
                      const status = STATUS[item.status]

                      return (
                        <button
                          key={item.nome}
                          type="button"
                          disabled={!interativo}
                          onClick={() => item.destino && onNavigate(item.destino)}
                          className={`min-h-32 bg-card p-5 text-left transition-colors ${interativo ? "cursor-pointer hover:bg-muted/50" : "cursor-default"}`}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="text-sm font-bold text-foreground">{item.nome}</span>
                            <span className={`flex-shrink-0 rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-wider ${status.classe}`}>
                              {item.destino && !acessivel ? "Sem acesso" : status.label}
                            </span>
                          </span>
                          <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{item.descricao}</span>
                          {interativo ? <span className="mt-3 block text-[10px] font-black uppercase tracking-wider text-primary">Abrir cadastro →</span> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Resumo({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
      <p className="text-2xl font-black text-foreground">{valor}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  )
}
