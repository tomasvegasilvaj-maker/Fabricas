// Lo compartido por el equipo de Pedrito: las reglas que cada agente aprende de sus correcciones,
// el prompt de imagen de cada rubro y cómo viajan los resultados entre pasos.
import type { AgenteEquipo, ContextoPaso } from '../../motor/tipos';
import { db, revisar } from '../../supabase';
import type { Json, PasoRow } from '../../tipos-db';

export const NOMBRE_AGENTE: Record<AgenteEquipo, string> = {
  ideas: 'Ideas',
  diseno: 'Diseño',
  estructura: 'Estructura',
  produccion: 'Producción',
};

/** Rondas máximas por etapa antes de que Pedrito tenga que dar el visto bueno igual (y avisarte lo pendiente). */
export const MAX_RONDAS = { ideas: 2, diseno: 3 } as const;

/** Lo que Pedrito le devuelve a un agente: qué arreglar ahora y la regla de una línea para siempre. */
export type Correccion = { texto: string; regla: string; solo_rubro?: boolean };

export function leerCorreccion(valor: unknown): Correccion | null {
  if (!valor || typeof valor !== 'object') return null;
  const c = valor as Record<string, unknown>;
  const texto = typeof c.texto === 'string' ? c.texto.trim() : '';
  const regla = typeof c.regla === 'string' ? reglaDeUnaLinea(c.regla) : '';
  if (!texto && !regla) return null;
  return { texto, regla, solo_rubro: c.solo_rubro === true };
}

/** Una regla es una sola línea corta: sin saltos, sin viñetas y sin espacios de más. */
export function reglaDeUnaLinea(texto: string) {
  return texto
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\s*[-*•\d.)]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function sinTildes(t: string) {
  return t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

/** El rubro de la regla aplica si uno contiene al otro («barbería» aplica a «barbería y peluquería»). */
export function aplicaAlRubro(rubroRegla: string | null, rubro: string | null) {
  if (!rubroRegla) return true;
  const a = sinTildes(rubroRegla);
  const b = sinTildes(rubro ?? '');
  return !!b && (a.includes(b) || b.includes(a));
}

/**
 * Antes de cada trabajo: si Pedrito mandó una corrección, el agente guarda su regla; después relee
 * todas sus reglas (las generales y las de este rubro) para tenerlas en cuenta.
 */
export async function reglasDelAgente(ctx: ContextoPaso, agente: AgenteEquipo, correccion: Correccion | null): Promise<string[]> {
  const { pedido, comercio } = ctx;
  if (correccion?.regla) {
    const { error } = await db()
      .from('fab_reglas_agente')
      .insert({
        agente,
        texto: correccion.regla,
        rubro: correccion.solo_rubro ? comercio.rubro : null,
        pedido_id: pedido.id,
        prueba: pedido.simulado,
      });
    if (error && error.code !== '23505') throw new Error(`No se pudo guardar la regla de ${NOMBRE_AGENTE[agente]}: ${error.message}`);
    await ctx.registrar(
      error ? `${NOMBRE_AGENTE[agente]} ya tenía esta regla: «${correccion.regla}».` : `${NOMBRE_AGENTE[agente]} guardó la regla: «${correccion.regla}».`,
    );
  }
  let q = db().from('fab_reglas_agente').select('texto, rubro').eq('agente', agente).eq('activo', true).order('created_at');
  if (!pedido.simulado) q = q.eq('prueba', false);
  const filas = revisar(await q, 'leer reglas del agente');
  const reglas = filas.filter((f) => aplicaAlRubro(f.rubro, comercio.rubro)).map((f) => f.texto);
  await ctx.registrar(`${NOMBRE_AGENTE[agente]} repasó sus ${reglas.length} regla${reglas.length === 1 ? '' : 's'} antes de empezar.`, {
    datos: { reglas },
  });
  return reglas;
}

export function textoReglas(reglas: string[]) {
  if (reglas.length === 0) return '';
  return `## Tus reglas (las aprendiste de las correcciones de Pedrito: cumplilas todas)\n${reglas.map((r) => `- ${r}`).join('\n')}`;
}

export function textoCorreccion(c: Correccion | null) {
  if (!c?.texto) return '';
  return `## Corrección de Pedrito sobre tu entrega anterior (arreglá esto primero)\n${c.texto}`;
}

/** El prompt de imagen que funcionó para el rubro (o la base «*»), con sus marcadores reemplazados. */
export async function promptDelRubro(rubro: string): Promise<{ rubro: string; plantilla: string }> {
  const filas = revisar(await db().from('fab_prompts_rubro').select('rubro, prompt').eq('activo', true), 'leer prompts por rubro');
  const r = sinTildes(rubro);
  const exacto = filas.find((f) => sinTildes(f.rubro) === r);
  const parecido = filas.filter((f) => f.rubro !== '*').find((f) => aplicaAlRubro(f.rubro, rubro));
  const base = filas.find((f) => f.rubro === '*');
  const elegido = exacto ?? parecido ?? base;
  if (!elegido) throw new Error('No hay prompt de imagen para este rubro ni prompt base («*») en fab_prompts_rubro.');
  return { rubro: elegido.rubro, plantilla: elegido.prompt };
}

export function completarPrompt(plantilla: string, valores: Record<string, string>) {
  return plantilla.replace(/\{(\w+)\}/g, (todo, clave: string) => (clave in valores ? valores[clave] : todo));
}

/** Paso ya hecho de otro agente (Pedrito lo lee para revisar su resultado y pasarlo al siguiente). */
export async function leerPaso(id: string): Promise<PasoRow> {
  return revisar(await db().from('fab_pasos').select('*').eq('id', id).single(), 'leer paso a revisar');
}

export function objeto(valor: Json | null | undefined): Record<string, unknown> {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}
