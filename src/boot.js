// Plain JS entry so the strict TypeScript checker does not walk the engine sources.
export async function bootEngine() {
  await import("./connector.ts");
  await import("./infinityBootstrap.ts");
}
