import { describe, it, expect } from "vitest";
import { withFraming, parsePhotoUrl, framedImageStyle, FULL_FRAME } from "./photo";

const URL_ = "https://cdn.test/u1/avatar-1.png";

describe("withFraming", () => {
  it("appends the framing as a fragment", () => {
    expect(withFraming(URL_, { x: 10, y: 20, width: 50, height: 50 })).toBe(`${URL_}#c=10,20,50,50`);
  });

  it("leaves a full frame bare so the value stays a plain image URL", () => {
    expect(withFraming(URL_, FULL_FRAME)).toBe(URL_);
  });

  it("replaces an existing fragment instead of stacking a second one", () => {
    const once = withFraming(URL_, { x: 1, y: 2, width: 30, height: 30 });
    expect(withFraming(once, { x: 5, y: 6, width: 40, height: 40 })).toBe(`${URL_}#c=5,6,40,40`);
  });

  it("rounds to two decimals so the stored value stays short", () => {
    expect(withFraming(URL_, { x: 12.3456, y: 0, width: 33.3333, height: 33.3333 })).toBe(`${URL_}#c=12.35,0,33.33,33.33`);
  });
});

describe("parsePhotoUrl", () => {
  it("round-trips a framed url", () => {
    const framing = { x: 12.5, y: 7.25, width: 60, height: 60 };
    expect(parsePhotoUrl(withFraming(URL_, framing))).toEqual({ src: URL_, framing });
  });

  it("treats a photo set on mobile (no fragment) as the full frame", () => {
    expect(parsePhotoUrl(URL_)).toEqual({ src: URL_, framing: FULL_FRAME });
  });

  it("falls back to the full frame rather than throwing on a junk fragment", () => {
    expect(parsePhotoUrl(`${URL_}#c=nonsense`)).toEqual({ src: URL_, framing: FULL_FRAME });
    expect(parsePhotoUrl(`${URL_}#c=1,2,0,50`)).toEqual({ src: URL_, framing: FULL_FRAME });
  });

  it("is null for an unset photo", () => {
    expect(parsePhotoUrl(null)).toBeNull();
    expect(parsePhotoUrl(undefined)).toBeNull();
    expect(parsePhotoUrl("")).toBeNull();
  });
});

describe("framedImageStyle", () => {
  it("scales and offsets so the framed region fills the container", () => {
    // A quarter-size window at (25%, 25%) means a 4x blow-up, pushed back by
    // one container's width and height.
    expect(framedImageStyle({ x: 25, y: 25, width: 25, height: 25 })).toMatchObject({
      width: "400%",
      height: "400%",
      left: "-100%",
      top: "-100%",
    });
  });

  it("uses object-cover for an unframed photo, whose region has no guaranteed aspect", () => {
    expect(framedImageStyle(FULL_FRAME)).toMatchObject({ objectFit: "cover", width: "100%", height: "100%" });
  });
});
