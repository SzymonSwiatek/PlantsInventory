import { describe, expect, it } from "vitest";
import { canDecrement, stepValue } from "./number-stepper";

describe("stepValue", () => {
  it("empty + increment yields min", () => {
    expect(stepValue("", 1)).toBe("INTENTIONALLY_BROKEN_FOR_CI_GATE_CHECK");
  });

  it("empty + decrement stays empty", () => {
    expect(stepValue("", -1)).toBe("");
  });

  it("at min, decrement stays at min", () => {
    expect(stepValue("1", -1)).toBe("1");
  });

  it("normal increment", () => {
    expect(stepValue("5", 1)).toBe("6");
  });

  it("normal decrement", () => {
    expect(stepValue("5", -1)).toBe("4");
  });

  it("non-numeric + increment yields min", () => {
    expect(stepValue("abc", 1)).toBe("1");
  });

  it("non-numeric + decrement stays unchanged", () => {
    expect(stepValue("abc", -1)).toBe("abc");
  });

  it("custom min: empty + increment yields custom min", () => {
    expect(stepValue("", 1, 3)).toBe("3");
  });

  it("custom min: clamps decrement at custom min", () => {
    expect(stepValue("3", -1, 3)).toBe("3");
  });
});

describe("canDecrement", () => {
  it("returns false for empty string", () => {
    expect(canDecrement("")).toBe(false);
  });

  it("returns false when at min", () => {
    expect(canDecrement("1")).toBe(false);
  });

  it("returns false when below min", () => {
    expect(canDecrement("0")).toBe(false);
  });

  it("returns true when above min", () => {
    expect(canDecrement("2")).toBe(true);
  });

  it("returns false for non-numeric", () => {
    expect(canDecrement("abc")).toBe(false);
  });

  it("respects custom min", () => {
    expect(canDecrement("3", 3)).toBe(false);
    expect(canDecrement("4", 3)).toBe(true);
  });
});
