import { bajarArchivo, db, revisar } from '../supabase';
import type { ComercioRow, Json, PedidoRow, VersionRow } from '../tipos-db';
import type { InfoLogo } from '../placa/logo';
import { OBJETIVOS } from '../motor/flujo';

export const SISTEMA_FABRICA = `Trabajás en una fábrica de placas NFC + QR para comercios de barrio de Córdoba, Argentina (La Calera y alrededores). Cada placa mide 10 × 15 cm (vertical), se apoya en el mostrador o se pega en la pared. Detrás de un círculo dibujado va pegado un tag NFC, y en un cuadrado blanco se pega un QR autoadhesivo. Al acercar el celular al círculo o escanear el QR, el cliente hace una sola cosa: dejar una reseña, pedir un turno, escribir por WhatsApp, etc. El que aprueba todo es Tomi, que imprime y arma las placas.`;

export type LogoGuardado = InfoLogo & { path: string; vista_path: string };

export function infoLogo(comercio: ComercioRow): LogoGuardado | null {
  const i = comercio.logo_info as LogoGuardado | null;
  return i && typeof i === 'object' && 'path' in i ? i : null;
}

export async function logoDelComercio(comercio: ComercioRow) {
  const info = infoLogo(comercio);
  if (!info) throw new Error('El comercio no tiene el logo preparado (falta pasar por la recepción).');
  const [png, vista] = await Promise.all([bajarArchivo(info.path), bajarArchivo(info.vista_path)]);
  return { info, png, vista };
}

export function textoLogo(info: InfoLogo) {
  const fondo = info.transparente
    ? 'tiene fondo transparente: se puede apoyar sobre un color liso de la placa con buen contraste'
    : info.fondo
      ? `NO es transparente: tiene fondo ${info.fondo}. Detrás del logo-slot tiene que haber un panel o zona de ese mismo color (${info.fondo}), con aire alrededor, para que no se vea el recorte`
      : 'NO es transparente y su fondo no es parejo: ponelo sobre un panel claro con aire alrededor, como si fuera una etiqueta';
  return `Logo: proporción ancho/alto = ${info.proporcion}. Colores del logo: ${info.colores.join(', ') || 'sin datos'}. El logo ${fondo}.`;
}

export function fichaComercio(comercio: ComercioRow, pedido: PedidoRow) {
  const objetivo = OBJETIVOS[pedido.objetivo] ?? OBJETIVOS.otro;
  const lineas = [
    `Comercio: ${comercio.nombre}`,
    `Rubro: ${comercio.rubro}`,
    comercio.ciudad && `Ciudad: ${comercio.ciudad}`,
    comercio.direccion && `Dirección: ${comercio.direccion}`,
    comercio.instagram && `Instagram: ${comercio.instagram}`,
    comercio.google_maps_url && `Google Maps: ${comercio.google_maps_url}`,
    comercio.web && `Web: ${comercio.web}`,
    `Objetivo de la placa: ${objetivo.nombre} (el cliente va a ${objetivo.accion}).`,
    pedido.ideas && `Ideas y pedidos de Tomi para esta placa: ${pedido.ideas}`,
  ];
  return lineas.filter(Boolean).join('\n');
}

/** Lo que tiene que pedir la placa según el objetivo, con las reglas de cada caso. */
export function textoObjetivo(objetivo: string) {
  switch (objetivo) {
    case 'resenas':
      return 'La placa invita a dejar una reseña en Google. Nunca pidas puntaje ni «5 estrellas» (lo prohíbe Google): pedí la opinión o la experiencia. Las estrellas pueden aparecer solo como dibujo. Un pin rojo genérico puede indicar Google Maps, sin logos de Google.';
    case 'turnos':
      return 'La placa invita a pedir o reservar un turno por WhatsApp. Usá un globito de chat genérico, nunca el logo de WhatsApp.';
    case 'whatsapp':
      return 'La placa invita a escribir por WhatsApp (consultas, pedidos). Usá un globito de chat genérico, nunca el logo de WhatsApp.';
    case 'instagram':
      return 'La placa invita a seguir al comercio en Instagram. Usá una cámara genérica, nunca el logo de Instagram.';
    case 'carta':
      return 'La placa invita a ver la carta o el menú desde el celular.';
    case 'links':
      return 'La placa lleva a la página con todos los links del comercio (turnos, redes, ubicación).';
    default:
      return 'La placa lleva al link del comercio.';
  }
}

type Preferencia = { texto: string; tipo: string; rubro: string | null };

/** Reglas, gustos y cosas a evitar que fue juntando Tomi (las del rubro primero). */
export async function textoPreferencias(rubro: string | null) {
  const filas = revisar(await db().from('fab_preferencias').select('texto, tipo, rubro').eq('activo', true).order('created_at'), 'leer preferencias') as Preferencia[];
  const r = (rubro ?? '').toLowerCase();
  const aplican = filas.filter((p) => !p.rubro || (r && (r.includes(p.rubro.toLowerCase()) || p.rubro.toLowerCase().includes(r))));
  const grupo = (tipo: string) => aplican.filter((p) => p.tipo === tipo).map((p) => `- ${p.texto}${p.rubro ? ` (para ${p.rubro})` : ''}`);
  const partes: string[] = [];
  const reglas = grupo('regla');
  const gustos = grupo('gusto');
  const evitar = grupo('evitar');
  if (reglas.length) partes.push(`## Reglas de la fábrica (obligatorias)\n${reglas.join('\n')}`);
  if (gustos.length) partes.push(`## Gustos de Tomi (aprendidos de placas anteriores)\n${gustos.join('\n')}`);
  if (evitar.length) partes.push(`## Evitar\n${evitar.join('\n')}`);
  return partes.join('\n\n');
}

/** Resumen corto de la investigación para darle contexto a los demás agentes. */
export function textoInvestigacion(inv: Json | null) {
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) return 'Sin investigación previa.';
  const i = inv as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) && v.length ? v.map(String).join('; ') : null);
  const lineas = [
    i.resumen && `Resumen: ${i.resumen}`,
    i.estilo_visual && `Estilo visual actual: ${i.estilo_visual}`,
    lista(i.colores_marca) && `Colores de marca: ${lista(i.colores_marca)}`,
    i.tono && `Tono con el que habla: ${i.tono}`,
    i.publico && `Público: ${i.publico}`,
    lista(i.destacados) && `Productos o servicios estrella: ${lista(i.destacados)}`,
    lista(i.diferenciales) && `Lo que lo hace distinto: ${lista(i.diferenciales)}`,
    lista(i.frases_clientes) && `Lo que dicen los clientes: ${lista(i.frases_clientes)}`,
    lista(i.objetos_del_rubro) && `Objetos del rubro que podrían ser el círculo NFC: ${lista(i.objetos_del_rubro)}`,
  ];
  return lineas.filter(Boolean).join('\n') || 'La investigación no encontró datos útiles.';
}

export async function leerVersion(id: string): Promise<VersionRow> {
  return revisar(await db().from('fab_versiones').select('*').eq('id', id).single(), 'leer versión');
}

export async function proximoNumeroVersion(pedidoId: string) {
  const { data } = await db().from('fab_versiones').select('numero').eq('pedido_id', pedidoId).order('numero', { ascending: false }).limit(1).maybeSingle();
  return (data?.numero ?? 0) + 1;
}

export function entrada<T extends Record<string, unknown>>(valor: Json): Partial<T> {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Partial<T>) : {};
}
