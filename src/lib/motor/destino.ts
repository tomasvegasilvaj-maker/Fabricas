import type { ComercioRow } from '../tipos-db';

/**
 * Normaliza un teléfono argentino al formato de wa.me (549 + 10 dígitos).
 * Acepta "+54 9 351 648-1342", "0351 15 648 1342", "3516481342", etc.
 */
export function whatsappArgentino(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  const internacional = telefono.trim().startsWith('+');
  let d = telefono.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  let nacional: string;
  if (d.startsWith('54')) {
    nacional = d.slice(2);
    if (nacional.startsWith('9')) nacional = nacional.slice(1);
    if (nacional.startsWith('0')) nacional = nacional.slice(1);
  } else if (internacional) {
    return d.length >= 8 && d.length <= 15 ? d : null;
  } else {
    nacional = d.startsWith('0') ? d.slice(1) : d;
  }
  if (nacional.length === 12) {
    // Saca el 15 de los celulares, que va después del código de área (2 a 4 dígitos).
    for (const k of [3, 4, 2]) {
      if (nacional.slice(k, k + 2) === '15') {
        nacional = nacional.slice(0, k) + nacional.slice(k + 2);
        break;
      }
    }
  }
  return nacional.length === 10 ? `549${nacional}` : null;
}

export function usuarioInstagram(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const v = valor.trim();
  const m = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(v);
  const usuario = (m ? m[1] : v.replace(/^@/, '')).replace(/\/$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(usuario) ? usuario : null;
}

export function linkResenaDesdePlaceId(placeId: string | null | undefined) {
  return placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : null;
}

function esUrl(v: string | null | undefined): v is string {
  return !!v && /^https?:\/\/\S+$/i.test(v.trim());
}

/** Link al que van a apuntar el QR y el NFC según el objetivo de la placa. */
export function destinoSugerido(
  objetivo: string,
  comercio: Pick<ComercioRow, 'link_resenas' | 'google_maps_url' | 'whatsapp' | 'instagram' | 'web'>,
  placeId?: string | null,
): { url: string | null; explicacion: string } {
  switch (objetivo) {
    case 'resenas': {
      if (esUrl(comercio.link_resenas)) return { url: comercio.link_resenas.trim(), explicacion: 'Link de reseñas del comercio.' };
      const desdePlace = linkResenaDesdePlaceId(placeId);
      if (desdePlace) return { url: desdePlace, explicacion: 'Abre directo la ventana para dejar reseña (armado con el place_id de Google).' };
      if (esUrl(comercio.google_maps_url)) return { url: comercio.google_maps_url.trim(), explicacion: 'Ficha de Google Maps (no se encontró el link directo de reseña).' };
      return { url: null, explicacion: 'Falta el link de reseñas de Google.' };
    }
    case 'turnos':
    case 'whatsapp': {
      const numero = whatsappArgentino(comercio.whatsapp);
      if (!numero) return { url: null, explicacion: 'Falta un WhatsApp válido.' };
      const texto = objetivo === 'turnos' ? '¡Hola! Quiero reservar un turno.' : '¡Hola! Te escribo desde la placa del local.';
      return { url: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, explicacion: `WhatsApp ${numero} con mensaje armado.` };
    }
    case 'instagram': {
      const usuario = usuarioInstagram(comercio.instagram);
      return usuario
        ? { url: `https://instagram.com/${usuario}`, explicacion: `Perfil @${usuario}.` }
        : { url: null, explicacion: 'Falta el Instagram del comercio.' };
    }
    default:
      return esUrl(comercio.web) ? { url: comercio.web.trim(), explicacion: 'Web del comercio.' } : { url: null, explicacion: 'Falta el link de destino.' };
  }
}
