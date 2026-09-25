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

console.log(JSON.stringify({
  status: "READY",
  target: "huggingface-spaces-docker",
  port: 7860,
  buildOutput: "dist/",
  requiredFiles: required.length,
}));
