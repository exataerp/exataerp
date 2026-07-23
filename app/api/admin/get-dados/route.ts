import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const { table, empresaId } = await request.json()

    if (!table || !empresaId) {
      return NextResponse.json({ error: "Faltam parâmetros" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("empresa_id", empresaId)

    if (error) throw error

    return NextResponse.json({ data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
