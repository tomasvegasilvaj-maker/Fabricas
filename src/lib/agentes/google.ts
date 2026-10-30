// Google Places API (New). Opcional: si no hay GOOGLE_PLACES_API_KEY, la investigación usa solo la web.

export type LugarGoogle = {
  placeId: string;
  nombre: string;
  direccion: string | null;
  puntaje: number | null;
  cantidadResenas: number | null;
  mapsUrl: string | null;
  web: string | null;
  telefono: string | null;
  tipo: string | null;
  resumen: string | null;
  resenas: { puntaje: number | null; texto: string }[];
  fotos: string[];
};

type RespuestaPlaces = {
  places?: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
    websiteUri?: string;
    internationalPhoneNumber?: string;
    nationalPhoneNumber?: string;
    primaryTypeDisplayName?: { text?: string };
    editorialSummary?: { text?: string };
    reviews?: { rating?: number; text?: { text?: string }; originalText?: { text?: string } }[];
    photos?: { name: string }[];
  }[];
};

const CAMPOS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.websiteUri',
  'places.internationalPhoneNumber',
  'places.nationalPhoneNumber',
  'places.primaryTypeDisplayName',
  'places.editorialSummary',
  'places.reviews',
  'places.photos',
].join(',');

export async function buscarLugar(consulta: string, clave: string): Promise<LugarGoogle | null> {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': clave, 'X-Goog-FieldMask': CAMPOS },
    body: JSON.stringify({ textQuery: consulta, languageCode: 'es', regionCode: 'ar', pageSize: 1 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Google Places respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const lugar = ((await r.json()) as RespuestaPlaces).places?.[0];
  if (!lugar) return null;
  return {
    placeId: lugar.id,
    nombre: lugar.displayName?.text ?? '',
    direccion: lugar.formattedAddress ?? null,
    puntaje: lugar.rating ?? null,
    cantidadResenas: lugar.userRatingCount ?? null,
    mapsUrl: lugar.googleMapsUri ?? null,
    web: lugar.websiteUri ?? null,
    telefono: lugar.internationalPhoneNumber ?? lugar.nationalPhoneNumber ?? null,
    tipo: lugar.primaryTypeDisplayName?.text ?? null,
    resumen: lugar.editorialSummary?.text ?? null,
    resenas: (lugar.reviews ?? [])
      .map((x) => ({ puntaje: x.rating ?? null, texto: (x.originalText?.text ?? x.text?.text ?? '').slice(0, 600) }))
      .filter((x) => x.texto),
    fotos: (lugar.photos ?? []).map((f) => f.name).slice(0, 6),
  };
}

export async function bajarFotoLugar(nombreFoto: string, clave: string, anchoMax = 1000): Promise<Buffer | null> {
  const r = await fetch(`https://places.googleapis.com/v1/${nombreFoto}/media?maxWidthPx=${anchoMax}&key=${encodeURIComponent(clave)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return null;
  return Buffer.from(await r.arrayBuffer());
}
