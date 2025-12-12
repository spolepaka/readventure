import { defineConfig } from "vite";
import { playcademy } from "@playcademy/vite-plugin";

export default defineConfig({
  plugins: [playcademy()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        game: "game.html",
      },
    },
  },
});
