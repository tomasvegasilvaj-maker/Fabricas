import { env } from '../env';

/** URL de esta misma app para despertar al motor (en Preview, la del deploy; en producción, la principal). */
function urlPropia() {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return env.appUrl;
}

/**
 * Despierta n trabajadores del motor (cada uno es una llamada aparte a /api/motor, así los
 * bocetos corren en paralelo). Si falla no pasa nada: el latido de Supabase los levanta igual.
 */
export async function patearMotor(n = 1) {
  if (n <= 0) return;
  const headers: Record<string, string> = { Authorization: `Bearer ${env.motorSecret}`, 'Content-Type': 'application/json' };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const url = `${urlPropia()}/api/motor`;
  const resultados = await Promise.allSettled(
    Array.from({ length: n }, () => fetch(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(6000) })),
  );
  for (const r of resultados) {
    if (r.status === 'rejected') console.error('No se pudo despertar al motor:', String(r.reason));
    else if (!r.value.ok && r.value.status !== 202) console.error('El motor respondió', r.value.status);
  }
}
