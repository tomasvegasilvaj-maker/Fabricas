'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { haySesion } from '@/lib/auth';
import { correrMotor } from '@/lib/motor/motor';
import { crearPedido, type ArchivoSubido } from '@/lib/motor/pedidos';
import {
  aprobarFinal,
  cancelarPedido,
  completarDestino,
  completarLogo,
  elegirConcepto,
  pausarPedido,
  pedirCambios,
  reanudarPedido,
  reintentarFallo,
  rehacerConceptos,
  seguirConTope,
  seguirSinBoceto,
} from '@/lib/motor/previas';
import { COOKIE_SESION, crearSesion, DURACION_SESION_SEG, mismaClave, secretoSesion } from '@/lib/sesion';
import { db } from '@/lib/supabase';

export type EstadoAccion = { error?: string; ok?: string } | null;

function texto(fd: FormData, campo: string) {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

async function archivo(fd: FormData, campo: string): Promise<ArchivoSubido | null> {
  const f = fd.get(campo);
  if (!f || typeof f === 'string' || f.size === 0) return null;
  return { datos: Buffer.from(await f.arrayBuffer()), mime: f.type || 'application/octet-stream', nombre: f.name };
}

function mensaje(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Despierta al motor en esta misma función, después de responder. */
function despertarMotor() {
  after(async () => {
    try {
      await correrMotor();
    } catch (e) {
      console.error('Motor:', e);
    }
  });
}

async function exigirSesion() {
  if (!(await haySesion())) throw new Error('La sesión venció: volvé a entrar.');
}

export async function entrar(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const clave = process.env.APP_PASSWORD;
  const secreto = await secretoSesion();
  if (!clave || !secreto) return { error: 'Falta configurar APP_PASSWORD y SUPABASE_SERVICE_ROLE_KEY en Vercel.' };
  if (!(await mismaClave(texto(fd, 'clave'), clave))) {
    await new Promise((r) => setTimeout(r, 700));
    return { error: 'Clave incorrecta.' };
  }
  (await cookies()).set(COOKIE_SESION, await crearSesion(secreto), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DURACION_SESION_SEG,
  });
  const volver = texto(fd, 'volver');
  redirect(volver.startsWith('/') && !volver.startsWith('//') ? volver : '/');
}

export async function salir() {
  (await cookies()).delete(COOKIE_SESION);
  redirect('/login');
}

export async function nuevoPedido(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  let id: string;
  try {
    await exigirSesion();
    const simulado = fd.get('simulado') === 'on';
    const logo = await archivo(fd, 'logo');
    if (!logo && !simulado && !texto(fd, 'comercio_id')) return { error: 'Subí el logo del comercio (PNG, JPG, SVG o WebP).' };
    const pedido = await crearPedido({
      comercioId: texto(fd, 'comercio_id') || null,
      comercio: {
        nombre: texto(fd, 'nombre'),
        rubro: texto(fd, 'rubro'),
        ciudad: texto(fd, 'ciudad'),
        direccion: texto(fd, 'direccion'),
        instagram: texto(fd, 'instagram'),
        google_maps_url: texto(fd, 'google_maps_url'),
        whatsapp: texto(fd, 'whatsapp'),
        web: texto(fd, 'web'),
        link_resenas: texto(fd, 'link_resenas'),
      },
      logo,
      objetivo: texto(fd, 'objetivo'),
      destinoUrl: texto(fd, 'destino_url'),
      ideas: texto(fd, 'ideas'),
      simulado,
      autoAprobar: fd.get('auto_aprobar') === 'on',
    });
    id = pedido.id;
  } catch (e) {
    return { error: mensaje(e) };
  }
  despertarMotor();
  revalidatePath('/', 'layout');
  redirect(`/pedidos/${id}`);
}

/** Todas las respuestas a Previas pasan por acá. */
export async function responderPrevia(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const previaId = texto(fd, 'previa_id');
  const accion = texto(fd, 'accion');
  const recordar = fd.get('recordar') === 'on';
  let ok = false;
  let aviso = 'Listo.';
  try {
    await exigirSesion();
    switch (accion) {
      case 'elegir':
        ok = await elegirConcepto(previaId, { conceptoId: texto(fd, 'concepto_id'), comentario: texto(fd, 'comentario'), recordar });
        aviso = 'Idea elegida: la fábrica sigue con la elaboración y la revisión.';
        break;
      case 'rehacer':
        ok = await rehacerConceptos(previaId, { comentario: texto(fd, 'comentario'), recordar });
        aviso = 'Se piden tres ideas nuevas.';
        break;
      case 'aprobar':
        ok = await aprobarFinal(previaId, { destino: texto(fd, 'destino') });
        aviso = 'Aprobada: se activa el QR y se arman los archivos para imprimir.';
        break;
      case 'cambios':
        ok = await pedirCambios(previaId, { comentario: texto(fd, 'comentario'), recordar });
        aviso = 'Cambios pedidos: vuelve a elaboración.';
        break;
      case 'seguir_tope':
        ok = await seguirConTope(previaId);
        aviso = 'Tope subido: la fábrica sigue.';
        break;
      case 'reintentar':
        ok = await reintentarFallo(previaId);
        aviso = 'Se reintenta el paso.';
        break;
      case 'seguir_sin_boceto':
        ok = await seguirSinBoceto(previaId);
        aviso = 'Se sigue con los bocetos que salieron.';
        break;
      case 'logo': {
        const logo = await archivo(fd, 'logo');
        if (!logo) return { error: 'Elegí el archivo del logo.' };
        ok = await completarLogo(previaId, logo);
        aviso = 'Logo cargado: arranca de nuevo la recepción.';
        break;
      }
      case 'destino':
        ok = await completarDestino(previaId, texto(fd, 'destino'));
        aviso = 'Link cargado: se activa el QR.';
        break;
      case 'cancelar': {
        const { data } = await db().from('fab_previas').select('pedido_id').eq('id', previaId).single();
        if (data) await cancelarPedido(data.pedido_id);
        ok = true;
        aviso = 'Pedido cancelado.';
        break;
      }
      default:
        return { error: 'Acción desconocida.' };
    }
  } catch (e) {
    return { error: mensaje(e) };
  }
  if (!ok) return { error: 'Esta Previa ya estaba resuelta (¿doble clic?).' };
  despertarMotor();
  revalidatePath('/', 'layout');
  return { ok: aviso };
}

export async function accionPedido(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const pedidoId = texto(fd, 'pedido_id');
  try {
    await exigirSesion();
    switch (texto(fd, 'accion')) {
      case 'pausar':
        await pausarPedido(pedidoId);
        break;
      case 'reanudar':
        await reanudarPedido(pedidoId);
        break;
      case 'cancelar':
        await cancelarPedido(pedidoId);
        break;
      case 'despertar':
        break;
      default:
        return { error: 'Acción desconocida.' };
    }
  } catch (e) {
    return { error: mensaje(e) };
  }
  despertarMotor();
  revalidatePath('/', 'layout');
  return { ok: 'Hecho.' };
}

export async function guardarPreferencia(_: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    await exigirSesion();
    const accion = texto(fd, 'accion');
    if (accion === 'nueva') {
      const textoPref = texto(fd, 'texto');
      const tipo = texto(fd, 'tipo');
      if (!textoPref) return { error: 'Escribí la preferencia.' };
      if (!['regla', 'gusto', 'evitar'].includes(tipo)) return { error: 'Tipo inválido.' };
      const { error } = await db().from('fab_preferencias').insert({ texto: textoPref.slice(0, 600), tipo, rubro: texto(fd, 'rubro') || null, origen: 'ajustes' });
      if (error) return { error: error.message };
    } else if (accion === 'activar' || accion === 'desactivar') {
      const { error } = await db().from('fab_preferencias').update({ activo: accion === 'activar' }).eq('id', texto(fd, 'id'));
      if (error) return { error: error.message };
    } else {
      return { error: 'Acción desconocida.' };
    }
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath('/ajustes');
  return { ok: 'Guardado.' };
}
