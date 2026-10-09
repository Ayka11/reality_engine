import fs from "node:fs";
import path from "node:path";
import { transformWithEsbuild } from "vite";

const required = [
  "package.json",
  "package-lock.json",
  "README.md",
  "index.html",
  "vite.config.ts",
  "Dockerfile.hf",
  "server/signalling-server.js",
  "dist/index.html",
];

for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) {
    throw new Error(`Docker HF deployment file missing: ${file}`);
  }
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (!pkg.scripts?.build) throw new Error("package.json has no build script");

const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
if (!/^sdk:\s*docker\s*$/m.test(readme)) {
  throw new Error("README.md must declare sdk: docker");
}

const dockerfile = fs.readFileSync(path.resolve("Dockerfile.hf"), "utf8");
for (const [label, pattern] of [
  ["build command", /RUN\s+npm\s+run\s+build/],
  ["port 7860", /EXPOSE\s+7860/],
  ["frontend server", /serve\s+dist\s+-l\s+7860|hf-server\.js/],
  ["signalling server", /server\/signalling-server\.js/],
]) {
  if (!pattern.test(dockerfile)) {
    throw new Error(`Dockerfile.hf is missing expected ${label} configuration`);
  }
}

const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");
if (indexHtml.includes("server/signalling-server.js")) {
  throw new Error("The frontend must not load the internal signalling server as a script");
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
      sourcefile: `index.html:inline-script-${index + 1}`,
    });
  } catch (error) {
    throw new Error(
      `Inline script ${index + 1} has invalid JavaScript syntax: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

console.log(JSON.stringify({
  status: "READY",
  target: "huggingface-spaces-docker",
  dockerfile: "Dockerfile.hf",
  appFile: "dist/index.html",
  buildCommand: "npm run build",
  frontendPort: 7860,
  signallingServer: "server/signalling-server.js",
  inlineScriptsChecked: inlineScripts.length,
}));
