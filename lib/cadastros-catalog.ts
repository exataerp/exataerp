import type { AbaId } from "@/lib/permissions"

export type CadastroStatus = "disponivel" | "base_existente" | "planejado"

export interface CadastroItem {
  nome: string
  descricao: string
  destino?: AbaId
  status: CadastroStatus
}

export interface CadastroGrupo {
  id: string
  nome: string
  descricao: string
  itens: CadastroItem[]
}

export const CADASTROS_GRUPOS: CadastroGrupo[] = [
  {
    id: "produtos-materiais",
    nome: "Produtos e Materiais",
    descricao: "Item mestre único para compra, venda, estoque e produção.",
    itens: [
      { nome: "Produtos / Itens", descricao: "Produtos, materiais, serviços e respectivos roteiros.", destino: "gbo", status: "disponivel" },
      { nome: "Grupos de Produtos", descricao: "Classificação hierárquica e extensível dos itens.", status: "planejado" },
      { nome: "Famílias de Produtos", descricao: "Famílias compartilhadas pelos processos industriais.", status: "base_existente" },
      { nome: "Categorias, Marcas e Fabricantes", descricao: "Classificações comerciais e técnicas reutilizáveis.", status: "planejado" },
      { nome: "Unidades e Conversões", descricao: "Unidades de estoque, compra e venda e seus fatores.", status: "planejado" },
      { nome: "Códigos de Barras", descricao: "Múltiplos GTIN/EAN e códigos internos por item.", status: "planejado" },
      { nome: "Atributos e Variantes", descricao: "Variações de produto sem duplicar a lógica mestre.", status: "planejado" },
    ],
  },
  {
    id: "producao-engenharia",
    nome: "Produção e Engenharia",
    descricao: "Recursos, estruturas e padrões compartilhados pelo chão de fábrica.",
    itens: [
      { nome: "Operações e Roteiros", descricao: "Sequências produtivas, tempos e recursos compatíveis.", destino: "gbo", status: "disponivel" },
      { nome: "Máquinas e Postos", descricao: "Recursos produtivos, capacidade e disponibilidade.", destino: "maquinas", status: "disponivel" },
      { nome: "Estruturas / BOM", descricao: "Componentes e matérias-primas com suporte multinível.", destino: "estoque", status: "base_existente" },
      { nome: "Setores e Centros de Trabalho", descricao: "Estrutura produtiva sem confundir setor, recurso e custo.", status: "base_existente" },
      { nome: "Tipos de Máquina e Recursos", descricao: "Compatibilidade entre operações e recursos produtivos.", status: "planejado" },
      { nome: "Ferramentas, Moldes e Dispositivos", descricao: "Recursos auxiliares de fabricação e setup.", status: "planejado" },
      { nome: "Turnos e Calendários", descricao: "Jornadas, disponibilidade e intervalos programados.", destino: "configuracoes", status: "disponivel" },
      { nome: "Motivos de Parada e Refugo", descricao: "Classificações operacionais e futuras métricas de OEE.", destino: "excecoes", status: "disponivel" },
    ],
  },
  {
    id: "pessoas-estrutura",
    nome: "Pessoas e Estrutura",
    descricao: "Identidade de acesso separada do vínculo organizacional.",
    itens: [
      { nome: "Usuários e Permissões", descricao: "Identidades, papéis e acessos ao sistema.", destino: "equipe", status: "disponivel" },
      { nome: "Colaboradores", descricao: "Pessoas da organização, com ou sem acesso ao ERP.", status: "base_existente" },
      { nome: "Equipes", descricao: "Líderes, membros, postos e vigência das equipes.", destino: "equipe", status: "disponivel" },
      { nome: "Departamentos e Setores", descricao: "Estrutura organizacional hierárquica e sem duplicações.", status: "base_existente" },
      { nome: "Cargos, Funções e Vínculos", descricao: "Papéis organizacionais independentes do login.", status: "planejado" },
      { nome: "Competências e Habilidades", descricao: "Habilitação de pessoas para operações e recursos.", status: "planejado" },
      { nome: "Turnos e Escalas", descricao: "Jornadas de trabalho e escalas organizacionais.", destino: "configuracoes", status: "base_existente" },
    ],
  },
  {
    id: "clientes-comercial",
    nome: "Clientes e Comercial",
    descricao: "Dados mestres comerciais desacoplados dos pedidos e propostas.",
    itens: [
      { nome: "Clientes e Grupos", descricao: "Pessoas físicas, jurídicas, internacionais e intercompany.", status: "planejado" },
      { nome: "Contatos e Endereços", descricao: "Estrutura compartilhável entre organizações e papéis.", status: "planejado" },
      { nome: "Territórios e Segmentos", descricao: "Hierarquias comerciais e segmentação de mercado.", status: "planejado" },
      { nome: "Vendedores, Equipes e Parceiros", descricao: "Responsáveis e canais de relacionamento comercial.", status: "planejado" },
      { nome: "Listas e Preços de Produtos", descricao: "Preço por item, unidade, moeda, quantidade e vigência.", status: "planejado" },
      { nome: "Condições e Formas de Pagamento", descricao: "Regras compartilhadas com financeiro e compras.", status: "planejado" },
      { nome: "Transportadoras e Incoterms", descricao: "Parceiros e termos logísticos reutilizáveis.", status: "planejado" },
    ],
  },
  {
    id: "fornecedores-compras",
    nome: "Fornecedores e Compras",
    descricao: "Origem de materiais e serviços com dados compartilhados.",
    itens: [
      { nome: "Fornecedores e Grupos", descricao: "Fornecedores de materiais, serviços e terceirização.", status: "base_existente" },
      { nome: "Produtos por Fornecedor", descricao: "Código externo, preço, MOQ, lead time e homologação.", status: "base_existente" },
      { nome: "Contatos e Endereços", descricao: "Cadastro comum às relações comerciais.", status: "planejado" },
      { nome: "Condições e Categorias de Compra", descricao: "Parâmetros reutilizados pelos processos de suprimentos.", status: "planejado" },
      { nome: "Compradores", descricao: "Responsáveis internos por categorias e negociações.", status: "planejado" },
      { nome: "Critérios de Avaliação", descricao: "Prazo, qualidade, preço, atendimento e rejeição.", status: "planejado" },
    ],
  },
  {
    id: "estoque-logistica",
    nome: "Estoque e Logística",
    descricao: "Estrutura física e classificações para estoque e futuro WMS.",
    itens: [
      { nome: "Depósitos e Localizações", descricao: "Almoxarifados, áreas e endereçamento de estoque.", destino: "estoque", status: "base_existente" },
      { nome: "Tipos e Motivos de Movimentação", descricao: "Classificação das entradas, saídas e transferências.", destino: "estoque", status: "base_existente" },
      { nome: "Lotes e Séries", descricao: "Registros operacionais de rastreabilidade, não cadastros estáticos.", status: "planejado" },
      { nome: "Transportadoras e Veículos", descricao: "Recursos logísticos compartilhados com o comercial.", status: "planejado" },
      { nome: "Rotas Logísticas", descricao: "Percursos internos e externos de abastecimento e entrega.", status: "planejado" },
      { nome: "Unidades de Embalagem", descricao: "Apresentações e conversões logísticas dos produtos.", status: "planejado" },
    ],
  },
  {
    id: "financeiro-fiscal",
    nome: "Financeiro e Fiscal",
    descricao: "Base brasileira para finanças, contabilidade, custos e fiscal.",
    itens: [
      { nome: "Centros de Custo e Plano de Contas", descricao: "Estruturas hierárquicas contábeis e gerenciais.", status: "planejado" },
      { nome: "Contas Financeiras e Bancárias", descricao: "Bancos, contas e meios de liquidação.", status: "planejado" },
      { nome: "Formas e Condições de Pagamento", descricao: "Regras únicas compartilhadas com comercial e compras.", status: "planejado" },
      { nome: "Moedas e Câmbio", descricao: "Moedas mestres e taxas tratadas como dados temporais.", status: "planejado" },
      { nome: "Naturezas e Categorias Financeiras", descricao: "Classificações para gestão e contabilização.", status: "planejado" },
      { nome: "Cadastros Fiscais Brasileiros", descricao: "NCM, CEST, CFOP, CST, CSOSN e naturezas de operação.", status: "planejado" },
      { nome: "Impostos e Regras Tributárias", descricao: "Configuração fiscal brasileira por vigência e contexto.", status: "planejado" },
    ],
  },
  {
    id: "qualidade",
    nome: "Qualidade",
    descricao: "Padrões de inspeção e tratamento de não conformidades.",
    itens: [
      { nome: "Características de Qualidade", descricao: "Grandezas, requisitos e unidades de inspeção.", status: "planejado" },
      { nome: "Planos e Modelos de Inspeção", descricao: "Critérios por produto, operação e característica.", status: "planejado" },
      { nome: "Instrumentos de Medição", descricao: "Instrumentos, tipos, calibração e disponibilidade.", status: "planejado" },
      { nome: "Defeitos e Não Conformidades", descricao: "Motivos e classificações padronizadas.", destino: "excecoes", status: "base_existente" },
      { nome: "Ações e Checklists", descricao: "Modelos reutilizáveis para prevenção e verificação.", status: "planejado" },
    ],
  },
  {
    id: "patrimonio-manutencao",
    nome: "Patrimônio e Manutenção",
    descricao: "Ativos patrimoniais separados dos recursos produtivos.",
    itens: [
      { nome: "Ativos e Categorias", descricao: "Bens patrimoniais vinculáveis a máquinas e equipamentos.", destino: "manutencao", status: "base_existente" },
      { nome: "Localizações e Tipos de Equipamento", descricao: "Classificação e localização física dos ativos.", status: "planejado" },
      { nome: "Planos e Tipos de Manutenção", descricao: "Preventiva, corretiva, preditiva e inspeção.", destino: "manutencao", status: "base_existente" },
      { nome: "Falhas e Componentes", descricao: "Tipos, motivos e componentes dos equipamentos.", status: "planejado" },
      { nome: "Peças de Reposição", descricao: "Itens do produto mestre aplicáveis à manutenção.", destino: "estoque", status: "base_existente" },
      { nome: "Fabricantes", descricao: "Cadastro compartilhado com produtos e máquinas.", status: "planejado" },
    ],
  },
  {
    id: "empresa-sistema",
    nome: "Empresa e Sistema",
    descricao: "Estrutura multiempresa, governança e parametrização central.",
    itens: [
      { nome: "Empresa e Dados Fiscais", descricao: "Dados cadastrais da empresa ativa.", destino: "configuracoes", status: "disponivel" },
      { nome: "Filiais, Estabelecimentos e Plantas", descricao: "Unidades organizacionais e industriais por empresa.", status: "base_existente" },
      { nome: "Calendários, Feriados e Horários", descricao: "Disponibilidade empresarial e produtiva.", destino: "configuracoes", status: "base_existente" },
      { nome: "Usuários, Papéis e Permissões", descricao: "Governança de acesso por empresa e responsabilidade.", destino: "equipe", status: "disponivel" },
      { nome: "Sequências de Numeração", descricao: "Gerador central por entidade, empresa e série.", status: "planejado" },
      { nome: "Tags e Campos Personalizados", descricao: "Extensibilidade controlada, sem tabelas genéricas opacas.", status: "planejado" },
    ],
  },
]

export function totalCadastros(status?: CadastroStatus): number {
  return CADASTROS_GRUPOS.reduce(
    (total, grupo) => total + grupo.itens.filter((item) => !status || item.status === status).length,
    0,
  )
}
