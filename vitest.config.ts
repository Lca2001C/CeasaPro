import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["dotenv/config"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // integração usa o mesmo banco — roda arquivos em série
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
