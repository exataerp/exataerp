import { useAuth, type TipoUsuario } from '@/contexts/AuthContext'

export function usePermissao() {
  const { session, podeAcessar, isAdmin, isGerente } = useAuth()
  const tipoAtual = (session?.user?.tipo_usuario as TipoUsuario) || 'colaborador'

  return {
    // Role atual do usuário
    tipoAtual,

    // Verificações booleanas diretas
    isAdmin,
    isGerente,
    isColaborador:  tipoAtual === 'colaborador',
    isVisualizador: tipoAtual === 'visualizador',

    // Função de checagem hierárquica genérica
    pode: podeAcessar,

    // Conveniências de ações específicas do ExataERP
    podeCriarOrdem:    podeAcessar('colaborador'),
    podeApontar:       podeAcessar('colaborador'),
    podeAprovar:       podeAcessar('gerente'),
    podeVerRelatorios: podeAcessar('gerente'),
    podeExcluir:       podeAcessar('admin'),
    podeGerirUsuarios: podeAcessar('admin'),
    podeConfigurar:    podeAcessar('admin'),
  }
}

