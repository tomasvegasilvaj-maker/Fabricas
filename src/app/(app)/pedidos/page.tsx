import type { Metadata } from 'next';
import Link from 'next/link';
import { SinBase } from '@/componentes/SinBase';
import { faltaBase } from '@/lib/configuracion';
import { listaPedidos } from '@/lib/consultas';
import { NOMBRE_ESTADO, nombreEtapa, OBJETIVOS } from '@/lib/motor/flujo';

export const metadata: Metadata = { title: 'Pedidos' };

const COLOR_ESTADO: Record<string, string> = {
  en_marcha: 'var(--good)',
  en_espera: 'var(--f-links)',
  pausado: 'var(--warn)',
  listo: 'var(--ink)',
  fallido: 'var(--bad)',
  cancelado: 'var(--idle)',
};

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  if (faltaBase()) return <SinBase />;
  const { estado } = await searchParams;
  const todos = await listaPedidos();
  const pedidos = estado ? todos.filter((p) => p.estado === estado) : todos;
  return (
    <section className="section">
      <div className="top">
        <div>
          <h2>Pedidos{estado ? ` · ${NOMBRE_ESTADO[estado] ?? estado}` : ''}</h2>
          <p className="muted small">{pedidos.length} pedidos{estado && <> · <Link href="/pedidos">ver todos</Link></>}</p>
        </div>
        <Link className="btn accent" href="/pedidos/nuevo">
          + Nuevo pedido
        </Link>
      </div>
      <div className="panel overflow">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Comercio</th>
              <th>Objetivo</th>
              <th>Etapa</th>
              <th>Estado</th>
              <th>IA (US$)</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => {
              const uso = Math.min(Number(p.gasto_usd) / Number(p.tope_usd || 1), 1);
              return (
                <tr key={p.id}>
                  <td className="n">
                    <Link href={`/pedidos/${p.id}`}>#{p.numero}</Link>
                  </td>
                  <td>
                    <Link href={`/pedidos/${p.id}`}>
                      <b>{p.comercio?.nombre}</b>
                    </Link>
                    <div className="muted small">
                      {p.comercio?.rubro}
                      {p.simulado ? ' · prueba' : ''}
                    </div>
                  </td>
                  <td>{OBJETIVOS[p.objetivo]?.nombre ?? p.objetivo}</td>
                  <td>{nombreEtapa(p.etapa)}</td>
                  <td>
                    <span className="status" style={{ marginTop: 0 }}>
                      <span className="dot" style={{ background: COLOR_ESTADO[p.estado] ?? 'var(--idle)' }} />
                      {NOMBRE_ESTADO[p.estado] ?? p.estado}
                    </span>
                  </td>
                  <td>
                    <div className="small">
                      {Number(p.gasto_usd).toFixed(2)} / {Number(p.tope_usd).toFixed(2)}
                    </div>
                    <div className={`bar${uso > 0.85 ? ' alta' : ''}`}>
                      <i style={{ width: `${Math.round(uso * 100)}%` }} />
                    </div>
                  </td>
                  <td className="muted small">{new Date(p.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' })}</td>
                </tr>
              );
            })}
            {pedidos.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Todavía no hay pedidos. <Link href="/pedidos/nuevo">Cargá el primero</Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
