import fs from "node:fs";
import path from "node:path";

const required = [
  "index.html",
  "package.json",
  "package-lock.json",
  "Dockerfile.hf",
  "server/signalling-server.js",
  "server/hf-server.js",
  "dist/index.html",
];

for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) {
    throw new Error(`Missing Docker CPU build input: ${file}`);
  }
}

const index = fs.readFileSync("index.html", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const readme = fs.readFileSync("README.md", "utf8");
const dockerfile = fs.readFileSync("Dockerfile.hf", "utf8");

if (!pkg.scripts?.build) throw new Error("Missing build script");
if (!/^sdk:\s*docker\s*$/m.test(readme)) {
  throw new Error("README.md must declare sdk: docker");
}
if (index.includes("server/signalling-server.js")) {
  throw new Error("Frontend must not load the internal signalling server as a script");
}
if (!dockerfile.includes("EXPOSE 7860") || !(dockerfile.includes("hf-server.js") || dockerfile.includes("serve dist -l 7860"))) {
  throw new Error("Docker HF runtime must serve frontend and signalling on port 7860");
}

console.log(JSON.stringify({
  status: "READY",
  target: "huggingface-spaces-docker",
  cpuMode: true,
  appFile: "dist/index.html",
  staticAssetsPresent: true,
  frontendPort: 7860,
  signallingServer: "server/signalling-server.js",
}));
