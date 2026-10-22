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

function previewStartupDiagnostics(): Plugin {
  return {
    name: 'preview-startup-diagnostics',
    apply: 'serve',
    configureServer(server) {
      const endpoint = `${basePath!.replace(/\/$/, '')}/__pixl-preview-startup`;
      let reportCount = 0;
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== endpoint) return next();
        if (request.method !== 'POST') {
          response.writeHead(405).end();
          return;
        }
        let body = '';
        request.on('data', (chunk) => {
          body += chunk.toString();
          if (body.length > 2048) request.destroy();
        });
        request.on('end', () => {
          try {
            const report = JSON.parse(body);
            if (!['html', 'app'].includes(report.phase)
              || !['iOS', 'other'].includes(report.browser)
              || typeof report.detail !== 'string') {
              response.writeHead(400).end();
              return;
            }
            if (reportCount++ < 100) {
              const detail = report.detail
                .replace(/https?:\/\/[^\s"'<>]+/g, '[module URL]')
                .replace(/[\r\n\x00-\x1f]/g, ' ')
                .slice(0, 240);
              server.config.logger.warn(`[Pixl preview startup] ${JSON.stringify({
                phase: report.phase, browser: report.browser, detail,
              })}`);
            }
            response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
          } catch {
            response.writeHead(400).end();
          }
        });
      });
    },
  };
}

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
  const requiredCoreEntries = [
    'index.html',
    'src/features/supporter-dashboard.tsx',
    'src/features/stat-tracker-page.tsx',
  ];
  const additionalCoreEntries = [
    'src/features/game-on-inline-stat-tracker.tsx',
    'src/features/game-on-inline-prep-checklist.tsx',
    'src/features/game-on-dashboard-collection.tsx',
    'src/features/supporter-stat-trends.tsx',
  ];
  const additionalCoreEntryNames = [
    'hype-card-preview',
  ];
  const maxPrecacheBytes = 12 * 1024 * 1024;

  type ManifestEntry = {
    file: string;
    imports?: string[];
    dynamicImports?: string[];
    css?: string[];
    assets?: string[];
  };

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
      const manifestPath = path.join(outputDirectory, '.vite/manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, ManifestEntry>;
      const coreFiles = new Set<string>();
      const visitedEntries = new Set<string>();
      const appBootstrapEntries = new Set(manifest['index.html']?.dynamicImports ?? []);

      function includeEntry(entryId: string, required: boolean) {
        const entry = manifest[entryId];
        if (!entry) {
          if (required) {
            throw new Error(`Required offline entry is missing from the Vite manifest: ${entryId}`);
          }
          return;
        }
        if (visitedEntries.has(entryId)) return;
        visitedEntries.add(entryId);

        coreFiles.add(entry.file);
        for (const asset of entry.css ?? []) {
          coreFiles.add(asset);
        }
        for (const asset of entry.assets ?? []) {
          // The app bootstrap also references landing-page artwork. Keep the
          // shell and core-tool assets, but leave that optional media on demand.
          if (
            !appBootstrapEntries.has(entryId)
            || !/\.(?:mp4|png|jpe?g|webp)$/i.test(asset)
          ) {
            coreFiles.add(asset);
          }
        }
        for (const importedEntry of entry.imports ?? []) {
          includeEntry(importedEntry, true);
        }
      }

      for (const entryId of requiredCoreEntries) includeEntry(entryId, true);
      for (const entryId of manifest['index.html'].dynamicImports ?? []) {
        includeEntry(entryId, true);
      }
      for (const entryId of additionalCoreEntries) includeEntry(entryId, false);
      for (const entryName of additionalCoreEntryNames) {
        const match = Object.entries(manifest).find(([, entry]) => (
          path.basename(entry.file).startsWith(`${entryName}-`)
        ));
        if (match) includeEntry(match[0], false);
      }

      const allFiles = (await listFiles(outputDirectory))
        .filter((file) => file !== 'sw.js' && file !== '.vite/manifest.json');
      const rootFiles = allFiles.filter((file) => !file.includes('/'));
      const precacheSet = new Set([
        ...rootFiles,
        ...coreFiles,
        'assets/upcoming-event-card.png',
        'assets/upcoming-event-card-enlarged.png',
        'assets/upcoming-event-card-finished.png',
      ]);
      const availableFiles = new Set(allFiles);
      const files = [...precacheSet]
        .filter((file) => availableFiles.has(file) && !/\.wasm$/i.test(file) && !/\.mp4$/i.test(file))
        .filter((file) => (
          !/\.(?:png|jpe?g|webp)$/i.test(file)
          || coreFiles.has(file)
          || /^pwa-icon-\d+\.png$/i.test(path.basename(file))
          || file.startsWith('assets/upcoming-event-card')
        ))
        .sort();
      const totalBytes = (await Promise.all(
        files.map(async (file) => (await fs.stat(path.join(outputDirectory, file))).size),
      )).reduce((total, size) => total + size, 0);

      if (totalBytes > maxPrecacheBytes) {
        throw new Error(
          `Offline core precache is ${totalBytes} bytes, exceeding the ${maxPrecacheBytes}-byte budget.`,
        );
      }

      console.info(
        `[offline-shell-precache] ${files.length} files, ${totalBytes} bytes (${(totalBytes / 1024 / 1024).toFixed(2)} MiB).`,
      );
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
    previewStartupDiagnostics(),
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
    manifest: true,
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
