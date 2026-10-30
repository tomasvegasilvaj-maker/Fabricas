import Link from 'next/link';
import { Pestanas } from '@/componentes/Pestanas';
import { requiereSesion } from '@/lib/auth';
import { faltaBase } from '@/lib/configuracion';
import { contarPrevias } from '@/lib/consultas';
import { configuracionFaltante } from '@/lib/env';
import { salir } from '../acciones';

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  await requiereSesion();
  const faltan = configuracionFaltante();
  const previas = faltaBase() ? 0 : await contarPrevias().catch(() => 0);
  return (
    <div className="wrap">
      <header className="top">
        <Link href="/" className="brand">
          <div className="logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="7" fill="none" stroke="var(--bg)" strokeWidth="2" />
              <path d="M9 9.5a4 4 0 0 1 0 5M12 7.5a7 7 0 0 1 0 9" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1>Fábrica de Placas</h1>
            <div className="muted small">NFC + QR para comercios · La Calera</div>
          </div>
        </Link>
        <form action={salir}>
          <button type="submit" className="btn ghost sm">
            Salir
          </button>
        </form>
      </header>
      <Pestanas previas={previas} />
      {faltan.length > 0 && (
        <div className="banner warn">
          <div>
            <div className="t">Falta configurar la app</div>
            <div className="muted small">
              Variables de entorno en Vercel: <span className="mono">{faltan.join(', ')}</span>
            </div>
          </div>
          <Link className="btn ghost sm" href="/ajustes">
            Ver ajustes
          </Link>
        </div>
      )}
      {children}
    </div>
  );
}
