import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { workflow } from "workflow/vite";

export default defineConfig({
  plugins: [nitro(), workflow()],
  nitro: {
    serverDir: "./",
  },
});
