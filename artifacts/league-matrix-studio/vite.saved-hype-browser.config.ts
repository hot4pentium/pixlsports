import baseConfig from './vite.account-lifecycle-browser.config';

// Test-only proxy: exercises image URLs and generated clients without modifying
// production routing or intercepting/reconstructing owner API responses.
if (!process.env.SAVED_HYPE_BROWSER_API) throw new Error('Saved HYPE fixture API is required.');

export default {
  ...baseConfig,
  server: {
    ...baseConfig.server,
    proxy: {
      '/api': process.env.SAVED_HYPE_BROWSER_API,
      '/__fixture': process.env.SAVED_HYPE_BROWSER_API,
    },
  },
};