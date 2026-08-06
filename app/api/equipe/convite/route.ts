import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Convites por e-mail foram desativados. Use o cadastro manual de usuários.' },
    { status: 410 },
  )
}
