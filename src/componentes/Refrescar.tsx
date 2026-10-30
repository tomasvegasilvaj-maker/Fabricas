'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Vuelve a pedir la página cada tanto mientras la fábrica está trabajando. */
export function Refrescar({ activo, cadaMs = 5000 }: { activo: boolean; cadaMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, cadaMs);
    return () => clearInterval(id);
  }, [activo, cadaMs, router]);
  return null;
}
