import type { Metadata } from 'next';
import { SinBase } from '@/componentes/SinBase';
import { TarjetaPrevia } from '@/componentes/TarjetaPrevia';
import { faltaBase } from '@/lib/configuracion';
import { previasPendientes } from '@/lib/consultas';

export const metadata: Metadata = { title: 'Previas' };
// Las respuestas despiertan al motor en la misma función: necesita el tiempo largo.
export const maxDuration = 300;

export default async function Previas() {
  if (faltaBase()) return <SinBase />;
  const previas = await previasPendientes();
  return (
    <section className="section">
      <div>
        <h2>Previas</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Todo lo que espera tu OK. Lo que marcás como «recordar» queda guardado y la fábrica lo usa en los próximos pedidos.
        </p>
      </div>
      {previas.length === 0 && <div className="panel muted">No hay nada pendiente. 🎉</div>}
      <div className="list">
        {previas.map((p) => (
          <TarjetaPrevia key={p.id} previa={p} comercio={p.pedido?.comercio?.nombre ?? ''} pedidoNumero={p.pedido?.numero} />
        ))}
      </div>
    </section>
  );
}
