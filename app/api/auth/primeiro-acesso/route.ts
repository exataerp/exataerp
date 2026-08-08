import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'O primeiro acesso por convite foi desativado. Entre com nome de usuário e senha.' },
    { status: 410 },
  )
}
