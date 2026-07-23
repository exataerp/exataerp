import * as XLSX from "xlsx"

export interface Operation {
  id: string
  name: string
  time: number
  setupTime: number
  unit: "minutes" | "seconds"
  maquina_id?: string
  maquina_nome?: string
  maquina_codigo?: string
}

export const exportToExcel = async (operations: Operation[], timeUnit: string) => {
  const data = operations.map((op, index) => ({
    "ORDEM": index + 1,
    "NOME DA OPERAÇÃO": op.name,
    "TEMPO": op.time,
    "SETUP": op.setupTime || 0,
    "UNIDADE": op.unit === "seconds" ? "segundos" : "minutos"
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Operacoes")
  XLSX.writeFile(wb, "analise-gbo.xlsx")
}

export const downloadTemplate = () => {
  const link = document.createElement("a")
  link.href = "/modelo-padrao.xlsx"
  link.download = "modelo-padrao-gbo.xlsx"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const importFromExcel = async (file: File): Promise<Operation[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: "array" })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { blankrows: false })

        const operations: Operation[] = rawJson.map((row: any) => {
          const normalizedRow: any = {}
          for (const key in row) {
            if (Object.prototype.hasOwnProperty.call(row, key)) {
              normalizedRow[key.toUpperCase().trim()] = row[key]
            }
          }

          const name = String(normalizedRow["NOME DA OPERAÇÃO"] || normalizedRow["NOME"] || "Sem Nome")
          const time = Number(normalizedRow["TEMPO"]) || 0
          const setupTime = Number(normalizedRow["SETUP"] || normalizedRow["TEMPO DE SETUP"]) || 0
          const rawUnit = String(normalizedRow["UNIDADE"] || "minutos").toLowerCase()
          
          const unit: "minutes" | "seconds" = rawUnit.includes("seg") ? "seconds" : "minutes"

          return {
            id: Date.now().toString() + Math.random().toString(36).substring(7),
            name,
            time,
            setupTime,
            unit,
          }
        }).filter(op => op.time > 0) 

        resolve(operations)
      } catch (error) {
        reject(error)
      }
    }
    reader.onerror = (error) => reject(error)
    reader.readAsArrayBuffer(file)
  })
}
