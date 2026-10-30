import { describe, expect, it } from 'vitest';
import { destinoSugerido, usuarioInstagram, whatsappArgentino } from '@/lib/motor/destino';

describe('whatsappArgentino', () => {
  it('normaliza los formatos comunes', () => {
    expect(whatsappArgentino('+54 9 3516 48-1342')).toBe('5493516481342');
    expect(whatsappArgentino('0351 15 648 1342')).toBe('5493516481342');
    expect(whatsappArgentino('351 648 1342')).toBe('5493516481342');
    expect(whatsappArgentino('11 15 2345 6789')).toBe('5491123456789');
    expect(whatsappArgentino('03543 15 12 3456')).toBe('5493543123456');
    expect(whatsappArgentino('+54 351 648 1342')).toBe('5493516481342');
    expect(whatsappArgentino('+34 612 34 56 78')).toBe('34612345678');
    expect(whatsappArgentino('1234')).toBeNull();
    expect(whatsappArgentino(null)).toBeNull();
  });
});

describe('destinoSugerido', () => {
  const base = { link_resenas: null, google_maps_url: null, whatsapp: null, instagram: null, web: null };
  it('reseñas: prioriza el link directo, después el place_id, después Maps', () => {
    expect(destinoSugerido('resenas', { ...base, link_resenas: 'https://g.page/r/abc/review' }).url).toBe('https://g.page/r/abc/review');
    expect(destinoSugerido('resenas', base, 'ChIJ123').url).toBe('https://search.google.com/local/writereview?placeid=ChIJ123');
    expect(destinoSugerido('resenas', { ...base, google_maps_url: 'https://maps.app.goo.gl/x' }).url).toBe('https://maps.app.goo.gl/x');
    expect(destinoSugerido('resenas', base).url).toBeNull();
  });
  it('turnos arma el wa.me con mensaje', () => {
    const r = destinoSugerido('turnos', { ...base, whatsapp: '+54 9 3516 48-1342' });
    expect(r.url).toBe(`https://wa.me/5493516481342?text=${encodeURIComponent('¡Hola! Quiero reservar un turno.')}`);
  });
  it('instagram acepta @usuario o URL', () => {
    expect(usuarioInstagram('@esplendida.sentite')).toBe('esplendida.sentite');
    expect(usuarioInstagram('https://www.instagram.com/esplendida.sentite/')).toBe('esplendida.sentite');
    expect(destinoSugerido('instagram', { ...base, instagram: 'instagram.com/esplendida.sentite' }).url).toBe('https://instagram.com/esplendida.sentite');
  });
});
