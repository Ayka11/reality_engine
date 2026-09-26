import fs from "node:fs";
import path from "node:path";

const required = [
  "package.json",
  "package-lock.json",
  "Dockerfile.hf",
  "README_HF.md",
  "index.html",
  "server/signalling-server.js",
];

for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) {
    throw new Error(`HF deployment file missing: ${file}`);
  }
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (!pkg.scripts?.build) throw new Error("package.json has no build script");
if (!fs.existsSync("dist")) throw new Error("dist/ is missing; run npm run build before packaging");

const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf8");
const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*src=)[^>]*>([\\s\\S]*?)<\\/script>/gi)].map((m) => m[1]).filter((code) => code.trim());
if (inlineScripts.length === 0) throw new Error("No inline scripts found for syntax validation");
for (const [index, code] of inlineScripts.entries()) {
  try {
    // Syntax-only validation; browser globals are intentionally not executed here.
    new Function(code);
  } catch (error) {
    throw new Error(`Inline script ${index + 1} has invalid JavaScript syntax: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(JSON.stringify({
  status: "READY",
  target: "huggingface-spaces-docker",
  port: 7860,
  buildOutput: "dist/",
  requiredFiles: required.length,
}));
