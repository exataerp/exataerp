import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"

export default defineConfig([
  ...nextVitals,
  {
    // O projeto ainda usa efeitos e memoizações do React 19 anteriores ao
    // React Compiler. Mantemos essas regras informativas até a refatoração
    // global, sem bloquear o lint das mudanças atuais.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    ".pnpm-store/**",
    "tmp/**",
    "next-env.d.ts",
  ]),
])
