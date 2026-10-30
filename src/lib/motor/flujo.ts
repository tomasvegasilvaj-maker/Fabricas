import type { Etapa, TipoPaso } from './tipos';

export const ETAPAS: { id: Etapa; nombre: string; detalle: string; tuya?: boolean }[] = [
  { id: 'intake', nombre: 'Recepción', detalle: 'Datos del comercio y logo' },
  { id: 'investigacion', nombre: 'Investigación', detalle: 'Google Maps, Instagram y web' },
  { id: 'inspiracion', nombre: 'Inspiración', detalle: 'Referencias del rubro' },
  { id: 'conceptos', nombre: 'Ideas', detalle: 'Tres ideas con el NFC protagonista' },
  { id: 'bocetos', nombre: 'Bocetos', detalle: 'Un boceto por idea' },
  { id: 'eleccion', nombre: 'Elegís la idea', detalle: 'Previa: te toca a vos', tuya: true },
  { id: 'elaboracion', nombre: 'Elaboración', detalle: 'Se termina la placa elegida' },
  { id: 'revision', nombre: 'Revisión', detalle: 'Control de calidad con criterios' },
  { id: 'aprobacion', nombre: 'Aprobás', detalle: 'Previa: te toca a vos', tuya: true },
  { id: 'activacion', nombre: 'Activación', detalle: 'QR del lote apuntando al link' },
  { id: 'imprenta', nombre: 'Imprenta', detalle: 'PDF con sangrado, A4 y guía de armado' },
];

export function indiceEtapa(etapa: string) {
  if (etapa === 'listo') return ETAPAS.length;
  const i = ETAPAS.findIndex((e) => e.id === etapa);
  return i === -1 ? 0 : i;
}

export function nombreEtapa(etapa: string) {
  if (etapa === 'listo') return 'Lista para imprimir';
  return ETAPAS.find((e) => e.id === etapa)?.nombre ?? etapa;
}

export const NOMBRE_PASO: Record<TipoPaso, string> = {
  intake: 'Recepción y logo',
  investigacion: 'Investigación del comercio',
  inspiracion: 'Búsqueda de inspiración',
  conceptos: 'Ideas de placa',
  boceto: 'Boceto',
  elaboracion: 'Elaboración',
  revision: 'Revisión de calidad',
  activacion: 'Activación del QR',
  imprenta: 'Archivos de imprenta',
};

export const NOMBRE_ESTADO: Record<string, string> = {
  en_marcha: 'En marcha',
  en_espera: 'En espera',
  pausado: 'Pausada',
  listo: 'Lista',
  fallido: 'Falló',
  cancelado: 'Cancelada',
};

export const OBJETIVOS: Record<string, { nombre: string; accion: string }> = {
  resenas: { nombre: 'Reseñas en Google', accion: 'dejar una reseña en Google Maps' },
  turnos: { nombre: 'Turnos por WhatsApp', accion: 'pedir un turno por WhatsApp' },
  whatsapp: { nombre: 'WhatsApp', accion: 'escribir por WhatsApp' },
  links: { nombre: 'Página de links', accion: 'abrir la página con todos los links del comercio' },
  carta: { nombre: 'Carta / menú', accion: 'ver la carta o el menú' },
  instagram: { nombre: 'Instagram', accion: 'seguir al comercio en Instagram' },
  otro: { nombre: 'Otro', accion: 'abrir el link del comercio' },
};

export const QR_BASE = 'https://qr-pasoapaso.vercel.app';
export const urlQr = (codigo: string) => `${QR_BASE}/q/${codigo}`;
