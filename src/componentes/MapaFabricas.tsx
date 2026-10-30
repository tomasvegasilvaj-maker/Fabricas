'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ETAPAS, indiceEtapa, nombreEtapa } from '@/lib/motor/flujo';
import { Edificio } from './Edificio';

export type PedidoMapa = { id: string; numero: number; comercio: string; etapa: string; estado: string; gasto: number; tope: number };
export type PreviaMapa = { id: string; titulo: string; tipo: string; pedidoId: string; comercio: string };

type Fabrica = {
  id: string;
  nombre: string;
  color: string;
  activa: boolean;
  entra: { t: string; s: string };
  revision: { t: string; s: string };
  destino: { t: string; s: string };
  descripcion: string;
};

const PROXIMAS: Fabrica[] = [
  {
    id: 'links',
    nombre: 'Páginas de links',
    color: 'var(--f-links)',
    activa: false,
    entra: { t: 'Placa lista', s: 'Datos del comercio' },
    revision: { t: 'Vos', s: 'Revisás textos y botones' },
    destino: { t: 'Página publicada', s: 'Como la de Sentite' },
    descripcion: 'Arma la página de links del comercio (turnos, WhatsApp, reseñas, cómo llegar) a partir de la investigación de la placa.',
  },
  {
    id: 'muestras',
    nombre: 'Muestras de venta',
    color: 'var(--f-muestras)',
    activa: false,
    entra: { t: 'Comercio prospecto', s: 'Nombre y rubro' },
    revision: { t: 'Vos', s: 'Elegís cuál llevar' },
    destino: { t: 'Muestra impresa', s: 'Para ofrecer en persona' },
    descripcion: 'Hace una placa de muestra para un comercio que todavía no es cliente, para llevarla y ofrecerla.',
  },
  {
    id: 'prospectos',
    nombre: 'Prospectos',
    color: 'var(--f-prosp)',
    activa: false,
    entra: { t: 'Zona y rubro', s: 'La Calera y alrededores' },
    revision: { t: 'Vos', s: 'Marcás a quién visitar' },
    destino: { t: 'Lista de visitas', s: 'Con datos y argumento' },
    descripcion: 'Busca comercios con pocas reseñas o sin placa en la zona, y arma la lista de a quién visitar.',
  },
];

function Conector({ texto }: { texto: string }) {
  return (
    <div className="conn" aria-hidden="true">
      <span>{texto}</span>
      <i />
    </div>
  );
}

export function MapaFabricas({ activos, listos, previas, fallosSemana }: { activos: PedidoMapa[]; listos: PedidoMapa[]; previas: PreviaMapa[]; fallosSemana: number }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const enMarcha = activos.filter((p) => p.estado === 'en_marcha');
  const enEspera = activos.filter((p) => p.estado === 'en_espera');
  const pausadas = activos.filter((p) => p.estado === 'pausado');

  useEffect(() => {
    if (!abierta) return;
    const cerrar = (e: KeyboardEvent) => e.key === 'Escape' && setAbierta(null);
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [abierta]);

  const placas: Fabrica = {
    id: 'placas',
    nombre: 'Placas NFC',
    color: 'var(--f-nfc)',
    activa: true,
    entra: { t: 'Pedidos nuevos', s: 'Formulario o webhook · con logo' },
    revision: { t: previas.length ? `${previas.length} Previa${previas.length > 1 ? 's' : ''}` : 'Sin Previas', s: 'Elegís la idea y aprobás la final' },
    destino: { t: `${listos.length} lista${listos.length === 1 ? '' : 's'}`, s: 'Imprimís, pegás el QR y grabás el NFC' },
    descripcion: 'Recibe el comercio, investiga, busca inspiración, propone 3 ideas, dibuja, revisa y deja todo listo para imprimir.',
  };
  const fabricas = [placas, ...PROXIMAS];
  const actual = abierta ? fabricas.find((f) => f.id === abierta) : null;

  const estadoPlacas = enMarcha.length
    ? { color: 'var(--good)', texto: `${enMarcha.length} en marcha${enEspera.length ? ` · ${enEspera.length} en espera` : ''}` }
    : enEspera.length
      ? { color: 'var(--f-links)', texto: `${enEspera.length} esperando tu OK` }
      : pausadas.length
        ? { color: 'var(--warn)', texto: `${pausadas.length} pausada${pausadas.length > 1 ? 's' : ''}` }
        : { color: 'var(--idle)', texto: 'Quieta: cargá un pedido' };

  return (
    <>
      <div className="cols">
        <span>1 · Lo que entra</span>
        <span>2 · Fábrica</span>
        <span>3 · Revisión</span>
        <span>4 · Destino</span>
      </div>
      <div style={{ display: 'grid', gap: 14 }}>
        {fabricas.map((f) => (
          <div key={f.id} className={`row${f.activa ? '' : ' off'}`}>
            <div className="lbl" style={{ color: f.color }}>
              {f.nombre}
              {!f.activa && ' · próximamente'}
            </div>
            <div className="flow">
              {f.activa ? (
                <Link className="node" href="/pedidos/nuevo">
                  <b>{f.entra.t}</b>
                  <small>{f.entra.s}</small>
                </Link>
              ) : (
                <div className="node">
                  <b>{f.entra.t}</b>
                  <small>{f.entra.s}</small>
                </div>
              )}
              <Conector texto={f.activa ? 'recepción' : ''} />
              <button type="button" className="fab" onClick={() => setAbierta(f.id)} aria-label={`Ver qué está haciendo ${f.nombre}`}>
                <Edificio color={f.color} trabajando={f.activa && enMarcha.length > 0} />
                <div style={{ minWidth: 0 }}>
                  <b>{f.nombre}</b>
                  <div className="status">
                    <span className="dot" style={{ background: f.activa ? estadoPlacas.color : 'var(--idle)' }} />
                    {f.activa ? estadoPlacas.texto : 'Por montar'}
                  </div>
                </div>
              </button>
              <Conector texto={f.activa ? 'revisor + vos' : ''} />
              {f.activa ? (
                <Link className="node" href="/previas">
                  <b>{f.revision.t}</b>
                  <small>{f.revision.s}</small>
                </Link>
              ) : (
                <div className="node">
                  <b>{f.revision.t}</b>
                  <small>{f.revision.s}</small>
                </div>
              )}
              <Conector texto={f.activa ? 'activación' : ''} />
              {f.activa ? (
                <Link className="dest" href="/pedidos?estado=listo">
                  {f.destino.t}
                  <small>{f.destino.s}</small>
                </Link>
              ) : (
                <div className="dest">
                  {f.destino.t}
                  <small>{f.destino.s}</small>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {actual && (
        <>
          <button type="button" className="scrim" aria-label="Cerrar" onClick={() => setAbierta(null)} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="titulo-fabrica">
            <div className="dh">
              <Edificio color={actual.color} trabajando={actual.activa && enMarcha.length > 0} />
              <div>
                <h2 id="titulo-fabrica">{actual.nombre}</h2>
                <div className="muted small">{actual.activa ? 'Fábrica activa' : 'Próximamente'}</div>
              </div>
              <button type="button" className="close" onClick={() => setAbierta(null)} aria-label="Cerrar">
                ×
              </button>
            </div>
            {actual.activa ? (
              <PanelPlacas activos={activos} listos={listos} previas={previas} fallosSemana={fallosSemana} cerrar={() => setAbierta(null)} />
            ) : (
              <div className="ahora off">
                <div className="k">Qué va a hacer</div>
                <p>{actual.descripcion}</p>
              </div>
            )}
          </aside>
        </>
      )}
    </>
  );
}

function PanelPlacas({ activos, listos, previas, fallosSemana, cerrar }: { activos: PedidoMapa[]; listos: PedidoMapa[]; previas: PreviaMapa[]; fallosSemana: number; cerrar: () => void }) {
  const orden = ['en_marcha', 'en_espera', 'pausado'];
  const ordenados = [...activos].sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado));
  const foco = ordenados[0];
  const clase = !foco ? 'off' : foco.estado === 'en_espera' ? 'wait' : foco.estado === 'pausado' ? 'pause' : '';
  return (
    <>
      <div className={`ahora ${clase}`}>
        <div className="k">Ahora</div>
        {foco ? (
          <>
            <div className="h">
              <span className="dot" style={{ background: clase === 'wait' ? 'var(--f-links)' : clase === 'pause' ? 'var(--warn)' : 'var(--good)' }} />
              <span>
                #{foco.numero} {foco.comercio}: {nombreEtapa(foco.etapa)}
              </span>
            </div>
            <Segmentos etapa={foco.etapa} />
            <div className="muted small">
              Paso {Math.min(indiceEtapa(foco.etapa) + 1, ETAPAS.length)} de {ETAPAS.length} · IA US$ {foco.gasto.toFixed(2)} de {foco.tope.toFixed(2)}
            </div>
            {fallosSemana > 0 && <div className="warnline">{fallosSemana} paso(s) fallaron esta semana: mirá las Previas.</div>}
            <Link className="btn sm ghost" href={`/pedidos/${foco.id}`} onClick={cerrar} style={{ justifySelf: 'start' }}>
              Abrir pedido
            </Link>
            {ordenados.length > 1 && (
              <div className="hist">
                {ordenados.slice(1).map((p) => (
                  <div key={p.id}>
                    <Link href={`/pedidos/${p.id}`} onClick={cerrar}>
                      #{p.numero} {p.comercio}
                    </Link>
                    <span className="muted">{nombreEtapa(p.etapa)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">No hay placas en la línea. Cargá un pedido nuevo para arrancar.</p>
        )}
      </div>

      <div className="todo">
        <div className="h">¿Tenés algo que hacer?</div>
        {previas.length ? (
          previas.map((p) => (
            <div className="it" key={p.id}>
              <div>
                <b>{p.titulo}</b>
                <small>{p.comercio}</small>
              </div>
              <Link className="btn sm" href={`/pedidos/${p.pedidoId}#previas`} onClick={cerrar}>
                Ver
              </Link>
            </div>
          ))
        ) : (
          <p className="muted small">Nada por ahora. Cuando haya algo para elegir o aprobar, aparece acá.</p>
        )}
      </div>

      <Link className="more" href="/pedidos" onClick={cerrar}>
        Ver más
      </Link>

      {listos.length > 0 && (
        <div className="hist">
          <div className="k">Últimas listas</div>
          {listos.map((p) => (
            <div key={p.id}>
              <Link href={`/pedidos/${p.id}`} onClick={cerrar}>
                #{p.numero} {p.comercio}
              </Link>
              <span className="muted">lista</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function Segmentos({ etapa }: { etapa: string }) {
  const actual = indiceEtapa(etapa);
  return (
    <div className="segs" aria-label={`Etapa ${nombreEtapa(etapa)}`}>
      <div className="bars">
        {ETAPAS.map((e, i) => (
          <i key={e.id} className={i < actual ? 'd' : i === actual ? (e.tuya ? 'h' : 'c') : ''} title={e.nombre} />
        ))}
      </div>
    </div>
  );
}
