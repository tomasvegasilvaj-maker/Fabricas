import type { Metadata } from 'next';
import { nuevoPedido } from '@/app/acciones';
import { BotonEnviar } from '@/componentes/BotonEnviar';
import { FormAccion } from '@/componentes/FormAccion';
import { OBJETIVOS } from '@/lib/motor/flujo';

export const metadata: Metadata = { title: 'Nuevo pedido' };
// Al crear el pedido, el motor arranca en la misma función.
export const maxDuration = 300;

export default function NuevoPedido() {
  return (
    <section className="section">
      <div>
        <h2>Nuevo pedido de placa</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Con el nombre, el rubro y el logo alcanza: el resto lo busca la investigación. Lo que sepas de antemano (Instagram, Maps, WhatsApp) ayuda a que acierte.
        </p>
      </div>
      <div className="panel">
        <FormAccion accion={nuevoPedido} className="grid">
          <div className="campos">
            <label className="campo">
              Nombre del comercio *
              <input type="text" name="nombre" required maxLength={120} placeholder="Cortes con Historia" />
            </label>
            <label className="campo">
              Rubro *
              <input type="text" name="rubro" required maxLength={120} placeholder="Barbería" />
            </label>
            <label className="campo">
              Ciudad
              <input type="text" name="ciudad" defaultValue="La Calera" maxLength={120} />
            </label>
            <label className="campo">
              Dirección
              <input type="text" name="direccion" maxLength={300} />
            </label>
            <label className="campo">
              Instagram
              <input type="text" name="instagram" placeholder="@usuario o link" maxLength={300} />
            </label>
            <label className="campo">
              Google Maps
              <input type="url" name="google_maps_url" placeholder="https://maps.app.goo.gl/..." maxLength={1000} />
            </label>
            <label className="campo">
              WhatsApp
              <input type="tel" name="whatsapp" placeholder="+54 9 351 ..." maxLength={60} />
            </label>
            <label className="campo">
              Web
              <input type="url" name="web" placeholder="https://..." maxLength={1000} />
            </label>
            <label className="campo">
              Link para dejar reseña <small>Si ya lo tenés (g.page/r/…/review)</small>
              <input type="url" name="link_resenas" maxLength={1000} />
            </label>
          </div>
          <div className="campos">
            <label className="campo">
              Objetivo de la placa *
              <select name="objetivo" defaultValue="resenas" required>
                {Object.entries(OBJETIVOS).map(([id, o]) => (
                  <option key={id} value={id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              Link de destino <small>Opcional: si no, se arma solo según el objetivo</small>
              <input type="url" name="destino_url" placeholder="https://..." maxLength={2000} />
            </label>
            <label className="campo">
              Logo * <small>PNG, JPG, SVG o WebP, hasta 4 MB. Mejor con fondo transparente.</small>
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/avif" />
            </label>
          </div>
          <label className="campo">
            Ideas para esta placa <small>Opcional: lo que se te ocurra (ej.: «que el NFC sea una tijera abierta», «colores del local»)</small>
            <textarea name="ideas" rows={3} maxLength={3000} />
          </label>
          <details>
            <summary>Prueba sin IA</summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <label className="check">
                <input type="checkbox" name="simulado" />
                <span>Pedido de prueba: recorre todo el circuito con ideas y bocetos de mentira. No gasta IA y no activa ningún QR.</span>
              </label>
              <label className="check">
                <input type="checkbox" name="auto_aprobar" />
                <span>Que elija y apruebe solo (para probar de punta a punta sin tocar nada).</span>
              </label>
            </div>
          </details>
          <div className="acts">
            <BotonEnviar clase="btn accent" pendiente="Creando…">
              Crear pedido y arrancar
            </BotonEnviar>
          </div>
        </FormAccion>
      </div>
    </section>
  );
}
