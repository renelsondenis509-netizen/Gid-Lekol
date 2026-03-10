import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    host: "0.0.0.0",   // Obligatoire sur Replit — expose le serveur
    port: 5173,
    strictPort: true,
  },

  preview: {
    host: "0.0.0.0",
    port: 5173,
  },

  build: {
    outDir: "dist",
    // Optimisation pour mobile (APK Capacitor)
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
        },
      },
    },
  },
});
