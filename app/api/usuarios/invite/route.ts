import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Convites por e-mail foram desativados. Cadastre o usuário e defina a senha diretamente.' },
    { status: 410 },
  )
}
