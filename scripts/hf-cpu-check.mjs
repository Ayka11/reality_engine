import fs from "node:fs";
import path from "node:path";

const required = ["index.html", "package.json", "package-lock.json", "dist/index.html"];

for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) {
    throw new Error(`Missing CPU build input: ${file}`);
  }
}

const index = fs.readFileSync("index.html", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

if (!pkg.scripts?.build) throw new Error("Missing build script");
if (index.includes("server/signalling-server.js")) {
  throw new Error("Static CPU build must not require the internal signalling server");
}

console.log(JSON.stringify({
  status: "READY",
  target: "huggingface-spaces-static",
  cpuMode: true,
  appFile: "dist/index.html",
  staticAssetsPresent: true,
  runtimeServer: "none",
}));
