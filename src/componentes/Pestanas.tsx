'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Pestanas({ previas }: { previas: number }) {
  const ruta = usePathname();
  const activa = (href: string) => (href === '/' ? ruta === '/' : ruta === href || (ruta.startsWith(`${href}/`) && !(href === '/pedidos' && ruta === '/pedidos/nuevo')));
  const tabs = [
    { href: '/', texto: 'Mapa' },
    { href: '/previas', texto: 'Previas', extra: previas > 0 ? <b> {previas}</b> : null },
    { href: '/pedidos', texto: 'Pedidos' },
    { href: '/pedidos/nuevo', texto: '+ Nuevo pedido' },
    { href: '/ajustes', texto: 'Ajustes' },
  ];
  return (
    <nav className="tabs" aria-label="Secciones">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={activa(t.href) ? 'page' : undefined}>
          {t.texto}
          {t.extra}
        </Link>
      ))}
    </nav>
  );
}
