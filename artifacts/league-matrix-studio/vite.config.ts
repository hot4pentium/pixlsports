import path from 'path';
import fs from 'node:fs/promises';
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

function offlineShellPrecache(): Plugin {
  const outputDirectory = path.resolve(import.meta.dirname, 'dist/public');
  const placeholder = '__PIXL_PRECACHE_MANIFEST__';

  async function listFiles(directory: string, prefix = ''): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? listFiles(path.join(directory, entry.name), relativePath)
        : [relativePath];
    }));
    return files.flat();
  }

  return {
    name: 'offline-shell-precache',
    apply: 'build',
    async closeBundle() {
      const workerPath = path.join(outputDirectory, 'sw.js');
      const worker = await fs.readFile(workerPath, 'utf8');
      if (!worker.includes(placeholder)) {
        throw new Error('Offline service worker precache placeholder was not found.');
      }
      const files = (await listFiles(outputDirectory))
        .filter((file) => file !== 'sw.js')
        // Keep the installed shell fast to install. Optional marketing media and
        // sample video are still available online and are cached when requested.
        // The four Hype Card template backgrounds are the exception: they are
        // part of the offline editor experience after the user picks a layout.
        .filter((file) => (
          !/\.(?:mp4|png|jpe?g|webp)$/i.test(file)
          || /(?:^|\/)pwa-icon-\d+\.png$/i.test(file)
          || /(?:^|\/)(?:stadium-entrance|sunset-stadium|locker-room-walkout|split-light-arena)-[^/]+\.webp$/i.test(file)
        ))
        .sort();
      await fs.writeFile(
        workerPath,
        worker.replace(placeholder, JSON.stringify(files)),
      );
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
    offlineShellPrecache(),
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
  // Prebundle the lazy worker dependency before the first upload. Otherwise
  // Vite's first-use optimizer reload can interrupt background removal.
  optimizeDeps: { include: ['@huggingface/transformers'] },
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
