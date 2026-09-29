import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => {
  const editor = fileURLToPath(new URL("./.local/StudioControls.tsx", import.meta.url));
  const localControls = command === "serve" && !isPreview && existsSync(editor);
  return {
    base: "/",
    plugins: [react()],
    define: { __LOCAL_CONTROLS__: JSON.stringify(localControls) },
    resolve: {
      alias: {
        "@local-controls": localControls ? editor : fileURLToPath(new URL("./src/studio/LocalControls.tsx", import.meta.url)),
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
