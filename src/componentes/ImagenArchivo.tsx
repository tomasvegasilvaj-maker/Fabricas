/** Imagen guardada en el almacenamiento privado (se sirve a través de la app, con sesión). */
export function ImagenArchivo({ path, alt, className }: { path: string | null | undefined; alt: string; className?: string }) {
  if (!path) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/archivos/${path}`} alt={alt} className={className} loading="lazy" />;
}

export function urlArchivo(path: string, descargar = false) {
  return `/api/archivos/${path}${descargar ? '?descargar=1' : ''}`;
}
