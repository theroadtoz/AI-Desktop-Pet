import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        pet: resolve(__dirname, "src/renderer/pet/index.html"),
        chat: resolve(__dirname, "src/renderer/chat/index.html")
      }
    }
  }
});
