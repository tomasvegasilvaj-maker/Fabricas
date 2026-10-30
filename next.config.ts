import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // resvg trae un binario nativo: se carga con require de Node, sin empaquetar.
  serverExternalPackages: ['@resvg/resvg-js'],
  // Las tipografías y el QR de muestra se leen del disco al dibujar las placas.
  outputFileTracingIncludes: {
    '/*': ['./fuentes/**/*.ttf', './assets/**/*'],
  },
  experimental: {
    serverActions: { bodySizeLimit: '4.5mb' },
  },
};

export default nextConfig;
