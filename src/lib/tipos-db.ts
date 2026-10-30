// Tipos de las tablas fab_ (generados desde Supabase y recortados a lo que usa la fábrica).
// Si cambia el esquema: regenerar con `supabase gen types` o el MCP y volver a recortar.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Tabla<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type ComercioRow = {
  ciudad: string | null;
  created_at: string;
  direccion: string | null;
  google_maps_url: string | null;
  id: string;
  instagram: string | null;
  investigacion: Json | null;
  link_resenas: string | null;
  logo_info: Json | null;
  logo_path: string | null;
  nombre: string;
  rubro: string;
  updated_at: string;
  web: string | null;
  whatsapp: string | null;
};

export type PedidoRow = {
  auto_aprobar: boolean;
  comercio_id: string;
  concepto_id: string | null;
  created_at: string;
  destino_url: string | null;
  estado: string;
  etapa: string;
  fabrica: string;
  gasto_usd: number;
  id: string;
  ideas: string | null;
  numero: number;
  objetivo: string;
  qr_codigo: string | null;
  ronda: number;
  simulado: boolean;
  terminado_at: string | null;
  tope_usd: number;
  updated_at: string;
  version_final_id: string | null;
};

export type PasoRow = {
  costo_usd: number;
  created_at: string;
  disponible_desde: string;
  entrada: Json;
  error: string | null;
  estado: string;
  id: string;
  intento: number;
  max_intentos: number;
  pedido_id: string;
  salida: Json | null;
  terminado_at: string | null;
  tipo: string;
  tomado_at: string | null;
};

export type PreviaRow = {
  created_at: string;
  datos: Json;
  detalle: string | null;
  estado: string;
  id: string;
  pedido_id: string;
  respuesta: Json | null;
  resuelta_at: string | null;
  tipo: string;
  titulo: string;
};

export type ConceptoRow = {
  created_at: string;
  datos: Json;
  elegido: boolean;
  id: string;
  idea: string;
  indice: number;
  patron: string;
  pedido_id: string;
  tanda: number;
  titulo: string;
};

export type VersionRow = {
  chequeo: Json | null;
  concepto_id: string | null;
  created_at: string;
  id: string;
  notas: string | null;
  numero: number;
  origen: string;
  pedido_id: string;
  preview_path: string | null;
  revision: Json | null;
  svg: string;
};

export type InspiracionRow = {
  created_at: string;
  id: string;
  imagen_path: string | null;
  nota: string | null;
  patron: string | null;
  pedido_id: string;
  titulo: string;
  url_imagen: string | null;
  url_pagina: string | null;
};

export type ArchivoRow = {
  bytes: number | null;
  comercio_id: string | null;
  created_at: string;
  id: string;
  meta: Json;
  mime: string;
  nombre: string | null;
  path: string;
  pedido_id: string | null;
  tipo: string;
};

export type EventoRow = {
  created_at: string;
  datos: Json | null;
  id: number;
  mensaje: string;
  nivel: string;
  paso_id: string | null;
  pedido_id: string | null;
};

export type QrLoteRow = {
  asignado_at: string | null;
  codigo: string;
  comercio: string | null;
  estado: string;
  lote: string;
  n: number;
  pedido_id: string | null;
};

export type PreferenciaRow = {
  activo: boolean;
  created_at: string;
  id: string;
  origen: string;
  rubro: string | null;
  texto: string;
  tipo: string;
};

export type ConfigRow = {
  clave: string;
  updated_at: string;
  valor: string;
};

type Opcional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.18' };
  public: {
    Tables: {
      fab_comercios: Tabla<
        ComercioRow,
        Opcional<
          ComercioRow,
          | 'id' | 'created_at' | 'updated_at' | 'ciudad' | 'direccion' | 'google_maps_url' | 'instagram'
          | 'investigacion' | 'link_resenas' | 'logo_info' | 'logo_path' | 'web' | 'whatsapp'
        >
      >;
      fab_pedidos: Tabla<
        PedidoRow,
        Omit<
          Opcional<
            PedidoRow,
            | 'id' | 'created_at' | 'updated_at' | 'auto_aprobar' | 'concepto_id' | 'destino_url' | 'estado'
            | 'etapa' | 'fabrica' | 'gasto_usd' | 'ideas' | 'qr_codigo' | 'ronda' | 'simulado'
            | 'terminado_at' | 'tope_usd' | 'version_final_id'
          >,
          'numero'
        >,
        Partial<Omit<PedidoRow, 'numero'>>
      >;
      fab_pasos: Tabla<
        PasoRow,
        Opcional<
          PasoRow,
          | 'id' | 'created_at' | 'costo_usd' | 'disponible_desde' | 'entrada' | 'error' | 'estado' | 'intento'
          | 'max_intentos' | 'salida' | 'terminado_at' | 'tomado_at'
        >
      >;
      fab_previas: Tabla<
        PreviaRow,
        Opcional<PreviaRow, 'id' | 'created_at' | 'datos' | 'detalle' | 'estado' | 'respuesta' | 'resuelta_at'>
      >;
      fab_conceptos: Tabla<ConceptoRow, Opcional<ConceptoRow, 'id' | 'created_at' | 'datos' | 'elegido' | 'tanda'>>;
      fab_versiones: Tabla<
        VersionRow,
        Opcional<VersionRow, 'id' | 'created_at' | 'chequeo' | 'concepto_id' | 'notas' | 'preview_path' | 'revision'>
      >;
      fab_inspiracion: Tabla<
        InspiracionRow,
        Opcional<InspiracionRow, 'id' | 'created_at' | 'imagen_path' | 'nota' | 'patron' | 'url_imagen' | 'url_pagina'>
      >;
      fab_archivos: Tabla<
        ArchivoRow,
        Opcional<ArchivoRow, 'id' | 'created_at' | 'bytes' | 'comercio_id' | 'meta' | 'nombre' | 'pedido_id'>
      >;
      fab_eventos: Tabla<
        EventoRow,
        Omit<Opcional<EventoRow, 'created_at' | 'datos' | 'nivel' | 'paso_id' | 'pedido_id'>, 'id'>,
        Partial<Omit<EventoRow, 'id'>>
      >;
      fab_qr_lote: Tabla<QrLoteRow, Opcional<QrLoteRow, 'asignado_at' | 'comercio' | 'estado' | 'pedido_id'>>;
      fab_config: Tabla<ConfigRow, Opcional<ConfigRow, 'updated_at'>>;
      fab_preferencias: Tabla<
        PreferenciaRow,
        Opcional<PreferenciaRow, 'id' | 'created_at' | 'activo' | 'origen' | 'rubro' | 'tipo'>
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      fab_asignar_qr: {
        Args: { p_etiqueta: string; p_pedido: string; p_simular?: boolean; p_url: string };
        Returns: { codigo: string; lote: string; n: number }[];
      };
      fab_cerrar_paso: {
        Args: {
          p_error: string | null;
          p_esperar_tipos?: string[] | null;
          p_estado: string;
          p_intento: number;
          p_paso: string;
          p_pedido_estado?: string | null;
          p_pedido_etapa?: string | null;
          p_previa?: Json | null;
          p_salida: Json | null;
          p_siguientes?: Json;
        };
        Returns: boolean;
      };
      fab_fallo_generico: { Args: { p_error: string; p_paso: string }; Returns: undefined };
      fab_secreto_motor: { Args: Record<string, never>; Returns: string };
      fab_estado_latido: { Args: Record<string, never>; Returns: Json };
      fab_frenar_por_tope: { Args: { p_intento: number; p_paso: string }; Returns: boolean };
      fab_reprogramar_paso: {
        Args: { p_error: string; p_intento: number; p_paso: string; p_segundos: number };
        Returns: boolean;
      };
      fab_resolver_previa: {
        Args: {
          p_pedido_estado?: string | null;
          p_pedido_etapa?: string | null;
          p_previa: string;
          p_respuesta: Json;
          p_siguientes?: Json;
        };
        Returns: boolean;
      };
      fab_sumar_costo: { Args: { p_paso: string; p_pedido: string; p_usd: number }; Returns: number };
      fab_tomar_paso: { Args: { p_atasco_seg?: number }; Returns: PasoRow[] };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
