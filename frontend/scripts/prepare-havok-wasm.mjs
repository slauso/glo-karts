import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendRoot = resolve(__dirname, "..");

const sourceWasmPath = resolve(
  frontendRoot,
  "node_modules",
  "@babylonjs",
  "havok",
  "lib",
  "esm",
  "HavokPhysics.wasm"
);

const targetDir = resolve(frontendRoot, "public", "havok");
const targetWasmPath = resolve(targetDir, "HavokPhysics.wasm");

if (!existsSync(sourceWasmPath)) {
  throw new Error(`Havok wasm source not found at: ${sourceWasmPath}`);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(sourceWasmPath, targetWasmPath);

console.log(`[prepare-havok-wasm] Copied to ${targetWasmPath}`);
