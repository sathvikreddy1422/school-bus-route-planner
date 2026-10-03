import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    loader: "jsx",
    include: /(\.jsx|main\.js)$/,
    exclude: [],
  },
});