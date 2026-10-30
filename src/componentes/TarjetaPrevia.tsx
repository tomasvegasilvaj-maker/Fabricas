import Link from 'next/link';
import { responderPrevia } from '@/app/acciones';
import { datosParaPrevia } from '@/lib/consultas';
import { urlQr } from '@/lib/motor/flujo';
import { EXTRA_TOPE_USD } from '@/lib/motor/previas';
import type { ChequeoSvg } from '@/lib/placa/svg';
import type { ConceptoRow, PasoRow, PreviaRow, VersionRow } from '@/lib/tipos-db';
import { BotonEnviar } from './BotonEnviar';
import { FormAccion } from './FormAccion';
import { ImagenArchivo } from './ImagenArchivo';

type Datos = Record<string, unknown>;

function Oculto({ previa, accion }: { previa: PreviaRow; accion: string }) {
  return (
    <>
      <input type="hidden" name="previa_id" value={previa.id} />
      <input type="hidden" name="accion" value={accion} />
    </>
  );
}

function Recordar() {
  return (
    <label className="check">
      <input type="checkbox" name="recordar" />
      <span>Recordar este comentario como preferencia para próximas placas</span>
    </label>
  );
}

function Cancelar({ previa }: { previa: PreviaRow }) {
  return (
    <FormAccion accion={responderPrevia}>
      <Oculto previa={previa} accion="cancelar" />
      <BotonEnviar clase="btn ghost sm" pendiente="Cancelando…">
        Cancelar pedido
      </BotonEnviar>
    </FormAccion>
  );
}

export async function TarjetaPrevia({ previa, comercio, pedidoNumero, conEnlace = true }: { previa: PreviaRow; comercio: string; pedidoNumero?: number; conEnlace?: boolean }) {
  const d = (previa.datos ?? {}) as Datos;
  const extra = await datosParaPrevia(previa);
  const clase = previa.tipo === 'fallo' ? ' fallo' : previa.tipo === 'tope_gasto' ? ' tope' : '';
  return (
    <article className={`card previa${clase}`} id={`previa-${previa.id}`}>
      <div>
        <div className="tag">
          {comercio}
          {pedidoNumero ? ` · pedido #${pedidoNumero}` : ''}
        </div>
        <h3 style={{ marginTop: 2 }}>{previa.titulo}</h3>
        {previa.detalle && <p className="muted small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{previa.detalle}</p>}
        {conEnlace && (
          <Link className="small" href={`/pedidos/${previa.pedido_id}`}>
            Ver el pedido completo
          </Link>
        )}
      </div>

      {previa.tipo === 'elegir_concepto' && (
        <ElegirConcepto previa={previa} conceptos={(extra as { conceptos: ConceptoRow[] }).conceptos ?? []} versiones={(extra as { versiones: VersionRow[] }).versiones ?? []} />
      )}
      {previa.tipo === 'aprobar_final' && <AprobarFinal previa={previa} d={d} version={(extra as { version?: VersionRow | null }).version ?? null} />}
      {previa.tipo === 'tope_gasto' && (
        <div className="acts">
          <FormAccion accion={responderPrevia}>
            <Oculto previa={previa} accion="seguir_tope" />
            <BotonEnviar clase="btn accent" pendiente="Subiendo…">
              Seguir (+US$ {EXTRA_TOPE_USD.toFixed(2)})
            </BotonEnviar>
          </FormAccion>
          <Cancelar previa={previa} />
        </div>
      )}
      {previa.tipo === 'falta_dato' && d.campo === 'logo' && (
        <FormAccion accion={responderPrevia} className="grid">
          <Oculto previa={previa} accion="logo" />
          <label className="campo">
            Logo del comercio <small>PNG, JPG, SVG o WebP, hasta 4 MB. Si lo tenés con fondo transparente, mejor.</small>
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/avif" required />
          </label>
          <div className="acts">
            <BotonEnviar clase="btn accent" pendiente="Subiendo…">
              Subir logo y seguir
            </BotonEnviar>
          </div>
        </FormAccion>
      )}
      {previa.tipo === 'falta_dato' && d.campo === 'destino' && (
        <FormAccion accion={responderPrevia} className="grid">
          <Oculto previa={previa} accion="destino" />
          <label className="campo">
            Link de destino <small>A dónde llevan el QR y el NFC.</small>
            <input type="url" name="destino" placeholder="https://..." required />
          </label>
          <div className="acts">
            <BotonEnviar clase="btn accent" pendiente="Guardando…">
              Guardar y activar
            </BotonEnviar>
          </div>
        </FormAccion>
      )}
      {previa.tipo === 'fallo' && <Fallo previa={previa} d={d} paso={(extra as { paso?: PasoRow | null }).paso ?? null} />}
    </article>
  );
}

function ElegirConcepto({ previa, conceptos, versiones }: { previa: PreviaRow; conceptos: ConceptoRow[]; versiones: VersionRow[] }) {
  return (
    <>
      <div className="concepts">
        {conceptos.map((c) => {
          const v = versiones.find((x) => x.concepto_id === c.id);
          const chequeo = v?.chequeo as ChequeoSvg | null;
          const datos = c.datos as { circulo_nfc?: string; paleta?: { hex: string }[]; por_que?: string };
          return (
            <div className="concept" key={c.id}>
              <div className="tag">
                Idea {c.indice} · {c.patron}
              </div>
              {v ? <ImagenArchivo path={v.preview_path} alt={`Boceto de ${c.titulo}`} /> : <div className="muted small">Sin boceto (falló).</div>}
              <div>
                <b>{c.titulo}</b>
                <p className="small" style={{ marginTop: 4 }}>
                  {c.idea}
                </p>
                {datos.circulo_nfc && <p className="muted small" style={{ marginTop: 4 }}>Círculo: {datos.circulo_nfc}</p>}
                {datos.paleta && (
                  <div className="sw" style={{ marginTop: 6 }}>
                    {datos.paleta.map((p) => (
                      <span key={p.hex} style={{ background: p.hex }} title={p.hex} />
                    ))}
                  </div>
                )}
                {chequeo?.errores?.length ? <p className="warnline" style={{ marginTop: 6 }}>{chequeo.errores.length} detalle(s) técnicos que se corrigen en la elaboración.</p> : null}
              </div>
              {v && (
                <FormAccion accion={responderPrevia} className="grid">
                  <Oculto previa={previa} accion="elegir" />
                  <input type="hidden" name="concepto_id" value={c.id} />
                  <textarea name="comentario" placeholder="Comentario opcional (ej.: el titular más grande, otro fondo)" rows={2} />
                  <Recordar />
                  <BotonEnviar clase="btn accent" pendiente="Eligiendo…">
                    Elegir esta
                  </BotonEnviar>
                </FormAccion>
              )}
            </div>
          );
        })}
      </div>
      <details>
        <summary>Ninguna me convence: pedir 3 ideas nuevas</summary>
        <FormAccion accion={responderPrevia} className="grid">
          <Oculto previa={previa} accion="rehacer" />
          <textarea name="comentario" placeholder="¿Qué no te gustó o por dónde ir?" rows={3} />
          <Recordar />
          <div className="acts">
            <BotonEnviar clase="btn" pendiente="Pidiendo…">
              Pedir ideas nuevas
            </BotonEnviar>
          </div>
        </FormAccion>
      </details>
    </>
  );
}

function AprobarFinal({ previa, d, version }: { previa: PreviaRow; d: Datos; version: VersionRow | null }) {
  const qr = d.qr_siguiente as { n: number; codigo: string; lote: string } | null;
  const puntajes = (d.puntajes ?? {}) as Record<string, number>;
  const pendientes = (d.pendientes ?? []) as string[];
  return (
    <div className="final">
      <div className="placa">{version && <ImagenArchivo path={version.preview_path} alt="Placa final" />}</div>
      <div className="grid" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        {typeof d.resumen === 'string' && <p>{d.resumen}</p>}
        {Object.keys(puntajes).length > 0 && (
          <div className="puntajes">
            {Object.entries(puntajes).map(([k, v]) => (
              <div key={k}>
                <span className="muted">{k.replace(/_/g, ' ')}</span>
                <b>{v}/5</b>
              </div>
            ))}
          </div>
        )}
        {pendientes.length > 0 && (
          <div className="alerta">
            El revisor todavía marca:
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {pendientes.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <FormAccion accion={responderPrevia} className="grid">
          <Oculto previa={previa} accion="aprobar" />
          <label className="campo">
            Link de destino del QR y del NFC
            <small>{String(d.destino_explicacion ?? '')}</small>
            <input type="url" name="destino" defaultValue={String(d.destino_sugerido ?? '')} placeholder="https://..." required />
          </label>
          {qr && (
            <p className="small">
              Se va a activar el <b>QR n.º {qr.n}</b> del lote {qr.lote} (código <span className="mono">{qr.codigo}</span>): <span className="mono">{urlQr(qr.codigo)}</span>
            </p>
          )}
          <div className="acts">
            <BotonEnviar clase="btn good" pendiente="Aprobando…">
              Aprobar y armar archivos
            </BotonEnviar>
          </div>
        </FormAccion>
        <details>
          <summary>Pedir cambios</summary>
          <FormAccion accion={responderPrevia} className="grid">
            <Oculto previa={previa} accion="cambios" />
            <textarea name="comentario" placeholder="¿Qué cambiar?" rows={3} required />
            <Recordar />
            <div className="acts">
              <BotonEnviar clase="btn" pendiente="Enviando…">
                Pedir cambios
              </BotonEnviar>
            </div>
          </FormAccion>
        </details>
      </div>
    </div>
  );
}

function Fallo({ previa, d, paso }: { previa: PreviaRow; d: Datos; paso: PasoRow | null }) {
  return (
    <>
      {paso?.error && <p className="mono small" style={{ whiteSpace: 'pre-wrap' }}>{paso.error}</p>}
      <div className="acts">
        <FormAccion accion={responderPrevia}>
          <Oculto previa={previa} accion="reintentar" />
          <BotonEnviar clase="btn accent" pendiente="Reintentando…">
            Reintentar
          </BotonEnviar>
        </FormAccion>
        {d.tipo === 'boceto' && (
          <FormAccion accion={responderPrevia}>
            <Oculto previa={previa} accion="seguir_sin_boceto" />
            <BotonEnviar clase="btn ghost" pendiente="Siguiendo…">
              Seguir sin este boceto
            </BotonEnviar>
          </FormAccion>
        )}
        {d.tipo === 'intake' && (
          <details>
            <summary>Subir otro logo</summary>
            <FormAccion accion={responderPrevia} className="grid">
              <Oculto previa={previa} accion="logo" />
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/avif" required />
              <BotonEnviar clase="btn" pendiente="Subiendo…">
                Subir y seguir
              </BotonEnviar>
            </FormAccion>
          </details>
        )}
        <Cancelar previa={previa} />
      </div>
    </>
  );
}
