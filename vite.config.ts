import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  css:{postcss:{plugins:[{postcssPlugin:'workspace-font-scale',Declaration(declaration:{prop:string;value:string}){if(declaration.prop==='font-size'&&/^\d+(?:\.\d+)?px$/.test(declaration.value))declaration.value=`calc(${declaration.value} * var(--font-scale, 1))`;}}]}},
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icons/app-icon-192.png', 'icons/app-icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.ico'],
    manifest: {
      name: 'Mr. Chicken House POS', short_name: 'Chicken House',
      description: 'Retail point of sale, stock and customer accounts',
      theme_color: '#061125', background_color: '#061125', display: 'standalone',
      lang: 'en', id: '/', scope: '/', start_url: '/',
      icons: [
        {src:'/icons/app-icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
        {src:'/icons/app-icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
        {src:'/icons/maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
      ],
    },
    workbox: {
      clientsClaim:true,
      // Keep the shell, feature chunks and bundled product photos available on a cold start.
      globPatterns:['**/*.{js,css,html}', 'images/grocery/*.jpg'], maximumFileSizeToCacheInBytes: 4_000_000,
      navigateFallbackDenylist:[/^\/api\//,/^\/coconut\.html$/], cleanupOutdatedCaches:true,
      runtimeCaching:[{
        urlPattern:({request,url})=>request.destination==='font' && url.origin===self.location.origin,
        handler:'CacheFirst',
        options:{cacheName:'chicken-pos-fonts-v1'},
      },{
        // Uploaded/private photos remain in the authorized workspace database.
        // External product links keep their first downloaded image for offline use.
        urlPattern:({request,url})=>request.destination==='image' && url.origin!==self.location.origin && !url.pathname.startsWith('/api/') &&
          (url.protocol==='https:' || (url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))),
        handler:'CacheFirst',
        options:{cacheName:'retail-pos-product-images-v1',cacheableResponse:{statuses:[0,200]}},
      }],
    },
  })],
  server: {host:'0.0.0.0',port:5173,proxy:{'/api':{target:'http://127.0.0.1:3001',changeOrigin:false}}},
  build: {rollupOptions:{input:{shop:'index.html',coconut:'coconut.html'}},outDir:'dist',sourcemap:false,chunkSizeWarningLimit:800},
});
