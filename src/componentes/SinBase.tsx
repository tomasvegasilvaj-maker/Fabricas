export function SinBase() {
  return (
    <div className="panel">
      <h2>Falta conectar la base de datos</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Cargá <span className="mono">SUPABASE_URL</span> y <span className="mono">SUPABASE_SERVICE_ROLE_KEY</span> en las variables de entorno del proyecto en Vercel y volvé a desplegar.
      </p>
    </div>
  );
}
