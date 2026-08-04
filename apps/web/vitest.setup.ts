import "@testing-library/jest-dom/vitest";

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
