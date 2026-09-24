import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: path.resolve("desktop/ui"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve("src") } },
  build: { outDir: path.resolve("desktop/dist-ui"), emptyOutDir: true },
});
