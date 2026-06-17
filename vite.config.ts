import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  publicDir: resolve(__dirname, "public"),
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        pet: "pet/index.html",
        chat: "chat/index.html"
      }
    }
  }
});
