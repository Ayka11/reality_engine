import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(result.stdout || "{}");
} catch {
  console.error("Could not parse npm audit JSON output.");
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(0);
}

const vulnerabilities = Object.entries(report.vulnerabilities ?? {}).map(([name, item]) => ({
  name,
  severity: item.severity,
  range: item.range,
  fixAvailable: item.fixAvailable,
  advisories: (item.via ?? []).map((entry) => typeof entry === "string"
    ? { dependency: entry }
    : { title: entry.title, url: entry.url, range: entry.range, severity: entry.severity }),
}));
console.log(JSON.stringify({
  auditExitCode: result.status,
  totals: report.metadata?.vulnerabilities ?? null,
  vulnerabilities,
}, null, 2));
