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
  ["src/simulation/EntityLayer.ts#tick", 2],
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

  // The call-site inventory above is necessary but not sufficient: an audited
  // local alias must not escape its synchronous owner through a return or
  // object/property assignment. Callback lifetimes need a separate ownership review.
  for (const [key, methodNode] of methodNodes) {
    if (!key) continue;
    const aliases = new Set();
    const aliasDeclarations = [];
    function isFunctionNode(node) {
      return ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node);
    }
    function functionOwnerFor(node) {
      let current = node;
      while (current) {
        if (isFunctionNode(current)) return current;
        if (current === methodNode) break;
        current = current.parent;
      }
      return methodNode;
    }
    function isFunctionAncestor(ancestor, descendant) {
      let current = descendant;
      while (current) {
        if (current === ancestor) return true;
        current = current.parent;
      }
      return false;
    }
    function collectAliases(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          node.expression.text === "getMutableBuffer") {
        const parent = node.parent;
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) &&
            ["buf", "front", "back"].includes(parent.name.text)) {
          aliases.add(parent.name.text);
          aliasDeclarations.push({ name: parent.name.text, owner: functionOwnerFor(parent), node: parent.name });
        }
        if (ts.isBinaryExpression(parent) &&
            parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(parent.left) &&
            ["chunkBuffer", "sourceBuffer"].includes(parent.left.text)) {
          aliases.add(parent.left.text);
          aliasDeclarations.push({ name: parent.left.text, owner: functionOwnerFor(node), node: parent.left });
        }
      }
      ts.forEachChild(node, collectAliases);
    }
    collectAliases(methodNode);
    if (aliases.size === 0) continue;

    function containsAwaitOrYield(fn) {
      let found = false;
      function visit(current) {
        if (current !== fn && isFunctionNode(current)) return;
        if (ts.isAwaitExpression(current) || ts.isYieldExpression(current)) found = true;
        ts.forEachChild(current, visit);
      }
      visit(fn);
      return found;
    }
    function isApprovedSynchronousRollbackClosure(fn, aliasName) {
      // Explicit exception: the rollback closure belongs to the synchronous EntityLayer reconciliation transaction.
      if (path !== "src/simulation/EntityLayer.ts" || key !== "tick" || aliasName !== "buf") return false;
      const declaration = fn.parent;
      if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== fn ||
          !ts.isIdentifier(declaration.name) || declaration.name.text !== "rollbackTick" ||
          containsAwaitOrYield(fn)) return false;
      let passedToReconcile = false;
      let invalidReference = false;
      function visitOwner(current) {
        if (ts.isIdentifier(current) && current.text === "rollbackTick") {
          const parent = current.parent;
          if (ts.isVariableDeclaration(parent) && parent.name === current) {
            // Declaration name.
          } else {
            const expectedArgument = ts.isCallExpression(parent) &&
              ts.isPropertyAccessExpression(parent.expression) &&
              parent.expression.name.text === "_reconcileFullDomain" &&
              parent.arguments.some(argument => argument === current);
            const synchronousRollbackCall = ts.isCallExpression(parent) &&
              parent.expression === current && parent.arguments.length === 0 &&
              functionOwnerFor(current) === methodNode;
            if (expectedArgument) passedToReconcile = true;
            else if (!synchronousRollbackCall) invalidReference = true;
          }
        }
        ts.forEachChild(current, visitOwner);
      }
      visitOwner(methodNode);
      return passedToReconcile && !invalidReference;
    }

    const reportedClosureAliases = new Set();
    function inspectAliasUse(node) {
      if (ts.isIdentifier(node) && aliases.has(node.text)) {
        const parent = node.parent;
        const isDeclarationName =
          (ts.isVariableDeclaration(parent) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node);
        const occurrenceOwner = functionOwnerFor(node);
        let binding = null;
        for (const candidate of aliasDeclarations) {
          if (candidate.name !== node.text || !isFunctionAncestor(candidate.owner, occurrenceOwner)) continue;
          if (!binding || isFunctionAncestor(binding.owner, candidate.owner)) binding = candidate;
        }
        if (!isDeclarationName && binding && binding.owner !== occurrenceOwner &&
            !isApprovedSynchronousRollbackClosure(occurrenceOwner, node.text)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        // Unwrap type/parentheses assertions so a raw alias cannot escape disguised as a new expression.
        let valueExpression = node;
        let valueParent = valueExpression.parent;
        while (
          (ts.isParenthesizedExpression(valueParent) && valueParent.expression === valueExpression) ||
          (ts.isAsExpression(valueParent) && valueParent.expression === valueExpression) ||
          (ts.isTypeAssertionExpression(valueParent) && valueParent.expression === valueExpression) ||
          (ts.isNonNullExpression(valueParent) && valueParent.expression === valueExpression) ||
          (ts.isSatisfiesExpression(valueParent) && valueParent.expression === valueExpression)
        ) {
          valueExpression = valueParent;
          valueParent = valueExpression.parent;
        }
        if (!isDeclarationName && ts.isReturnStatement(valueParent) && valueParent.expression === valueExpression) {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not be returned from its audited method`);
        }
        if (!isDeclarationName && ts.isVariableDeclaration(valueParent) && valueParent.initializer === valueExpression) {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not initialize another variable`);
        }
        if (!isDeclarationName && ts.isBinaryExpression(valueParent) && valueParent.right === valueExpression) {
          if (ts.isIdentifier(valueParent.left)) {
            errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not be copied to another variable`);
          } else if (ts.isPropertyAccessExpression(valueParent.left) || ts.isElementAccessExpression(valueParent.left)) {
            errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not be stored on an object/property`);
          }
        }
        if (!isDeclarationName && ts.isPropertyAssignment(valueParent) && valueParent.initializer === valueExpression) {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not escape through an object literal`);
        }
        if (!isDeclarationName && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not escape through an object shorthand property`);
        }
        if (!isDeclarationName && ts.isArrayLiteralExpression(valueParent) && valueParent.elements.some(element => element === valueExpression)) {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not escape through an array literal`);
        }
        if (!isDeclarationName && ts.isSpreadElement(valueParent) && valueParent.expression === valueExpression) {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not be spread into another container or call`);
        }
        if (!isDeclarationName && ts.isConditionalExpression(valueParent) &&
            (valueParent.whenTrue === valueExpression || valueParent.whenFalse === valueExpression)) {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not be used as a conditional result value`);
        }
        if (!isDeclarationName && ts.isBinaryExpression(valueParent) &&
            [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(valueParent.operatorToken.kind) &&
            (valueParent.left === valueExpression || valueParent.right === valueExpression)) {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not be propagated through a logical/nullish expression`);
        }
        if (!isDeclarationName && ts.isPropertyAccessExpression(valueParent) &&
            valueParent.expression === valueExpression && valueParent.name.text === "buffer") {
          errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not expose its backing ArrayBuffer`);
        }
        if (!isDeclarationName && ts.isPropertyAccessExpression(valueParent) &&
            valueParent.expression === valueExpression && valueParent.name.text === "subarray") {
          const subarrayCall = valueParent.parent;
          const outerCall = subarrayCall.parent;
          const copiedSynchronously = ts.isCallExpression(subarrayCall) &&
            ts.isCallExpression(outerCall) &&
            ts.isPropertyAccessExpression(outerCall.expression) &&
            outerCall.expression.name.text === "set" &&
            outerCall.arguments.some(argument => argument === subarrayCall);
          if (!copiedSynchronously) {
            errors.push(`${path}:${line}: raw buffer subarray must be copied synchronously rather than retained`);
          }
        }
        if (!isDeclarationName && ts.isCallExpression(valueParent) &&
            valueParent.arguments.some(argument => argument === valueExpression)) {
          const receiver = ts.isPropertyAccessExpression(valueParent.expression)
            ? valueParent.expression.expression
            : null;
          const isTypedArrayCopy = ts.isPropertyAccessExpression(valueParent.expression) &&
            valueParent.expression.name.text === "set" &&
            ts.isIdentifier(receiver) && aliases.has(receiver.text);
          const isAuditedLocalBufferCache = path === "src/core/SparseVoxelGrid.ts" &&
            ["syncDenseEntityOwnershipToChunks", "syncDenseToChunks", "syncChunksToDense"].includes(key) &&
            ts.isPropertyAccessExpression(valueParent.expression) &&
            valueParent.expression.name.text === "set" &&
            ts.isIdentifier(receiver) && receiver.text === "rawBuffers";
          const agentHandoffNames = new Set(["_explore", "_harvest", "_signal", "_build", "_destroy"]);
          const agentHandoffName = ts.isPropertyAccessExpression(valueParent.expression)
            ? valueParent.expression.name.text
            : "";
          const agentHandoffTarget = methodNodes.get(agentHandoffName);
          const isAuditedSynchronousAgentHandoff = path === "src/simulation/AgentSystem.ts" &&
            key === "tick" && node.text === "buf" &&
            ts.isPropertyAccessExpression(valueParent.expression) &&
            valueParent.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
            agentHandoffNames.has(agentHandoffName) &&
            !!agentHandoffTarget &&
            !agentHandoffTarget.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) &&
            !containsAwaitOrYield(agentHandoffTarget);
          if (!isTypedArrayCopy && !isAuditedLocalBufferCache && !isAuditedSynchronousAgentHandoff) {
            errors.push(`${path}:${line}: raw buffer alias "${node.text}" may not be passed to an arbitrary function which could retain it`);
          }
        }
      }
      ts.forEachChild(node, inspectAliasUse);
    }
    inspectAliasUse(methodNode);
  }
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
console.log(`Mutable-buffer contract inventory: PASS (${[...expectedCalls.values()].reduce((sum, count) => sum + count, 0)} audited call sites; no new raw-buffer escapes)`);
