# Exata

Sistema ERP para micro e pequenas indústrias brasileiras. Controle de produção, máquinas, manutenção e apontamentos em uma única plataforma — sem complexidade desnecessária.

---

## Módulos

**Produto / Roteiro**
Cadastro de produtos com roteiro de operações e tempos de ciclo. Base para o nivelamento do PCP.

**PCP — Programação de Produção**
Lógica Heijunka para nivelamento de carga por máquina. Ordens de produção com transbordo automático, visualização em Kanban semanal, calendário e lista. Gestão de exceções de capacidade por dia.

**Máquinas**
Cadastro de postos de trabalho com capacidade diária, tempo de setup e status operacional.

**Manutenção**
Registro e acompanhamento de ordens de manutenção corretiva e preventiva por ativo.

**Apontamento**
Registro de execução de produção com indicadores de performance por ordem e por turno.

---

## Stack

- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (PostgreSQL + RLS)
- Vercel

---

## Configuração

```bash
npm install
```

Crie um arquivo `.env.local` na raiz:

```env
NEXT_PUBLIC_SUPABASE_URL=sua_url_aqui
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_aqui
```

```bash
npm run dev
```

---

## Acesso

O sistema não utiliza login tradicional. Cada fábrica é identificada por um código de acesso único gerado no cadastro. O isolamento de dados é garantido por `empresa_id` em todas as tabelas.

---

<sub>Construído para quem valoriza a precisão. Exata © 2026</sub>
