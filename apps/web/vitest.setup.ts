import "@testing-library/jest-dom/vitest";

// Node 22+'s experimental global `localStorage` (which requires a
// --localstorage-file flag to actually work) collides with jsdom's window
// object here because vitest's jsdom environment aliases `window` to
// `globalThis`. Merely importing certain dual ESM/CJS packages (e.g. clsx,
// pulled in by cva-based shadcn components) is enough to trigger Node's
// accessor and leave `localStorage`/`window.localStorage` undefined instead
// of jsdom's Storage implementation. Install a deterministic in-memory
// Storage so tests never depend on that resolution order.
class MemoryStorage implements Storage {
  #map = new Map<string, string>();
  get length() { return this.#map.size; }
  clear() { this.#map.clear(); }
  getItem(key: string) { return this.#map.has(key) ? this.#map.get(key)! : null; }
  key(index: number) { return Array.from(this.#map.keys())[index] ?? null; }
  removeItem(key: string) { this.#map.delete(key); }
  setItem(key: string, value: string) { this.#map.set(key, String(value)); }
}
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  enumerable: true,
  value: new MemoryStorage(),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

Element.prototype.scrollIntoView ??= function () {};
Element.prototype.hasPointerCapture ??= function () { return false; };
Element.prototype.setPointerCapture ??= function () {};
Element.prototype.releasePointerCapture ??= function () {};
