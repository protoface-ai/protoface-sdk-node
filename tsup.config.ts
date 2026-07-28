import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    conversation: "src/conversation.ts",
    react: "src/react.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react"]
});
