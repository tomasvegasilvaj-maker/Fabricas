import type { Agente, TipoPaso } from '../motor/tipos';
import { activacion } from './activacion';
import { boceto } from './boceto';
import { conceptos } from './conceptos';
import { elaboracion } from './elaboracion';
import { imprenta } from './imprenta';
import { inspiracion } from './inspiracion';
import { intake } from './intake';
import { investigacion } from './investigacion';
import { revision } from './revision';

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
};

export { AGENTES_SIMULADOS } from './simulados';
