/** Mini fábrica isométrica del mapa (con humo cuando está trabajando). */
export function Edificio({ color, trabajando }: { color: string; trabajando: boolean }) {
  const techo = `color-mix(in srgb,${color} 55%,#fff)`;
  const lado = `color-mix(in srgb,${color} 70%,#000)`;
  return (
    <div className="bld">
      {trabajando && (
        <>
          <span className="smoke" />
          <span className="smoke" />
        </>
      )}
      <svg viewBox="0 0 64 60" aria-hidden="true">
        <ellipse cx="32" cy="52" rx="24" ry="5" fill="#000" fillOpacity=".08" />
        <rect x="40" y="6" width="6" height="14" fill={lado} />
        <rect x="40" y="4" width="6" height="3" fill={techo} />
        <path d="M8 22L32 10L56 22L32 34Z" fill={techo} />
        <path d="M8 22L32 34V54L8 42Z" fill={color} />
        <path d="M56 22L32 34V54L56 42Z" fill={lado} />
        <path d="M16 31l10 5v8l-10-5z" fill="#fff" fillOpacity=".85" />
        <path d="M38 38l5-2.5M38 43l5-2.5M46 34l5-2.5M46 39l5-2.5" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
      </svg>
    </div>
  );
}
