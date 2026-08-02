import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const EMPRESA_ALVO = 'FORZA IMPLEMENTOS'
const TOTAL_ESPERADO = 235
const PAPEL_PRODUCAO = 'production_user'
const CONFIRMACAO = 'CRIAR_235_ACESSOS_PRODUCAO'
const PROVISIONING_TOKEN_SHA256 = 'ebdc8aef2f03080323fae631554e3f60b146f45eb8386693ab2257b23df3b870'
const CONCORRENCIA_AUTH = 8

type Funcionario = {
  id: string
  matricula: string
  nome: string
  email: string | null
  cargo: string
  setor_id: string
  acesso_sistema: boolean
  setores: { codigo: string; nome: string; produtivo: boolean } | null
  turnos: { nome: string } | null
}

type ContaPreparada = {
  funcionario: Funcionario
  usuario: string
  senha: string
  postos: { id: string; codigo: string; nome: string }[]
}

type ContaCriada = ContaPreparada & { userId: string }

function resposta(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store, private, max-age=0',
      Pragma: 'no-cache',
    },
  })
}

function tokenValido(request: Request) {
  const recebido = request.headers.get('x-provisioning-key') ?? ''
  const esperado = Buffer.from(PROVISIONING_TOKEN_SHA256, 'hex')
  const calculado = createHash('sha256').update(recebido).digest()
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
}

function embaralhar(caracteres: string[]) {
  for (let indice = caracteres.length - 1; indice > 0; indice -= 1) {
    const troca = randomInt(indice + 1)
    ;[caracteres[indice], caracteres[troca]] = [caracteres[troca], caracteres[indice]]
  }
  return caracteres.join('')
}

function gerarSenhaInicial() {
  const maiusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const minusculas = 'abcdefghijkmnopqrstuvwxyz'
  const numeros = '23456789'
  const especiais = '!@#$%'
  const todos = maiusculas + minusculas + numeros + especiais

  const senha = [
    maiusculas[randomInt(maiusculas.length)],
    minusculas[randomInt(minusculas.length)],
    numeros[randomInt(numeros.length)],
    especiais[randomInt(especiais.length)],
  ]

  while (senha.length < 16) senha.push(todos[randomInt(todos.length)])
  return embaralhar(senha)
}

function emLotes<T>(itens: T[], tamanho: number) {
  const lotes: T[][] = []
  for (let inicio = 0; inicio < itens.length; inicio += tamanho) {
    lotes.push(itens.slice(inicio, inicio + tamanho))
  }
  return lotes
}

async function executarComConcorrencia<T, R>(
  itens: T[],
  concorrencia: number,
  tarefa: (item: T) => Promise<R>
) {
  const resultados: R[] = []
  for (const lote of emLotes(itens, concorrencia)) {
    resultados.push(...await Promise.all(lote.map(tarefa)))
  }
  return resultados
}

async function removerContasAuth(userIds: string[]) {
  await executarComConcorrencia(userIds, CONCORRENCIA_AUTH, async userId => {
    await supabaseAdmin.auth.admin.deleteUser(userId)
  })
}

async function desfazerProvisionamento(contas: ContaCriada[]) {
  const userIds = contas.map(conta => conta.userId)
  if (userIds.length === 0) return

  for (const lote of emLotes(userIds, 100)) {
    await supabaseAdmin.from('usuario_postos_trabalho').delete().in('user_id', lote)
    await supabaseAdmin.from('user_roles').delete().in('user_id', lote)
    await supabaseAdmin.from('controle_acesso').delete().in('user_id', lote)
    await supabaseAdmin.from('perfis').delete().in('user_id', lote)
  }

  await executarComConcorrencia(contas, 12, async conta => {
    await supabaseAdmin
      .from('funcionarios')
      .update({
        user_id: null,
        acesso_sistema: conta.funcionario.acesso_sistema,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conta.funcionario.id)
  })

  await removerContasAuth(userIds)
}

export async function POST(request: Request) {
  if (!tokenValido(request)) {
    return resposta({ error: 'Não autorizado.' }, 401)
  }

  let contasCriadas: ContaCriada[] = []

  try {
    const body = await request.json()
    if (body?.confirmacao !== CONFIRMACAO) {
      return resposta({ error: 'Confirmação de provisionamento inválida.' }, 400)
    }

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from('empresas')
      .select('id, admin_id, nome')
      .eq('nome', EMPRESA_ALVO)
      .single()

    if (empresaError || !empresa?.id || !empresa.admin_id) {
      throw new Error('Empresa FORZA ou administrador responsável não encontrado.')
    }

    const { data: papel, error: papelError } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', PAPEL_PRODUCAO)
      .single()

    if (papelError || !papel?.id) {
      throw new Error('Perfil de acesso de produção não encontrado.')
    }

    const { data: funcionariosData, error: funcionariosError } = await supabaseAdmin
      .from('funcionarios')
      .select('id, matricula, nome, email, cargo, setor_id, acesso_sistema, user_id, setores!inner(codigo, nome, produtivo), turnos(nome)')
      .eq('empresa_id', empresa.id)
      .eq('status', 'ativo')
      .eq('setores.produtivo', true)
      .order('matricula')

    if (funcionariosError) throw funcionariosError

    const funcionarios = (funcionariosData ?? []) as unknown as (Funcionario & { user_id: string | null })[]
    if (funcionarios.length !== TOTAL_ESPERADO) {
      throw new Error(`A operação exige ${TOTAL_ESPERADO} funcionários produtivos ativos; foram encontrados ${funcionarios.length}.`)
    }

    const vinculados = funcionarios.filter(funcionario => funcionario.user_id)
    if (vinculados.length > 0) {
      return resposta({
        error: 'O provisionamento já foi executado ou está parcialmente concluído.',
        funcionarios_vinculados: vinculados.length,
      }, 409)
    }

    const semEmail = funcionarios.filter(funcionario => !funcionario.email?.trim())
    if (semEmail.length > 0) {
      throw new Error(`${semEmail.length} funcionários produtivos não possuem e-mail cadastrado.`)
    }

    const emails = funcionarios.map(funcionario => funcionario.email!.trim().toLowerCase())
    if (new Set(emails).size !== emails.length) {
      throw new Error('Existem e-mails duplicados entre os funcionários produtivos.')
    }

    const { data: perfisExistentes, error: perfisError } = await supabaseAdmin
      .from('perfis')
      .select('email')
      .eq('empresa_id', empresa.id)
      .in('email', emails)

    if (perfisError) throw perfisError
    if ((perfisExistentes ?? []).length > 0) {
      return resposta({
        error: 'Já existem perfis com e-mails dos funcionários produtivos.',
        perfis_existentes: perfisExistentes?.length ?? 0,
      }, 409)
    }

    const { data: maquinas, error: maquinasError } = await supabaseAdmin
      .from('maquinas')
      .select('id, codigo, nome, setor_id')
      .eq('empresa_id', empresa.id)
      .eq('status', 'ativa')
      .order('codigo')

    if (maquinasError) throw maquinasError

    const postosPorSetor = new Map<string, { id: string; codigo: string; nome: string }[]>()
    for (const maquina of maquinas ?? []) {
      if (!maquina.setor_id) continue
      const postos = postosPorSetor.get(maquina.setor_id) ?? []
      postos.push({ id: maquina.id, codigo: maquina.codigo, nome: maquina.nome })
      postosPorSetor.set(maquina.setor_id, postos)
    }

    const contasPreparadas: ContaPreparada[] = funcionarios.map(funcionario => ({
      funcionario,
      usuario: funcionario.email!.trim().toLowerCase(),
      senha: gerarSenhaInicial(),
      postos: postosPorSetor.get(funcionario.setor_id) ?? [],
    }))

    const semPosto = contasPreparadas.filter(conta => conta.postos.length === 0)
    if (semPosto.length > 0) {
      const setores = [...new Set(semPosto.map(conta => conta.funcionario.setores?.nome ?? conta.funcionario.setor_id))]
      throw new Error(`Há funcionários produtivos sem posto ativo nos setores: ${setores.join(', ')}.`)
    }

    const resultadosAuth = await executarComConcorrencia(
      contasPreparadas,
      CONCORRENCIA_AUTH,
      async conta => {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: conta.usuario,
          password: conta.senha,
          email_confirm: true,
          user_metadata: {
            nome: conta.funcionario.nome,
            matricula: conta.funcionario.matricula,
            first_access_completed: false,
          },
        })

        if (error || !data.user) {
          return { conta, error: error?.message ?? 'Conta não criada no Supabase Auth.' }
        }

        const criada: ContaCriada = { ...conta, userId: data.user.id }
        contasCriadas.push(criada)
        return { conta: criada, error: null }
      }
    )

    const falhasAuth = resultadosAuth.filter(resultado => resultado.error)
    if (falhasAuth.length > 0) {
      await removerContasAuth(contasCriadas.map(conta => conta.userId))
      contasCriadas = []
      throw new Error(`Falha ao criar ${falhasAuth.length} contas no Supabase Auth. Nenhuma conta foi mantida. Primeiro erro: ${falhasAuth[0].error}`)
    }

    const agora = new Date().toISOString()
    const perfis = contasCriadas.map(conta => ({
      id: conta.userId,
      user_id: conta.userId,
      empresa_id: empresa.id,
      email: conta.usuario,
      nome: conta.funcionario.nome,
      cargo: conta.funcionario.cargo,
      tipo_usuario: 'colaborador',
      status: 'ativo',
      first_access_completed: false,
      updated_at: agora,
    }))

    const { error: inserirPerfisError } = await supabaseAdmin.from('perfis').insert(perfis)
    if (inserirPerfisError) throw inserirPerfisError

    const controles = contasCriadas.map(conta => ({
      user_id: conta.userId,
      empresa_id: empresa.id,
      nivel: 'operador',
      status: 'ativo',
      activated_at: agora,
    }))
    const { error: controlesError } = await supabaseAdmin.from('controle_acesso').insert(controles)
    if (controlesError) throw controlesError

    const papeis = contasCriadas.map(conta => ({
      user_id: conta.userId,
      empresa_id: empresa.id,
      role_id: papel.id,
      granted_by: empresa.admin_id,
    }))
    const { error: papeisError } = await supabaseAdmin.from('user_roles').insert(papeis)
    if (papeisError) throw papeisError

    const atualizacoes = await executarComConcorrencia(contasCriadas, 12, async conta => {
      const { error } = await supabaseAdmin
        .from('funcionarios')
        .update({ user_id: conta.userId, acesso_sistema: true, updated_at: agora })
        .eq('id', conta.funcionario.id)
        .eq('empresa_id', empresa.id)
      return error?.message ?? null
    })
    const falhasAtualizacao = atualizacoes.filter(Boolean)
    if (falhasAtualizacao.length > 0) {
      throw new Error(`Falha ao vincular ${falhasAtualizacao.length} funcionários. Primeiro erro: ${falhasAtualizacao[0]}`)
    }

    const vinculosPostos = contasCriadas.flatMap(conta => conta.postos.map(posto => ({
      empresa_id: empresa.id,
      user_id: conta.userId,
      maquina_id: posto.id,
      created_by: empresa.admin_id,
    })))

    for (const lote of emLotes(vinculosPostos, 500)) {
      const { error } = await supabaseAdmin.from('usuario_postos_trabalho').insert(lote)
      if (error) throw error
    }

    const userIds = contasCriadas.map(conta => conta.userId)
    const verificacoes = await Promise.all([
      supabaseAdmin.from('perfis').select('*', { count: 'exact', head: true }).eq('empresa_id', empresa.id).in('user_id', userIds),
      supabaseAdmin.from('controle_acesso').select('*', { count: 'exact', head: true }).eq('empresa_id', empresa.id).in('user_id', userIds),
      supabaseAdmin.from('user_roles').select('*', { count: 'exact', head: true }).eq('empresa_id', empresa.id).eq('role_id', papel.id).in('user_id', userIds),
      supabaseAdmin.from('funcionarios').select('*', { count: 'exact', head: true }).eq('empresa_id', empresa.id).in('user_id', userIds),
      supabaseAdmin.from('usuario_postos_trabalho').select('*', { count: 'exact', head: true }).eq('empresa_id', empresa.id).in('user_id', userIds),
    ])

    const errosVerificacao = verificacoes.map(item => item.error?.message).filter(Boolean)
    const contagens = verificacoes.map(item => item.count ?? 0)
    if (errosVerificacao.length > 0 || contagens.slice(0, 4).some(total => total !== TOTAL_ESPERADO) || contagens[4] !== vinculosPostos.length) {
      throw new Error(`A verificação final não confirmou todos os vínculos. Contagens: ${contagens.join(', ')}. ${errosVerificacao.join(' ')}`)
    }

    const credenciais = contasCriadas
      .sort((a, b) => a.funcionario.matricula.localeCompare(b.funcionario.matricula))
      .map(conta => ({
        matricula: conta.funcionario.matricula,
        nome: conta.funcionario.nome,
        cargo: conta.funcionario.cargo,
        setor: conta.funcionario.setores?.nome ?? '',
        turno: conta.funcionario.turnos?.nome ?? '',
        usuario: conta.usuario,
        senha_inicial: conta.senha,
        postos: conta.postos.map(posto => posto.codigo),
      }))

    return resposta({
      success: true,
      empresa: EMPRESA_ALVO,
      total: credenciais.length,
      total_vinculos_postos: vinculosPostos.length,
      credenciais,
    })
  } catch (error: unknown) {
    if (contasCriadas.length > 0) {
      try {
        await desfazerProvisionamento(contasCriadas)
        contasCriadas = []
      } catch (rollbackError) {
        const mensagemRollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        const mensagemOriginal = error instanceof Error ? error.message : String(error)
        return resposta({
          error: mensagemOriginal,
          rollback_error: mensagemRollback,
          alerta: 'O rollback não foi confirmado; revise os usuários antes de repetir.',
        }, 500)
      }
    }

    const mensagem = error instanceof Error ? error.message : 'Erro interno no provisionamento.'
    return resposta({ error: mensagem }, 500)
  }
}
