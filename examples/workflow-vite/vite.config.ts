import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { workflow } from "workflow/vite";

export default defineConfig({
  plugins: [nitro(), workflow()],
  nitro: {
    serverDir: "./",
    // Externalize native modules that can't be bundled
    rollupConfig: {
      external: [
        "@mongodb-js/zstd",
        "node-liblzma",
      ],
    },
  },
});
