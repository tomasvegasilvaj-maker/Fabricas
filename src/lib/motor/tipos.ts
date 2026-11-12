import type { ContextoIA, Esfuerzo } from '../ia/claude';
import type { ComercioRow, Json, PasoRow, PedidoRow } from '../tipos-db';

export const TIPOS_PASO = [
  'intake',
  'investigacion',
  'inspiracion',
  'conceptos',
  'boceto',
  'elaboracion',
  'revision',
  'activacion',
  'imprenta',
  // Línea «equipo»: Pedrito orquesta y da el visto bueno entre etapas.
  'pedrito',
  'ideas',
  'diseno',
  'estructura',
  'produccion',
] as const;
export type TipoPaso = (typeof TIPOS_PASO)[number];

/** Los cuatro agentes del equipo de Pedrito (también son los dueños de las reglas aprendidas). */
export const AGENTES_EQUIPO = ['ideas', 'diseno', 'estructura', 'produccion'] as const;
export type AgenteEquipo = (typeof AGENTES_EQUIPO)[number];
export type Linea = 'clasica' | 'equipo';

/** Pasos que gastan IA: antes de correrlos se mira el tope de gasto del pedido. */
export const PASOS_CON_IA: readonly TipoPaso[] = [
  'investigacion',
  'inspiracion',
  'conceptos',
  'boceto',
  'elaboracion',
  'revision',
  'pedrito',
  'ideas',
  'diseno',
  'estructura',
];

/** Pedrito solo usa IA cuando mira las ideas o la imagen; el arranque y los vistos buenos de Estructura y Producción son fijos. */
const PEDRITO_CON_IA = ['ideas', 'diseno'];

/** Si el paso va a gastar IA (para frenar por tope solo esos y no la última revisión de Producción con el QR ya activo). */
export function gastaIA(tipo: TipoPaso, entrada: Json | null | undefined): boolean {
  if (!PASOS_CON_IA.includes(tipo)) return false;
  if (tipo !== 'pedrito') return true;
  const revisar = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? (entrada as Record<string, unknown>).revisar : undefined;
  return typeof revisar === 'string' && PEDRITO_CON_IA.includes(revisar);
}

export type TipoPrevia = 'elegir_concepto' | 'aprobar_final' | 'tope_gasto' | 'falta_dato' | 'fallo';
export type EstadoPedido = 'en_marcha' | 'en_espera' | 'pausado' | 'listo' | 'fallido' | 'cancelado';
export type Etapa =
  | 'intake'
  | 'investigacion'
  | 'inspiracion'
  | 'conceptos'
  | 'bocetos'
  | 'eleccion'
  | 'elaboracion'
  | 'revision'
  | 'aprobacion'
  | 'activacion'
  | 'imprenta'
  | 'ideas'
  | 'diseno'
  | 'estructura'
  | 'produccion'
  | 'listo';

export type Siguiente = { tipo: TipoPaso; entrada?: Json; max_intentos?: number };
export type PreviaNueva = { tipo: TipoPrevia; titulo: string; detalle?: string | null; datos?: Json };

export type ResultadoPaso = {
  salida: Json;
  /** Una línea para el registro del pedido. */
  resumen: string;
  siguientes?: Siguiente[];
  previa?: PreviaNueva;
  pedidoEstado?: EstadoPedido;
  pedidoEtapa?: Etapa;
  /** Para pasos en paralelo: lo que sigue se dispara recién cuando terminan todos los de estos tipos. */
  esperarTipos?: TipoPaso[];
};

export type ContextoPaso = {
  paso: PasoRow;
  pedido: PedidoRow;
  comercio: ComercioRow;
  ia: ContextoIA;
  /** Desde el segundo intento se baja el esfuerzo para que la respuesta entre en el tiempo. */
  esfuerzo(normal: Esfuerzo): Esfuerzo;
  registrar(mensaje: string, opciones?: { nivel?: 'info' | 'aviso' | 'error'; datos?: Json }): Promise<void>;
};

export type Agente = (ctx: ContextoPaso) => Promise<ResultadoPaso>;
