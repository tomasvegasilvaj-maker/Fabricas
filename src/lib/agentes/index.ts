import type { Agente, TipoPaso } from '../motor/tipos';
import { activacion } from './activacion';
import { boceto } from './boceto';
import { conceptos } from './conceptos';
import { elaboracion } from './elaboracion';
import { disenoEquipo } from './equipo/diseno';
import { estructuraEquipo } from './equipo/estructura';
import { ideasEquipo } from './equipo/ideas';
import { pedrito } from './equipo/pedrito';
import { produccionEquipo } from './equipo/produccion';
import { AGENTES_EQUIPO_SIMULADOS } from './equipo/simulados';
import { imprenta } from './imprenta';
import { inspiracion } from './inspiracion';
import { intake } from './intake';
import { investigacion } from './investigacion';
import { revision } from './revision';
import { AGENTES_SIMULADOS as SIMULADOS_CLASICOS } from './simulados';

export const AGENTES: Record<TipoPaso, Agente> = {
  intake,
  investigacion,
  inspiracion,
  conceptos,
  boceto,
  elaboracion,
  revision,
  activacion,
  imprenta,
  // Línea «equipo»
  pedrito,
  ideas: ideasEquipo,
  diseno: disenoEquipo,
  estructura: estructuraEquipo,
  produccion: produccionEquipo,
};

/** En pedidos de prueba se usan estos en lugar de los reales (los que no están, como Producción, corren igual). */
export const AGENTES_SIMULADOS: Partial<Record<TipoPaso, Agente>> = { ...SIMULADOS_CLASICOS, ...AGENTES_EQUIPO_SIMULADOS };
