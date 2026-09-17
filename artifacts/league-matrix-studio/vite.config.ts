import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;
const dashboardHeroSizeBudget = 80 * 1024;

function dashboardHeroAssetGuard(): Plugin {
  return {
    name: 'dashboard-hero-asset-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const heroAssets = Object.values(bundle).filter(
        (output) =>
          output.type === 'asset' &&
          /^assets\/hero-banner-[\w-]+\.webp$/.test(output.fileName),
      );

      if (heroAssets.length !== 1) {
        const emittedMatches = Object.values(bundle)
          .filter(
            (output) =>
              output.type === 'asset' &&
              output.fileName.includes('hero-banner'),
          )
          .map((output) => output.fileName);

        throw new Error(
          [
            'Dashboard hero asset check failed: expected exactly one hashed WebP asset.',
            emittedMatches.length > 0
              ? `Found: ${emittedMatches.join(', ')}`
              : 'No emitted hero-banner asset was found.',
          ].join(' '),
        );
      }

      const [heroAsset] = heroAssets;
      const emittedBytes =
        typeof heroAsset.source === 'string'
          ? Buffer.byteLength(heroAsset.source)
          : heroAsset.source.byteLength;

      if (emittedBytes > dashboardHeroSizeBudget) {
        throw new Error(
          `Dashboard hero asset check failed: ${heroAsset.fileName} is ${emittedBytes} bytes; the budget is ${dashboardHeroSizeBudget} bytes.`,
        );
      }
    },
  };
}

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    dashboardHeroAssetGuard(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
