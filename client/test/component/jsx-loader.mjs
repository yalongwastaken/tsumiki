// jsx-loader.mjs — node module-customization hook that transpiles .jsx on import
// via esbuild, so component tests can run under `node --test` (esbuild is already
// a devDependency). Registered by register.mjs via --import.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".jsx")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const { code } = await transform(source, {
      loader: "jsx",
      jsx: "automatic",
      format: "esm",
      sourcefile: fileURLToPath(url),
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
