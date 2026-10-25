import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import ts from "typescript";

// getMutableBuffer() exposes raw typed-array memory for hot paths. Keep this
// inventory exact: newly added call sites must have an explicit ownership and
// async-boundary review rather than silently expanding the escape hatch.
const expectedCalls = new Map([
  ["src/core/SparseVoxelGrid.ts#syncDenseEntityOwnershipToChunks", 1],
  ["src/core/SparseVoxelGrid.ts#syncDenseToChunks", 1],
  ["src/core/SparseVoxelGrid.ts#syncChunksToDense", 1],
  ["src/core/SparseVoxelGrid.ts#loadChunks", 2],
  ["src/core/SparseVoxelGrid.ts#syncBackBuffersFromFront", 2],
  ["src/chemistry/ChemLayer.ts#commitPendingDensityTransfers", 1],
  ["src/chemistry/ChemLayer.ts#tickRegion", 1],
  ["src/simulation/AgentSystem.ts#seed", 1],
  ["src/simulation/AgentSystem.ts#tick", 1],
  ["src/simulation/EntityLayer.ts#tick", 1],
  ["src/simulation/EntityLayer.ts#_reconcileFullDomain", 1],
  ["src/simulation/EntityLayer.ts#_spawnChild", 1],
  ["src/simulation/EntropyLayer.ts#tick", 1],
  ["src/simulation/FieldPhysics.ts#tick", 2],
  ["src/simulation/InfoPhysics.ts#tick", 1],
  ["src/simulation/TemporalLayer.ts#tick", 1],
  ["src/simulation/TemporalLayer.ts#_diffuseTime", 1],
  ["src/simulation/SimulationEngine.ts#initGPU", 1],
  ["src/simulation/SimulationEngine.ts#_stepInternal", 1],
  ["src/simulation/SimulationEngine.ts#resynchronizeGPUAndThrow", 1],
  ["src/simulation/SimulationEngine.ts#mutateAuthoritativeState", 1],
  ["src/simulation/SimulationEngine.ts#syncToGPU", 1],
  ["src/simulation/SimulationEngine.ts#syncTick", 1],
  ["src/simulation/SimulationEngine.ts#restoreCoreRecoveryState", 2],
  ["src/simulation/SimulationEngine.ts#_detectCausality", 1],
]);
const expectedImports = new Set([
  "src/core/SparseVoxelGrid.ts",
  "src/simulation/SimulationEngine.ts",
  "src/chemistry/ChemLayer.ts",
  "src/simulation/AgentSystem.ts",
  "src/simulation/EntityLayer.ts",
  "src/simulation/EntropyLayer.ts",
  "src/simulation/FieldPhysics.ts",
  "src/simulation/InfoPhysics.ts",
  "src/simulation/TemporalLayer.ts",
]);
const expectedSymbolImplementations = new Set([
  "src/core/Chunk.ts",
  "src/core/SparseVoxelGrid.ts",
  "src/core/VoxelGrid.ts",
]);
const errors = [];
const actualCalls = new Map();
const importedFrom = new Set();
const sourcePaths = [];

function collectFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) collectFiles(fullPath);
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) sourcePaths.push(fullPath);
  }
}
collectFiles(resolve(process.cwd(), "src"));
collectFiles(resolve(process.cwd(), "scripts"));

function normalizedPath(filePath) {
  return relative(process.cwd(), filePath).split(sep).join("/");
}

function isPropertyCallArgument(call, propertyName) {
  const parent = call.parent;
  return ts.isCallExpression(parent) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    parent.expression.name.text === propertyName &&
    parent.arguments.some(argument => argument === call);
}

function isSetReceiver(call) {
  const propertyAccess = call.parent;
  return ts.isPropertyAccessExpression(propertyAccess) &&
    propertyAccess.expression === call &&
    propertyAccess.name.text === "set" &&
    ts.isCallExpression(propertyAccess.parent) &&
    propertyAccess.parent.expression === propertyAccess;
}

function isLocalIdentifierAssignment(call) {
  const parent = call.parent;
  return ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === call &&
    ts.isIdentifier(parent.left) &&
    ["chunkBuffer", "sourceBuffer"].includes(parent.left.text);
}

function isLocalBufferDeclaration(call) {
  const parent = call.parent;
  return ts.isVariableDeclaration(parent) &&
    parent.initializer === call &&
    ts.isIdentifier(parent.name) &&
    ["buf", "front", "back"].includes(parent.name.text);
}

for (const filePath of sourcePaths) {
  const path = normalizedPath(filePath);
  const text = readFileSync(filePath, "utf8");
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX :
    /\.(?:js|mjs)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind);
  const methodNodes = new Map();

  function indexMethods(node, currentMethod = null) {
    const method = ts.isMethodDeclaration(node) && node.name
      ? node.name.getText(source)
      : currentMethod;
    if (ts.isMethodDeclaration(node) && method) methodNodes.set(method, node);
    ts.forEachChild(node, child => indexMethods(child, method));
  }
  indexMethods(source);

  function visit(node, currentMethod = null) {
    const method = ts.isMethodDeclaration(node) && node.name
      ? node.name.getText(source)
      : currentMethod;

    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)) {
      if (node.importClause.namedBindings.elements.some(element => element.name.text === "getMutableBuffer")) {
        importedFrom.add(path);
      }
    }

    if (ts.isMethodDeclaration(node) && node.name &&
        ts.isComputedPropertyName(node.name) &&
        ts.isIdentifier(node.name.expression) &&
        node.name.expression.text === "INTERNAL_MUTABLE_BUFFER" &&
        !expectedSymbolImplementations.has(path)) {
      errors.push(`${path}: unexpected INTERNAL_MUTABLE_BUFFER implementation at line ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }

    if (ts.isElementAccessExpression(node) &&
        node.argumentExpression && ts.isIdentifier(node.argumentExpression) &&
        node.argumentExpression.text === "INTERNAL_MUTABLE_BUFFER" &&
        path !== "src/core/TrackedFloat32Array.ts") {
      errors.push(`${path}: direct internal-buffer symbol access outside the approved helper at line ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === "getMutableBuffer") {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const key = `${path}#${method ?? "<top-level>"}`;
      actualCalls.set(key, (actualCalls.get(key) ?? 0) + 1);
      const methodNode = method ? methodNodes.get(method) : null;
      const inlineUpload = isPropertyCallArgument(node, "upload");
      const inlineSetArgument = isPropertyCallArgument(node, "set");
      const inlineSetReceiver = isSetReceiver(node);
      const localAssignment = isLocalIdentifierAssignment(node);
      const localDeclaration = isLocalBufferDeclaration(node);

      if (!methodNode) {
        errors.push(`${path}:${line}: raw buffer acquired outside a named method`);
      } else if (methodNode.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
        if (!inlineUpload) {
          errors.push(`${path}:${line}: async method ${method} may not retain a raw buffer alias; only direct upload arguments are allowed`);
        }
      } else if (!(inlineUpload || inlineSetArgument || inlineSetReceiver || localAssignment || localDeclaration)) {
        errors.push(`${path}:${line}: raw buffer is not used in an approved synchronous, non-escaping form`);
      }

      if (localAssignment && !["syncDenseEntityOwnershipToChunks", "syncDenseToChunks", "syncChunksToDense"].includes(method)) {
        errors.push(`${path}:${line}: local raw buffer alias assignment is not in an approved sync method`);
      }
      const approvedLocalBufferMethods = new Set([
        "src/core/SparseVoxelGrid.ts#syncDenseEntityOwnershipToChunks",
        "src/core/SparseVoxelGrid.ts#syncDenseToChunks",
        "src/core/SparseVoxelGrid.ts#syncChunksToDense",
        "src/chemistry/ChemLayer.ts#commitPendingDensityTransfers",
        "src/chemistry/ChemLayer.ts#tickRegion",
        "src/simulation/AgentSystem.ts#seed",
        "src/simulation/AgentSystem.ts#tick",
        "src/simulation/EntityLayer.ts#tick",
        "src/simulation/EntityLayer.ts#_reconcileFullDomain",
        "src/simulation/EntityLayer.ts#_spawnChild",
        "src/simulation/EntropyLayer.ts#tick",
        "src/simulation/FieldPhysics.ts#tick",
        "src/simulation/InfoPhysics.ts#tick",
        "src/simulation/TemporalLayer.ts#tick",
        "src/simulation/TemporalLayer.ts#_diffuseTime",
        "src/simulation/SimulationEngine.ts#_detectCausality",
      ]);
      if (localDeclaration && !approvedLocalBufferMethods.has(key)) {
        errors.push(`${path}:${line}: retained mutable buffer local is not in an audited synchronous hot path`);
      }
    }
    ts.forEachChild(node, child => visit(child, method));
  }
  visit(source);
}

for (const [key, expectedCount] of expectedCalls) {
  const count = actualCalls.get(key) ?? 0;
  if (count !== expectedCount) errors.push(`${key}: expected ${expectedCount} call(s), found ${count}`);
  actualCalls.delete(key);
}
for (const [key, count] of actualCalls) errors.push(`${key}: unexpected raw-buffer call site count ${count}`);

for (const path of expectedImports) {
  if (!importedFrom.has(path)) errors.push(`${path}: expected import of getMutableBuffer was not found`);
  importedFrom.delete(path);
}
for (const path of importedFrom) errors.push(`${path}: new getMutableBuffer import requires ownership-boundary review`);

for (const path of expectedSymbolImplementations) {
  if (!sourcePaths.map(normalizedPath).includes(path)) errors.push(`${path}: expected source file missing`);
}

assert.deepEqual(errors, [], [
  "Mutable-buffer ownership contract violations:",
  ...errors.map(error => `- ${error}`),
].join("\n"));
console.log("Mutable-buffer contract inventory: PASS (29 audited call sites; no new raw-buffer escapes)");
