import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accionPedido } from '@/app/acciones';
import { BotonEnviar } from '@/componentes/BotonEnviar';
import { FormAccion } from '@/componentes/FormAccion';
import { ImagenArchivo, urlArchivo } from '@/componentes/ImagenArchivo';
import { Segmentos } from '@/componentes/MapaFabricas';
import { Refrescar } from '@/componentes/Refrescar';
import { SinBase } from '@/componentes/SinBase';
import { TarjetaPrevia } from '@/componentes/TarjetaPrevia';
import { faltaBase } from '@/lib/configuracion';
import { detallePedido } from '@/lib/consultas';
import { ETAPAS, indiceEtapa, NOMBRE_ESTADO, NOMBRE_PASO, nombreEtapa, OBJETIVOS } from '@/lib/motor/flujo';
import type { TipoPaso } from '@/lib/motor/tipos';
import type { ChequeoSvg } from '@/lib/placa/svg';

export const metadata: Metadata = { title: 'Pedido' };
export const maxDuration = 300;

const ENTREGABLES = ['pdf_imprenta', 'pdf_a4', 'foto_10x15', 'svg_final'];

function fecha(iso: string) {
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
}

function kb(bytes: number | null) {
  if (!bytes) return '';
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}

function AccionPedido({ pedidoId, accion, texto, clase = 'btn ghost sm' }: { pedidoId: string; accion: string; texto: string; clase?: string }) {
  return (
    <FormAccion accion={accionPedido}>
      <input type="hidden" name="pedido_id" value={pedidoId} />
      <input type="hidden" name="accion" value={accion} />
      <BotonEnviar clase={clase} pendiente="…">
        {texto}
      </BotonEnviar>
    </FormAccion>
  );
}

export default async function Pedido({ params }: { params: Promise<{ id: string }> }) {
  if (faltaBase()) return <SinBase />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await detallePedido(id);
  if (!d) notFound();
  const { pedido, comercio } = d;

  const etapaActual = indiceEtapa(pedido.etapa);
  const pendientes = d.previas.filter((p) => p.estado === 'pendiente');
  const activacion = d.pasos.filter((p) => p.tipo === 'activacion' && p.estado === 'hecho').at(-1)?.salida as
    | { n: number; codigo: string; lote: string; url_qr: string; destino: string; simulado: boolean }
    | undefined;
  const entregables = d.archivos.filter((a) => a.pedido_id === pedido.id && ENTREGABLES.includes(a.tipo));
  const inv = comercio.investigacion as { resumen?: string; fuentes?: { titulo: string; url: string }[]; estilo_visual?: string; destacados?: string[]; frases_clientes?: string[] } | null;
  const tandas = [...new Set(d.conceptos.map((c) => c.tanda))];
  const trabajando = pedido.estado === 'en_marcha';
  const corriendo = d.pasos.find((p) => p.estado === 'corriendo');

  return (
    <section className="order">
      <aside className="panel">
        <div className="tag" style={{ color: 'var(--f-nfc)' }}>
          Placas NFC · pedido #{pedido.numero}
          {pedido.simulado ? ' · prueba' : ''}
        </div>
        <h2 style={{ marginTop: 4 }}>{comercio.nombre}</h2>
        <div className="muted small">
          {comercio.rubro}
          {comercio.ciudad ? ` · ${comercio.ciudad}` : ''}
        </div>
        <div style={{ marginTop: 12 }}>
          <Segmentos etapa={pedido.etapa} />
        </div>
        <ol className="steps" style={{ marginTop: 12 }}>
          {ETAPAS.map((e, i) => {
            const clase = [i < etapaActual ? 'done' : '', i === etapaActual && pedido.etapa !== 'listo' ? 'now' : '', e.tuya ? 'human' : ''].join(' ');
            return (
              <li key={e.id} className={clase}>
                <span className="ic">{i < etapaActual ? '✓' : i + 1}</span>
                <span>
                  {e.nombre}
                  <small>{e.detalle}</small>
                </span>
              </li>
            );
          })}
        </ol>
        <dl className="ficha">
          <dt>Estado</dt>
          <dd>
            {NOMBRE_ESTADO[pedido.estado] ?? pedido.estado}
            {corriendo ? ` · ${NOMBRE_PASO[corriendo.tipo as TipoPaso] ?? corriendo.tipo}` : ''}
          </dd>
          <dt>Objetivo</dt>
          <dd>{OBJETIVOS[pedido.objetivo]?.nombre ?? pedido.objetivo}</dd>
          <dt>Medida</dt>
          <dd>10 × 15 cm</dd>
          <dt>QR</dt>
          <dd className="mono">{activacion ? `lote ${activacion.lote} · n.º ${activacion.n} · ${activacion.codigo}${activacion.simulado ? ' (prueba)' : ''}` : 'se asigna al aprobar'}</dd>
          <dt>Destino</dt>
          <dd className="small">{activacion?.destino ?? pedido.destino_url ?? '—'}</dd>
          <dt>Costo IA</dt>
          <dd>
            US$ {Number(pedido.gasto_usd).toFixed(2)} <span className="muted">de {Number(pedido.tope_usd).toFixed(2)} tope</span>
          </dd>
        </dl>
        <div className="acts" style={{ marginTop: 14 }}>
          {(pedido.estado === 'en_marcha' || pedido.estado === 'en_espera') && <AccionPedido pedidoId={pedido.id} accion="pausar" texto="Pausar" />}
          {pedido.estado === 'pausado' && <AccionPedido pedidoId={pedido.id} accion="reanudar" texto="Reanudar" clase="btn sm" />}
          {pedido.estado === 'en_marcha' && <AccionPedido pedidoId={pedido.id} accion="despertar" texto="Empujar motor" />}
          {!['listo', 'cancelado'].includes(pedido.estado) && <AccionPedido pedidoId={pedido.id} accion="cancelar" texto="Cancelar" />}
        </div>
      </aside>

      <div className="panel">
        {pendientes.length > 0 && (
          <div className="section" id="previas">
            <h3>Te toca a vos</h3>
            {pendientes.map((p) => (
              <TarjetaPrevia key={p.id} previa={p} comercio={comercio.nombre} conEnlace={false} />
            ))}
          </div>
        )}

        {entregables.length > 0 && (
          <div className="section">
            <h3>Listo para imprimir</h3>
            {activacion && (
              <p className="small">
                Pegá el <b>QR n.º {activacion.n}</b> (<span className="mono">{activacion.codigo}</span>) y grabá el NFC con <span className="mono">{activacion.url_qr}</span>.
                {activacion.simulado && <b> Es una prueba: este QR no se activó.</b>}
              </p>
            )}
            <div className="archivos">
              {entregables.map((a) => (
                <a key={a.id} href={urlArchivo(a.path, true)}>
                  <span>
                    <b>{a.nombre ?? a.tipo}</b>
                    <span className="muted small"> · {a.path.split('/').pop()}</span>
                  </span>
                  <span className="muted small">{kb(a.bytes)} ↓</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {d.versiones.length > 0 && (
          <div className="section">
            <h3>Versiones</h3>
            {d.versiones.map((v) => {
              const chequeo = v.chequeo as ChequeoSvg | null;
              const rev = v.revision as { resumen?: string; veredicto?: string; puntajes?: Record<string, number>; problemas?: { gravedad: string; descripcion: string }[] } | null;
              return (
                <div key={v.id} className="final" style={{ paddingBottom: 14, borderBottom: '1px dashed var(--line)' }}>
                  <div className="placa">
                    <ImagenArchivo path={v.preview_path} alt={`Versión ${v.numero}`} />
                  </div>
                  <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                    <div>
                      <div className="tag">{v.origen === 'boceto' ? `Boceto ${v.numero}` : `Versión ${v.numero}`}{pedido.version_final_id === v.id ? ' · final' : ''}</div>
                      <div className="muted small">
                        {fecha(v.created_at)}
                        {v.notas ? ` · ${v.notas}` : ''}
                      </div>
                    </div>
                    {rev?.resumen && (
                      <p className="small">
                        <b>Revisión ({rev.veredicto}):</b> {rev.resumen}
                      </p>
                    )}
                    {rev?.puntajes && (
                      <div className="puntajes">
                        {Object.entries(rev.puntajes).map(([k, n]) => (
                          <div key={k}>
                            <span className="muted">{k.replace(/_/g, ' ')}</span>
                            <b>{n}/5</b>
                          </div>
                        ))}
                      </div>
                    )}
                    {rev?.problemas?.length ? (
                      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                        {rev.problemas.map((p, i) => (
                          <li key={i}>
                            <b>{p.gravedad}:</b> {p.descripcion}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {chequeo && (chequeo.errores.length > 0 || chequeo.avisos.length > 0) && (
                      <details>
                        <summary className="small">
                          Chequeo automático: {chequeo.errores.length} errores, {chequeo.avisos.length} avisos
                        </summary>
                        <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                          {chequeo.errores.map((e) => (
                            <li key={e} style={{ color: 'var(--bad)' }}>
                              {e}
                            </li>
                          ))}
                          {chequeo.avisos.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tandas.length > 0 && (
          <div className="section">
            <h3>Ideas</h3>
            {tandas.map((t) => (
              <div key={t} style={{ display: 'grid', gap: 8 }}>
                {tandas.length > 1 && <div className="k">Tanda {t}</div>}
                <div className="concepts">
                  {d.conceptos
                    .filter((c) => c.tanda === t)
                    .map((c) => (
                      <div key={c.id} className={`concept${c.elegido ? ' pick' : ''}`}>
                        <div className="tag">
                          Idea {c.indice} · {c.patron}
                          {c.elegido ? ' · elegida' : ''}
                        </div>
                        <b>{c.titulo}</b>
                        <p className="small">{c.idea}</p>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {d.inspiracion.length > 0 && (
          <div className="section">
            <h3>Inspiración</h3>
            <div className="mood">
              {d.inspiracion.map((r) => (
                <a key={r.id} className="ref" href={r.url_pagina ?? '#'} target="_blank" rel="noreferrer noopener">
                  {r.imagen_path ? <ImagenArchivo path={r.imagen_path} alt={r.titulo} /> : <div className="sin">sin imagen</div>}
                  <p>
                    <b>{r.titulo}</b>
                    <span className="muted">{r.patron ? `${r.patron} · ` : ''}{r.nota}</span>
                  </p>
                </a>
              ))}
            </div>
          </div>
        )}

        {inv?.resumen && (
          <div className="section">
            <h3>Investigación</h3>
            <p>{inv.resumen}</p>
            {inv.estilo_visual && <p className="small"><b>Estilo:</b> {inv.estilo_visual}</p>}
            {inv.destacados?.length ? <p className="small"><b>Destacados:</b> {inv.destacados.join(' · ')}</p> : null}
            {inv.frases_clientes?.length ? <p className="small"><b>Clientes:</b> «{inv.frases_clientes.join('» · «')}»</p> : null}
            {inv.fuentes?.length ? (
              <p className="small muted">
                Fuentes:{' '}
                {inv.fuentes.map((f, i) => (
                  <span key={f.url}>
                    {i > 0 && ' · '}
                    <a href={f.url} target="_blank" rel="noreferrer noopener">
                      {f.titulo}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        )}

        <div className="section">
          <h3>Pasos</h3>
          <div className="overflow">
            <table>
              <thead>
                <tr>
                  <th>Paso</th>
                  <th>Estado</th>
                  <th>Intento</th>
                  <th>IA</th>
                  <th>Cuándo</th>
                </tr>
              </thead>
              <tbody>
                {d.pasos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {NOMBRE_PASO[p.tipo as TipoPaso] ?? p.tipo}
                      {p.error && p.estado !== 'hecho' && <div className="small" style={{ color: 'var(--bad)' }}>{p.error.slice(0, 240)}</div>}
                    </td>
                    <td>{p.estado}</td>
                    <td>
                      {p.intento}/{p.max_intentos}
                    </td>
                    <td className="n">{Number(p.costo_usd) > 0 ? Number(p.costo_usd).toFixed(3) : '—'}</td>
                    <td className="muted small">{fecha(p.terminado_at ?? p.tomado_at ?? p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section">
          <h3>Registro</h3>
          <div className="eventos">
            {d.eventos.map((e) => (
              <div key={e.id} className={e.nivel}>
                <span className="muted mono">{fecha(e.created_at)}</span>
                <span>{e.mensaje}</span>
              </div>
            ))}
          </div>
          <p className="muted small">
            Etapa actual: {nombreEtapa(pedido.etapa)} · <Link href="/pedidos">volver a pedidos</Link>
          </p>
        </div>
      </div>
      <Refrescar activo={trabajando && pendientes.length === 0} cadaMs={5000} />
    </section>
  );
}
