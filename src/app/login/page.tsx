import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { haySesion } from '@/lib/auth';
import { FormLogin } from './FormLogin';

export const metadata: Metadata = { title: 'Entrar' };

export default async function Login({ searchParams }: { searchParams: Promise<{ volver?: string }> }) {
  if (await haySesion()) redirect('/');
  const { volver } = await searchParams;
  return (
    <main className="login">
      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <div>
          <h1>Fábrica de Placas</h1>
          <p className="muted small">NFC + QR para comercios</p>
        </div>
        <FormLogin volver={typeof volver === 'string' ? volver : ''} />
      </div>
    </main>
  );
}
