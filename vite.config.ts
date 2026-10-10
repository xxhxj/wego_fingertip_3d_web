import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["occt-wasm"],
  },
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
});
