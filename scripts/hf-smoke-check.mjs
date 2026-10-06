import fs from "node:fs";
import path from "node:path";
import { transformWithEsbuild } from "vite";

const required = [
  "package.json",
  "package-lock.json",
  "README.md",
  "index.html",
  "vite.config.ts",
  "dist/index.html",
];

for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) {
    throw new Error(`Static HF deployment file missing: ${file}`);
  }
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (!pkg.scripts?.build) throw new Error("package.json has no build script");

const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
if (!/^sdk:\s*static\s*$/m.test(readme)) throw new Error("README.md must declare sdk: static");
if (!/^app_file:\s*dist\/index\.html\s*$/m.test(readme)) throw new Error("README.md must declare app_file: dist/index.html");
if (!/^app_build_command:\s*npm run build\s*$/m.test(readme)) throw new Error("README.md must declare app_build_command: npm run build");

const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");
if (indexHtml.includes("server/signalling-server.js")) {
  throw new Error("Static Space must not require the internal signalling server");
}

const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1])
  .filter((code) => code.trim());

if (inlineScripts.length === 0) throw new Error("No inline scripts found for syntax validation");

for (const [index, code] of inlineScripts.entries()) {
  try {
    await transformWithEsbuild(code, `inline-script-${index + 1}.js`, {
      loader: "js",
      target: "esnext",
      format: "iife",
    });
  } catch (error) {
    throw new Error(
      `Inline script ${index + 1} has invalid JavaScript syntax: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

console.log(JSON.stringify({
  status: "READY",
  target: "huggingface-spaces-static",
  appFile: "dist/index.html",
  buildCommand: "npm run build",
  runtimeServer: "none",
  inlineScriptsChecked: inlineScripts.length,
}));
