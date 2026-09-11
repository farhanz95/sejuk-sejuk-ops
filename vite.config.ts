import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Makes the portal installable on a phone (its own icon, no browser chrome)
    // and work offline — a technician in a riser room or a lift lobby often has
    // no signal, and the job sheet they are filling in should not disappear.
    VitePWA({
      registerType: 'autoUpdate',
      // Keep the existing filename so the manifest link in index.html and any
      // cache keyed on it stay valid.
      manifestFilename: 'site.webmanifest',
      includeAssets: [
        'favicon.ico',
        'favicon-16.png',
        'favicon-32.png',
        'favicon-48.png',
        'apple-touch-icon.png',
        'logo.svg',
        'logo-small.svg',
        'og-image.png',
      ],
      manifest: {
        id: '/',
        name: 'Sejuk Sejuk Service — Operations Portal',
        short_name: 'Sejuk Sejuk',
        description:
          'Air-conditioner service operations: order intake, technician field jobs, WhatsApp notifications, KPI dashboard and an AI operations query window.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        background_color: '#f1f5f9',
        theme_color: '#1c6489',
        categories: ['business', 'productivity'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // maskable: Android crops to its own shape, so the snowflake must sit
          // inside the safe zone (it does — see brand/og-image.html).
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // The AI endpoints must never be answered from the cache.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
});
