import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

const migration = read("../supabase/migrations/20260804114526_integridade_fluxo_exata.sql")
const gbo = read("../components/gbo-tab.tsx")
const pcp = read("../components/pcp-tab.tsx")
const maquinas = read("../components/maquinas-tab.tsx")
const apontamento = read("../components/apontamento-tab.tsx")
const dashboard = read("../components/dashboard-tab.tsx")
const relatorios = read("../components/relatorios-tab.tsx")

describe("Integridade ponta a ponta do fluxo de produção", () => {
  it("congela o roteiro por OP e consolida pelo snapshot obrigatório", () => {
    assert.match(migration, /create table if not exists public\.ordem_producao_operacoes/i)
    assert.match(migration, /create table if not exists public\.ordem_producao_bom_itens/i)
    assert.match(migration, /origem_snapshot text not null/i)
    assert.match(migration, /from public\.ordem_producao_operacoes s[\s\S]*and s\.obrigatoria/i)
    assert.match(migration, /coalesce\(min\(least\(processadas, v_ordem\.quantidade\)\), 0\)/i)
    assert.match(migration, /from public\.ordem_producao_bom_itens b/i)
  })

  it("bloqueia novos órfãos sem apagar o legado diagnosticado", () => {
    assert.match(migration, /apontamentos_ordem_empresa_fkey[\s\S]*on delete restrict not valid/i)
    assert.match(migration, /apontamentos_operacao_empresa_fkey[\s\S]*on delete restrict not valid/i)
    assert.match(migration, /apontamentos_maquina_empresa_fkey[\s\S]*on delete restrict not valid/i)
    assert.doesNotMatch(migration, /delete from public\.apontamentos/i)
  })

  it("torna o início idempotente e registra a origem operador", () => {
    assert.match(apontamento, /const commandId = crypto\.randomUUID\(\)/)
    assert.match(apontamento, /p_command_id: commandId/)
    assert.match(migration, /apontamentos_command_id_uidx/)
    assert.match(migration, /apontamentos_contexto_ativo_uidx/)
    assert.match(migration, /pg_advisory_xact_lock/)
    assert.match(migration, /'production_report_started'[\s\S]*'production'[\s\S]*'operator'/)
  })

  it("versiona o GBO em uma única RPC e não recria UUIDs por delete", () => {
    assert.match(gbo, /rpc\("salvar_roteiro_produto"/)
    assert.doesNotMatch(gbo, /from\("operacoes"\)\.delete\(\)/)
    assert.match(migration, /set ativo = false[\s\S]*insert into public\.operacoes/i)
    assert.match(migration, /route_version_created/)
  })

  it("substitui exclusões destrutivas por exclusão segura, cancelamento ou inativação", () => {
    assert.match(pcp, /rpc\("excluir_ordem_producao_segura"/)
    assert.doesNotMatch(pcp, /from\("ordens_producao"\)\.delete\(\)/)
    assert.match(maquinas, /update\(\{ status: "inativa" \}\)/)
    assert.match(gbo, /update\(\{ ativo: false \}\)/)
  })

  it("exclui apontamentos órfãos dos consumidores operacionais", () => {
    assert.match(dashboard, /possuiCadeiaValida/)
    assert.match(dashboard, /setApontamentosAtivos[\s\S]*filter\(possuiCadeiaValida\)/)
    assert.match(relatorios, /ordensValidas\.has\(item\.ordem_id\)/)
    assert.match(relatorios, /operacoesValidas\.has\(item\.operacao_id\)/)
    assert.match(relatorios, /maquinasValidas\.has\(item\.maquina_id\)/)
  })

  it("calcula OEE consolidado pelos totais e não por média simples", () => {
    assert.match(relatorios, /aggregateOeeInputs/)
    assert.doesNotMatch(relatorios, /reduce\(\(s, d\) => s \+ d\.oee, 0\) \/ dadosOEECalculaveis\.length/)
  })
})
