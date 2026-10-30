'use client';

import { useFormStatus } from 'react-dom';

/** Botón de formulario que se deshabilita mientras la acción corre (evita dobles clics). */
export function BotonEnviar({ children, clase = 'btn', pendiente = 'Enviando…', name, value }: {
  children: React.ReactNode;
  clase?: string;
  pendiente?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={clase} disabled={pending} name={name} value={value}>
      {pending ? pendiente : children}
    </button>
  );
}
