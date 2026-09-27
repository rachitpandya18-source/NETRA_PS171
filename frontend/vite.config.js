import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

function copyNetraRuntimeAssets() {
  return {
    name: "copy-netra-runtime-assets",
    closeBundle() {
      const root = process.cwd();
      const outDir = path.resolve(root, "dist");
      const ortDist = path.resolve(root, "node_modules/onnxruntime-web/dist");
      const assetsDir = path.join(outDir, "assets");
      const modelSrc = path.join(root, "models", "NETRA_yolo11n_ui_detector.onnx");
      const modelDst = path.join(outDir, "models", "NETRA_yolo11n_ui_detector.onnx");

      fs.mkdirSync(assetsDir, { recursive: true });
      fs.mkdirSync(path.dirname(modelDst), { recursive: true });

      if (!fs.existsSync(ortDist)) {
        throw new Error(`onnxruntime-web dist directory not found: ${ortDist}`);
      }

      // ORT Web dynamically imports these files at runtime. Chrome extensions
      // need the exact, non-hashed filenames available under a stable URL.
      for (const file of fs.readdirSync(ortDist)) {
        if (/^ort-.*\.(mjs|wasm)$/.test(file)) {
          fs.copyFileSync(path.join(ortDist, file), path.join(assetsDir, file));
        }
      }

      if (!fs.existsSync(modelSrc)) {
        throw new Error(`NETRA ONNX model not found: ${modelSrc}`);
      }
      fs.copyFileSync(modelSrc, modelDst);
    }
  };
}

export default defineConfig({
  plugins: [copyNetraRuntimeAssets()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022"
  }
});
