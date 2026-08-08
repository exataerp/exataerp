"use client"

import React, { useState, useEffect, useCallback } from "react"
import { ShieldAlert, Users, Plus, Building2, AtSign, UserRound, LockKeyhole, Power, RefreshCw, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { suggestTenantSlug } from "@/lib/tenant-host"

export function MasterTab() {
  const { toast } = useToast()

  const [isAdding, setIsAdding] = useState(false)
  const [clientes, setClientes] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [acessoNegado, setAcessoNegado] = useState(false)

  const [novaEmpresa, setNovaEmpresa] = useState("")
  const [novoSubdominio, setNovoSubdominio] = useState("")
  const [novoNome, setNovoNome] = useState("")
  const [novoUsername, setNovoUsername] = useState("")
  const [novaSenha, setNovaSenha] = useState("")
  const [novoEmail, setNovoEmail] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  const carregarClientes = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/fabricas', { cache: 'no-store' })
      const json = await res.json()

      if (res.status === 403) {
        setAcessoNegado(true)
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar empresas.')

      setClientes(json.empresas ?? [])
    } catch (error: any) {
      toast({ title: "Erro de conexão", description: error.message ?? "Não foi possível carregar as empresas.", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    carregarClientes()
  }, [carregarClientes])

  const toggleStatus = async (id: string, currentStatus: string) => {
    const novoStatus = currentStatus === "inativo" ? "ativo" : "inativo"
    try {
      const res = await fetch('/api/admin/fabricas', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ id, status: novoStatus }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro ao alterar status.')

      toast({ title: "Comando executado", description: `O acesso da empresa foi alterado para ${novoStatus.toUpperCase()}.` })
      carregarClientes()
    } catch (error: any) {
      toast({ title: "Falha na execução", description: error.message, variant: "destructive" })
    }
  }

  const handleCriarAcesso = async () => {
    if (!novaEmpresa.trim() || !novoSubdominio.trim() || !novoNome.trim() || !novoUsername.trim() || !novaSenha) {
      toast({ title: "Dados incompletos", description: "Preencha empresa, subdomínio, administrador, nome de usuário e senha.", variant: "destructive" })
      return
    }

    setIsCreating(true)
    try {
      const response = await fetch('/api/admin/nova-fabrica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          nomeFabrica: novaEmpresa.trim(),
          subdomain: novoSubdominio.trim(),
          nome: novoNome.trim(),
          username: novoUsername.trim(),
          password: novaSenha,
          email: novoEmail.trim() || null,
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Erro desconhecido ao criar acesso.")

      toast({ title: "Cadastro criado", description: `Empresa e administrador criados. O acesso já está disponível em ${result.subdomain}.exataerp.com.` })
      setNovaEmpresa("")
      setNovoSubdominio("")
      setNovoNome("")
      setNovoUsername("")
      setNovaSenha("")
      setNovoEmail("")
      setIsAdding(false)
      carregarClientes()
    } catch (error: any) {
      toast({ title: "Falha ao credenciar", description: error.message, variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }

  if (acessoNegado) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive mb-3" />
        <p className="text-sm font-bold text-foreground">Acesso restrito</p>
        <p className="text-xs text-muted-foreground mt-1">Esta área é exclusiva para Super Admin.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-foreground uppercase tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
            Cadastro de Empresas
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Área exclusiva do superadmin para cadastrar clientes e controlar seus acessos.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={carregarClientes} className="h-10 w-10 flex items-center justify-center bg-muted text-foreground rounded-xl shadow-sm hover:opacity-90 transition-all" title="Atualizar lista">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="h-10 px-4 bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest rounded-xl flex items-center gap-2 shadow-md hover:opacity-90 transition-all"
          >
            {isAdding ? "Cancelar" : <><Plus className="h-4 w-4" /> Novo Cliente</>}
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <h3 className="text-sm font-bold uppercase tracking-widest mb-4">Cadastrar Nova Empresa</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Nome da Empresa</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={novaEmpresa}
                  onChange={(e) => {
                    setNovaEmpresa(e.target.value)
                    setNovoSubdominio(suggestTenantSlug(e.target.value))
                  }}
                  placeholder="Indústria Exemplo Ltda"
                  className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Subdomínio do Cliente</label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={novoSubdominio}
                  onChange={(e) => setNovoSubdominio(e.target.value.toLowerCase())}
                  placeholder="industria"
                  autoComplete="off"
                  className="w-full h-10 pl-10 pr-36 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">.exataerp.com</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Será o endereço exclusivo da empresa e não poderá se repetir.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Nome do Administrador</label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Nome completo"
                  className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Nome de Usuário</label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={novoUsername}
                  onChange={(e) => setNovoUsername(e.target.value)}
                  placeholder="admin.industria"
                  autoComplete="off"
                  className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">3 a 40 caracteres, sem espaços ou acentos.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Senha Temporária</label>
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Mínimo de 8 caracteres"
                  autoComplete="new-password"
                  className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
                />
              </div>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">E-mail de Contato (opcional)</label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="email"
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  placeholder="contato@industria.com"
                  autoComplete="off"
                  className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Não é usado no login e pode ser compartilhado por vários usuários.</p>
            </div>
          </div>
          <button
            onClick={handleCriarAcesso}
            disabled={isCreating}
            className="mt-4 h-10 w-full flex items-center justify-center bg-foreground text-background font-bold text-xs uppercase tracking-widest rounded-xl shadow-md hover:opacity-90 transition-all disabled:opacity-50"
          >
            {isCreating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Criando Acesso...</> : "Criar Empresa e Administrador"}
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-bold text-foreground">Empresas Cadastradas</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-muted px-2 py-1 rounded-md">
            {clientes.length} {clientes.length === 1 ? 'Registro' : 'Registros'}
          </span>
        </div>

        <div className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                <tr>
                  <th className="px-6 py-3">Empresa</th>
                  <th className="px-6 py-3">Endereço</th>
                  <th className="px-6 py-3">ID de Registro</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Controle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-xs text-muted-foreground font-bold uppercase tracking-widest">
                      Buscando banco de dados...
                    </td>
                  </tr>
                ) : clientes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-xs text-muted-foreground font-bold uppercase tracking-widest">
                      Nenhuma empresa encontrada
                    </td>
                  </tr>
                ) : (
                  clientes.map((cliente) => (
                    <tr key={cliente.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-6 py-4 font-bold text-foreground">{cliente.nome || "Sem nome definido"}</td>
                      <td className="px-6 py-4">
                        {cliente.subdomain ? (
                          <a
                            href={`https://${cliente.subdomain}.exataerp.com`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            {cliente.subdomain}.exataerp.com
                          </a>
                        ) : <span className="text-xs text-muted-foreground">Não configurado</span>}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-[11px] font-mono">{cliente.id}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${cliente.status === 'inativo' ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-500'}`}>
                          {cliente.status || "Ativo"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => toggleStatus(cliente.id, cliente.status)}
                          className={`p-2 rounded-lg transition-colors ${cliente.status === 'inativo' ? 'text-green-500 hover:bg-green-500/10' : 'text-destructive hover:bg-destructive/10'}`}
                          title={cliente.status === 'inativo' ? 'Reativar Acesso' : 'Suspender Acesso'}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
