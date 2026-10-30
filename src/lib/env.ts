// Variables de entorno. Se leen recién cuando hacen falta, así el build no las necesita.

function obligatoria(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export const env = {
  get supabaseUrl() {
    return obligatoria('SUPABASE_URL');
  },
  get supabaseKey() {
    return obligatoria('SUPABASE_SERVICE_ROLE_KEY');
  },
  get appPassword() {
    return obligatoria('APP_PASSWORD');
  },
  get sessionSecret() {
    return obligatoria('SESSION_SECRET');
  },
  get motorSecret() {
    return obligatoria('MOTOR_SECRET');
  },
  get webhookSecret() {
    return process.env.WEBHOOK_SECRET || null;
  },
  get googlePlacesKey() {
    return process.env.GOOGLE_PLACES_API_KEY || null;
  },
  get appUrl() {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    return 'http://localhost:3000';
  },
  get topeUsd() {
    const n = Number(process.env.TOPE_USD_POR_PLACA);
    return Number.isFinite(n) && n > 0 ? n : 2.5;
  },
  /** Tiempo máximo de una función en Vercel (Hobby: 300 s). */
  get duracionMaxSeg() {
    const n = Number(process.env.FAB_DURACION_MAX_SEG);
    return Number.isFinite(n) && n > 0 ? n : 300;
  },
};

/** Qué falta configurar para que la fábrica funcione (se muestra en la app en vez de romper). */
export function configuracionFaltante(): string[] {
  const faltan: string[] = [];
  for (const nombre of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_PASSWORD', 'SESSION_SECRET', 'MOTOR_SECRET']) {
    if (!process.env[nombre]) faltan.push(nombre);
  }
  if (!process.env.ANTHROPIC_API_KEY) faltan.push('ANTHROPIC_API_KEY');
  return faltan;
}
