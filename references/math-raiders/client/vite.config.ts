import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import browserEcho from '@browser-echo/vite'

import { playcademy } from '@playcademy/vite-plugin'

// https://vitejs.dev/config/
export default defineConfig({
    esbuild: {
        drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
    plugins: [
        react(), 
        tailwindcss(),
        browserEcho({
            // Shows browser console logs in terminal
            enabled: true,
            tag: '[browser]',
            include: ['log', 'info', 'warn', 'error', 'debug'],
            preserveConsole: true, // Also keep logging in browser
            stackMode: 'condensed', // Show stack traces but condensed
        }),
        playcademy({
            sandbox: {
                autoStart: true,
                verbose: false,
            },
            export: {
                autoZip: true,
            },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    base: './',
})
