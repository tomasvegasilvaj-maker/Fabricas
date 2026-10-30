import type { Metadata } from 'next';
import { guardarPreferencia } from '@/app/acciones';
import { BotonEnviar } from '@/componentes/BotonEnviar';
import { FormAccion } from '@/componentes/FormAccion';
import { SinBase } from '@/componentes/SinBase';
import { faltaBase } from '@/lib/configuracion';
import { loteQr, preferencias } from '@/lib/consultas';
import { env } from '@/lib/env';
import { estadoLatido } from '@/lib/motor/secreto';

export const metadata: Metadata = { title: 'Ajustes' };

const VARIABLES: { nombre: string; para: string; obligatoria: boolean }[] = [
  { nombre: 'SUPABASE_URL', para: 'Base de datos y archivos', obligatoria: true },
  { nombre: 'SUPABASE_SERVICE_ROLE_KEY', para: 'Base de datos y archivos (clave de servicio)', obligatoria: true },
  { nombre: 'APP_PASSWORD', para: 'Tu clave para entrar a la app', obligatoria: true },
  { nombre: 'ANTHROPIC_API_KEY', para: 'Los agentes de IA', obligatoria: true },
  { nombre: 'GOOGLE_PLACES_API_KEY', para: 'Datos y fotos de Google Maps (sin esto investiga solo en la web)', obligatoria: false },
  { nombre: 'WEBHOOK_SECRET', para: 'Cargar pedidos desde n8n, Make u otro sistema', obligatoria: false },
  { nombre: 'APP_URL', para: 'URL pública de la app (si falta, usa la de Vercel)', obligatoria: false },
];

const TIPOS: Record<string, string> = { regla: 'Regla', gusto: 'Me gusta', evitar: 'Evitar' };

function fecha(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Argentina/Cordoba' });
}

export default async function Ajustes() {
  const conBase = !faltaBase();
  const [prefs, lote, latido] = conBase ? await Promise.all([preferencias(), loteQr(), estadoLatido().catch(() => null)]) : [[], [], null];
  const conteo = lote.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.estado]: (acc[q.estado] ?? 0) + 1 }), {});
  const proximo = lote.find((q) => q.estado === 'libre');

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <div className="panel">
        <h2>Configuración</h2>
        <p className="muted small" style={{ marginTop: 4 }}>
          Las claves se cargan en Vercel (Settings → Environment Variables) y nunca se muestran acá. Después de cambiarlas hay que volver a desplegar.
        </p>
        <div className="overflow" style={{ marginTop: 12 }}>
          <table>
            <tbody>
              {VARIABLES.map((v) => {
                const ok = !!process.env[v.nombre];
                return (
                  <tr key={v.nombre}>
                    <td className="mono small">{v.nombre}</td>
                    <td className="small">{v.para}</td>
                    <td style={{ color: ok ? 'var(--good)' : v.obligatoria ? 'var(--bad)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {ok ? '✓ cargada' : v.obligatoria ? '✗ falta' : 'opcional'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <dl className="ficha">
          <dt>Tope de IA por placa</dt>
          <dd>US$ {env.topeUsd.toFixed(2)} (TOPE_USD_POR_PLACA)</dd>
          <dt>Latido de Supabase</dt>
          <dd>
            {!latido
              ? '—'
              : !latido.clave
                ? 'falta crear su clave en Vault (SQL del README)'
                : !latido.url
                  ? 'se activa solo cuando corra el motor en producción'
                  : `llama a ${latido.url}`}
            {latido?.ultima && <span className="muted"> · corrió {fecha(latido.ultima)} {new Date(latido.ultima).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' })}</span>}
          </dd>
          <dt>Webhook de pedidos</dt>
          <dd className="mono small">POST {env.appUrl}/api/webhook/pedido</dd>
          <dt>Estado</dt>
          <dd>
            <a href="/api/salud" target="_blank" rel="noreferrer">
              /api/salud
            </a>
          </dd>
        </dl>
      </div>

      {!conBase ? (
        <SinBase />
      ) : (
        <>
          <div className="panel">
            <h2>Preferencias</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              Lo que la fábrica tiene en cuenta en todas las placas. Se suman solas cuando marcás «Recordar» en una Previa.
            </p>
            <div className="overflow" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Preferencia</th>
                    <th>Tipo</th>
                    <th>Rubro</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {prefs.map((p) => (
                    <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.5 }}>
                      <td className="small">{p.texto}</td>
                      <td className="small">{TIPOS[p.tipo] ?? p.tipo}</td>
                      <td className="small">{p.rubro ?? 'todos'}</td>
                      <td>
                        <FormAccion accion={guardarPreferencia}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="accion" value={p.activo ? 'desactivar' : 'activar'} />
                          <BotonEnviar clase="btn ghost sm" pendiente="…">
                            {p.activo ? 'Apagar' : 'Prender'}
                          </BotonEnviar>
                        </FormAccion>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <FormAccion accion={guardarPreferencia} className="grid" key={prefs.length}>
              <input type="hidden" name="accion" value="nueva" />
              <div className="campos">
                <label className="campo" style={{ gridColumn: '1 / -1' }}>
                  Nueva preferencia
                  <textarea name="texto" rows={2} placeholder="Ej.: nunca usar fondo blanco liso; en barberías, tonos oscuros" required />
                </label>
                <label className="campo">
                  Tipo
                  <select name="tipo" defaultValue="regla">
                    <option value="regla">Regla (siempre)</option>
                    <option value="gusto">Me gusta</option>
                    <option value="evitar">Evitar</option>
                  </select>
                </label>
                <label className="campo">
                  Rubro <small>Vacío = todos</small>
                  <input name="rubro" placeholder="barbería, cafetería…" />
                </label>
              </div>
              <div className="acts">
                <BotonEnviar pendiente="Guardando…">Agregar</BotonEnviar>
              </div>
            </FormAccion>
          </div>

          <div className="panel">
            <h2>Lote de QR</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              {conteo.libre ?? 0} libres · {conteo.asignado ?? 0} asignados · {conteo.reservado ?? 0} reservados
              {proximo ? ` · el próximo es el n.º ${proximo.n} (${proximo.codigo})` : ' · no quedan libres: hace falta otro lote'}
            </p>
            <details style={{ marginTop: 10 }}>
              <summary className="small">Ver los {lote.length} códigos</summary>
              <div className="overflow" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>N.º</th>
                      <th>Código</th>
                      <th>Estado</th>
                      <th>Comercio</th>
                      <th>Desde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lote.map((q) => (
                      <tr key={q.codigo}>
                        <td className="n">
                          {q.lote}-{q.n}
                        </td>
                        <td className="mono small">{q.codigo}</td>
                        <td className="small">{q.estado}</td>
                        <td className="small">{q.comercio ?? ''}</td>
                        <td className="small muted">{fecha(q.asignado_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </>
      )}
    </section>
  );
}
