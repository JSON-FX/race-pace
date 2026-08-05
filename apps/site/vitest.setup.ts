import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Next's router is unavailable under jsdom; components under test that
// navigate get a stub they can assert against.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
}));

// jsdom has no IntersectionObserver, which motion's useInView and the map's
// LazyMount both rely on. The stub reports every observed element as visible
// immediately: scroll-reveal components animate FROM hidden TO shown, so
// without it every revealed section would be absent from the DOM and each
// assertion would fail for a reason that has nothing to do with the assertion.
// Not `implements IntersectionObserver`: the DOM lib's interface keeps gaining
// members (scrollMargin most recently), and a test double that must track every
// one of them breaks the build on a TypeScript upgrade for no benefit. The cast
// at stubGlobal is the single place that asserts the shape is good enough.
class TestIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  private readonly cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
