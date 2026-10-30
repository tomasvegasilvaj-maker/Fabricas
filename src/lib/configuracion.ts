export function faltaBase() {
  return !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}
