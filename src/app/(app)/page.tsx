import Link from 'next/link';
import { MapaFabricas } from '@/componentes/MapaFabricas';
import { Refrescar } from '@/componentes/Refrescar';
import { SinBase } from '@/componentes/SinBase';
import { faltaBase } from '@/lib/configuracion';
import { resumenFabrica } from '@/lib/consultas';

export default async function Mapa() {
  if (faltaBase()) return <SinBase />;
  const r = await resumenFabrica();
  const cuenta = (estado: string) => r.activos.filter((p) => p.estado === estado).length;
  const aMapa = (p: (typeof r.activos)[number]) => ({
    id: p.id,
    numero: p.numero,
    comercio: p.comercio?.nombre ?? 'Comercio',
    etapa: p.etapa,
    estado: p.estado,
    gasto: Number(p.gasto_usd),
    tope: Number(p.tope_usd),
  });
  return (
    <section className="section" style={{ gap: 14 }}>
      <div className="chips">
        <span className="chip">
          <span className="dot" style={{ background: 'var(--good)' }} />
          <b>{cuenta('en_marcha')}</b> en marcha
        </span>
        <span className="chip">
          <span className="dot" style={{ background: 'var(--f-links)' }} />
          <b>{cuenta('en_espera')}</b> en espera
        </span>
        <span className="chip">
          <span className="dot" style={{ background: 'var(--warn)' }} />
          <b>{cuenta('pausado')}</b> pausadas
        </span>
        <span className="chip">
          <b>{r.lote.libres}</b> QR libres de {r.lote.total} · lote A4-1
        </span>
      </div>
      {r.previas.length > 0 && (
        <div className="banner">
          <div>
            <div className="t">
              Tenés {r.previas.length} {r.previas.length === 1 ? 'cosa' : 'cosas'} para revisar
            </div>
            <div className="muted">{r.previas.map((p) => `${p.pedido?.comercio?.nombre ?? ''} · ${p.titulo}`).slice(0, 3).join('  ·  ')}</div>
          </div>
          <Link className="btn" href="/previas">
            Ver Previas
          </Link>
        </div>
      )}
      <div className="legend">
        <span>Cómo leer el mapa:</span>
        <span>color = una fábrica</span>
        <span>humo = trabajando</span>
        <span>atenuado = por montar</span>
        <span>tocá una fábrica para ver qué está haciendo</span>
      </div>
      <MapaFabricas
        activos={r.activos.map(aMapa)}
        listos={r.listos.map(aMapa)}
        previas={r.previas.map((p) => ({ id: p.id, titulo: p.titulo, tipo: p.tipo, pedidoId: p.pedido_id, comercio: p.pedido?.comercio?.nombre ?? '' }))}
        fallosSemana={r.fallosSemana}
      />
      <Refrescar activo={r.activos.some((p) => p.estado === 'en_marcha')} cadaMs={8000} />
    </section>
  );
}
