import path from 'node:path';
import baseConfig from './vite.config';

export default {
  ...baseConfig,
  resolve: {
    ...baseConfig.resolve,
    alias: [
      {
        find: /^@clerk\/react$/,
        replacement: path.resolve(import.meta.dirname, 'src/features/account-lifecycle-browser-auth.tsx'),
      },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      { find: '@assets', replacement: path.resolve(import.meta.dirname, '../../attached_assets') },
    ],
  },
};