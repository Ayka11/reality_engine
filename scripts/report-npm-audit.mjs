import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  timeout: 120_000,
});

if (result.error) {
  console.error(`Could not run npm audit: ${result.error.message}`);
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || "");
} catch {
  console.error("Could not parse npm audit JSON output; failing closed.");
  if (result.stdout) console.error(result.stdout.trim().slice(0, 4000));
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const totals = report?.metadata?.vulnerabilities;
if (
  !totals ||
  !Number.isSafeInteger(totals.total) ||
  totals.total < 0 ||
  !report.vulnerabilities ||
  typeof report.vulnerabilities !== "object" ||
  Array.isArray(report.vulnerabilities)
) {
  console.error("npm audit returned an incomplete or unexpected JSON report; failing closed.");
  console.error(JSON.stringify({
    auditExitCode: result.status,
    error: report?.error ?? null,
    hasMetadata: Boolean(report?.metadata),
    hasVulnerabilitiesMap: Boolean(report?.vulnerabilities),
  }, null, 2));
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const vulnerabilities = Object.entries(report.vulnerabilities).map(([name, item]) => ({
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
  totals,
  vulnerabilities,
}, null, 2));

if (result.status !== 0 || totals.total !== 0) {
  console.error(
    `Dependency security gate failed: npm audit exit=${String(result.status)}, vulnerabilities=${totals.total}.`,
  );
  process.exit(1);
}
