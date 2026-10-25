import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("npm audit gate regression: SKIP (the command shim in this test targets the Linux CI runner).");
  process.exit(0);
}

const auditScript = fileURLToPath(new URL("./report-npm-audit.mjs", import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "npm-audit-gate-"));
const fakeNpm = join(tempDir, "npm");
writeFileSync(
  fakeNpm,
  '#!/bin/sh\\nprintf "%s" "$MOCK_AUDIT_OUTPUT"\\nexit "\${MOCK_AUDIT_EXIT:-0}"\\n',
  "utf8",
);
chmodSync(fakeNpm, 0o755);

const cleanReport = {
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  vulnerabilities: {},
};
const vulnerableReport = {
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  vulnerabilities: {
    "demo-vuln": {
      severity: "high",
      range: "<1.0.1",
      fixAvailable: true,
      via: [{
        title: "Synthetic test advisory",
        url: "https://example.invalid/advisory",
        range: "<1.0.1",
        severity: "high",
      }],
    },
  },
};

function runCase(name, output, npmExitCode, expectedExitCode, expectedText) {
  const result = spawnSync(process.execPath, [auditScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: tempDir + delimiter + (process.env.PATH ?? ""),
      MOCK_AUDIT_OUTPUT: output,
      MOCK_AUDIT_EXIT: String(npmExitCode),
    },
  });
  assert.equal(
    result.status,
    expectedExitCode,
    name + ": expected exit " + expectedExitCode + ", got " + result.status + "; stderr=" + result.stderr,
  );
  if (expectedText) {
    const combined = (result.stdout ?? "") + "\n" + (result.stderr ?? "");
    assert.ok(combined.includes(expectedText), name + ": expected output to contain " + expectedText);
  }
  console.log(name + ": PASS");
}

try {
  runCase("zero vulnerabilities", JSON.stringify(cleanReport), 0, 0);
  runCase("vulnerabilities present", JSON.stringify(vulnerableReport), 1, 1, "demo-vuln");
  runCase("malformed JSON", "not-json", 0, 1, "failing closed");
  runCase(
    "missing audit metadata",
    JSON.stringify({ error: { code: "ENOAUDIT", summary: "synthetic registry error" } }),
    0,
    1,
    "incomplete or unexpected",
  );
  runCase("audit command nonzero", JSON.stringify(cleanReport), 2, 1, "Dependency security gate failed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
