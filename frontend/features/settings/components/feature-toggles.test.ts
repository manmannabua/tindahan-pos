import { describe, expect, it } from "vitest";

import type { FeatureInfo } from "@/types/api-admin";

import { matchingPreset, presetChoices, toggleFeature } from "./feature-toggles";

const f = (key: string, requires: string[] = []): FeatureInfo => ({ key, label: key, description: "", group: "G", requires, enabled: true });
const FEATURES = [f("inventory"), f("purchasing", ["inventory"]), f("expenses")];
const ALL_ON = { inventory: true, purchasing: true, expenses: true };

describe("toggleFeature", () => {
  it("switching a requirement off switches its dependents off", () => {
    expect(toggleFeature(FEATURES, ALL_ON, "inventory", false)).toEqual({ inventory: false, purchasing: false, expenses: true });
  });

  it("switching a dependent on switches its requirements on", () => {
    const off = { inventory: false, purchasing: false, expenses: false };
    expect(toggleFeature(FEATURES, off, "purchasing", true)).toEqual({ inventory: true, purchasing: true, expenses: false });
  });
});

describe("presets", () => {
  const presets = [
    { key: "basic", label: "Basic", description: "", features: ["inventory"] },
    { key: "everything", label: "Everything", description: "", features: ["inventory", "purchasing", "expenses"] },
  ];

  it("applies and recognizes presets", () => {
    const basic = presetChoices(FEATURES, presets[0]);
    expect(basic).toEqual({ inventory: true, purchasing: false, expenses: false });
    expect(matchingPreset(FEATURES, presets, basic)).toBe("basic");
    expect(matchingPreset(FEATURES, presets, ALL_ON)).toBe("everything");
    expect(matchingPreset(FEATURES, presets, { ...ALL_ON, expenses: false })).toBeNull();
  });
});
