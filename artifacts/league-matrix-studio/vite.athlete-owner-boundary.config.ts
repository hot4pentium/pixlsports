import baseConfig from './vite.config';

export default {
  ...baseConfig,
  plugins: [
    ...(baseConfig.plugins ?? []),
    {
      name: 'athlete-owner-boundary-test-auth',
      enforce: 'pre' as const,
      transform(source: string, id: string) {
        if (!id.endsWith('/src/features/athlete-invite.tsx')) return;
        const original = "import { useUser } from '@clerk/react';";
        if (!source.includes(original)) throw new Error('The owner test could not find the account hook');
        return source.replace(original, "import { useUser } from './athlete-owner-boundary-auth-test';");
      },
    },
  ],
};