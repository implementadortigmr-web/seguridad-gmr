import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    // Diagnostics are opt-in, not part of every production deployment.
    sourcemap: process.env.GMR_BUILD_DEBUG === "1",
    minify: true,
  },
});
