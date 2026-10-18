import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // In development, Vite sends /api to the server running locally, as nginx and the Ingress do in production
    proxy: { "/api": "http://localhost:8000" },
  },
});
