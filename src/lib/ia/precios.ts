import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export const MODELO = 'claude-opus-5-5';

type Precio = { entrada: number; salida: number; cache5m: number; cache1h: number; cacheLectura: number };

// US$ por millón de tokens.
const PRECIOS: Record<string, Precio> = {
  'claude-opus-5-5': { entrada: 4, salida: 20, cache5m: 5, cache1h: 8, cacheLectura: 0.2 },
};

// Si la respuesta vino de otro modelo (fallback por rechazo), se cuenta caro para no quedarnos cortos.
const CONSERVADOR: Precio = { entrada: 5, salida: 25, cache5m: 6.25, cache1h: 10, cacheLectura: 0.5 };

export const USD_POR_BUSQUEDA_WEB = 10 / 1000;

type Uso = Pick<BetaUsage, 'input_tokens' | 'output_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens'> & {
  cache_creation?: BetaUsage['cache_creation'];
  server_tool_use?: BetaUsage['server_tool_use'];
};

export function costoUsd(modelo: string, uso: Uso): number {
  const p = PRECIOS[modelo] ?? CONSERVADOR;
  const cache1h = uso.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cache5m = uso.cache_creation?.ephemeral_5m_input_tokens ?? Math.max((uso.cache_creation_input_tokens ?? 0) - cache1h, 0);
  const tokens =
    (uso.input_tokens ?? 0) * p.entrada +
    (uso.output_tokens ?? 0) * p.salida +
    cache5m * p.cache5m +
    cache1h * p.cache1h +
    (uso.cache_read_input_tokens ?? 0) * p.cacheLectura;
  const busquedas = (uso.server_tool_use?.web_search_requests ?? 0) * USD_POR_BUSQUEDA_WEB;
  return tokens / 1_000_000 + busquedas;
}

/** Estimación cuando una llamada se corta antes de terminar (no llega el uso real). */
export function costoEstimadoCorte(tokensEntrada: number, caracteresSalida: number, segundos: number) {
  // Lo que se ve en el stream no incluye el razonamiento: se completa con el tiempo transcurrido.
  const salida = Math.max(caracteresSalida / 3.5, segundos * 60);
  return (tokensEntrada * CONSERVADOR.entrada + salida * CONSERVADOR.salida) / 1_000_000;
}
