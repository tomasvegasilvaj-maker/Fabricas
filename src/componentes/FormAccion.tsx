'use client';

import { useActionState } from 'react';
import type { EstadoAccion } from '@/app/acciones';

/** Formulario de una acción del servidor que muestra el resultado (error u ok) debajo. */
export function FormAccion({
  accion,
  children,
  className,
}: {
  accion: (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>;
  children: React.ReactNode;
  className?: string;
}) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className={className}>
      {children}
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
      {estado?.ok && (
        <p className="exito" role="status">
          {estado.ok}
        </p>
      )}
    </form>
  );
}
