    return Number(a?.stats?.objects ?? 0) !== Number(b?.stats?.objects ?? 0)
      || Number(a?.stats?.loadedChunks ?? 0) !== Number(b?.stats?.loadedChunks ?? 0)
      || !!a?.lastGeneration;
  }, before, { timeout: acceptanceTimeout });

  await page.waitForFunction(() => Number(window.worldTerrainPatchStats?.().patchCount ?? 0) > 0, undefined, { timeout: acceptanceTimeout });
  const afterQuick = await page.evaluate(() => ({ health: window.worldGenerationHealth(), terrain: window.worldTerrainPatchStats?.() }));
  if (!afterQuick?.health?.lastGeneration) throw new Error("Quick Generate did not record a generation result");
  if (Number(afterQuick.health.lastGeneration.appliedElements ?? 0) <= 0) throw new Error("Quick Generate produced no applied world-generation elements");
  if (Number(afterQuick.health.stats?.loadedChunks ?? 0) <= 0) throw new Error("Quick Generate did not materialize loaded world chunks");
  if (Number(afterQuick.terrain?.patchCount ?? 0) <= 0) throw new Error("Quick Generate did not materialize terrain patches");

  const finalProvenance = await page.evaluate(() => window.getRuntimeProvenance?.());
  const finalStages = (finalProvenance?.events ?? []).map((event) => event.stage);
  if (!finalStages.includes("world-state")) {
    throw new Error(`World state provenance was not recorded after Quick Generate: ${JSON.stringify(finalStages)}`);