import { createClient } from "@/lib/supabase/client"

// Usa o mesmo cliente baseado em cookies do AuthContext. Um segundo cliente
// supabase-js isolado não enxergava a sessão criada no login.
export const supabase = createClient()
