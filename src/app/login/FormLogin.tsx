'use client';

import { useActionState } from 'react';
import { entrar } from '../acciones';

export function FormLogin({ volver }: { volver: string }) {
  const [estado, enviar, pendiente] = useActionState(entrar, null);
  return (
    <form action={enviar} style={{ display: 'grid', gap: 12 }}>
      <input type="hidden" name="volver" value={volver} />
      <label className="campo">
        Clave
        <input type="password" name="clave" autoComplete="current-password" required autoFocus />
      </label>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
      <button type="submit" className="btn accent" disabled={pendiente}>
        {pendiente ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
