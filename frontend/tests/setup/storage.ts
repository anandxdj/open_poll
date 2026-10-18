// Bun has no Web Storage. Modules such as the persisted workspace store bind to
// localStorage when first evaluated, and any test file may import them first
// (lib/api-client pulls the store in), so the shim must exist before all of them.
const createStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  };
};

if (!("localStorage" in globalThis)) {
  Object.assign(globalThis, { localStorage: createStorage(), sessionStorage: createStorage() });
}
