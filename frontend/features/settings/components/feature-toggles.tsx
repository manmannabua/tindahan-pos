"use client";

import { CheckIcon } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { FeatureInfo, FeaturePreset } from "@/types/api-admin";

export type FeatureChoices = Record<string, boolean>;

/**
 * Keep choices consistent: switching a feature on switches on what it needs; switching one off
 * switches off what depends on it. (The server rejects inconsistent combinations.)
 */
export function toggleFeature(features: FeatureInfo[], choices: FeatureChoices, key: string, on: boolean): FeatureChoices {
  const next = { ...choices, [key]: on };
  const byKey = new Map(features.map((f) => [f.key, f]));
  if (on) {
    const stack = [...(byKey.get(key)?.requires ?? [])];
    while (stack.length) {
      const required = stack.pop() as string;
      if (!next[required]) {
        next[required] = true;
        stack.push(...(byKey.get(required)?.requires ?? []));
      }
    }
  } else {
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of features) {
        if (next[f.key] && f.requires.some((r) => !next[r])) {
          next[f.key] = false;
          changed = true;
        }
      }
    }
  }
  return next;
}

export function presetChoices(features: FeatureInfo[], preset: FeaturePreset): FeatureChoices {
  return Object.fromEntries(features.map((f) => [f.key, preset.features.includes(f.key)]));
}

/** Which preset (if any) the current choices match exactly. */
export function matchingPreset(features: FeatureInfo[], presets: FeaturePreset[], choices: FeatureChoices): string | null {
  return presets.find((p) => features.every((f) => Boolean(choices[f.key]) === p.features.includes(f.key)))?.key ?? null;
}

export function PresetPicker({
  features,
  presets,
  choices,
  onChange,
  disabled,
}: {
  features: FeatureInfo[];
  presets: FeaturePreset[];
  choices: FeatureChoices;
  onChange: (choices: FeatureChoices) => void;
  disabled?: boolean;
}) {
  const current = matchingPreset(features, presets, choices);
  return (
    <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Starting setup">
      {presets.map((p) => {
        const selected = current === p.key;
        return (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(presetChoices(features, p))}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors disabled:opacity-50",
              selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/60",
            )}
          >
            <span className="flex items-center justify-between font-medium">
              {p.label}
              {selected && <CheckIcon className="size-4 text-primary" aria-hidden />}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">{p.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Feature switches grouped by area, with descriptions and dependency notes. */
export function FeatureToggles({
  features,
  choices,
  onChange,
  disabled,
}: {
  features: FeatureInfo[];
  choices: FeatureChoices;
  onChange: (choices: FeatureChoices) => void;
  disabled?: boolean;
}) {
  const labels = new Map(features.map((f) => [f.key, f.label]));
  const groups = [...new Set(features.map((f) => f.group))];
  return (
    <div className="grid gap-6">
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group}</h3>
          <ul className="divide-y rounded-xl border">
            {features
              .filter((f) => f.group === group)
              .map((f) => (
                <li key={f.key} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <label htmlFor={`feature-${f.key}`} className="block cursor-pointer font-medium">
                      {f.label}
                    </label>
                    <p id={`feature-${f.key}-description`} className="text-sm text-muted-foreground">
                      {f.description}
                      {f.requires.length > 0 && (
                        <span className="mt-0.5 block text-xs">Needs {f.requires.map((r) => labels.get(r) ?? r).join(", ")}.</span>
                      )}
                    </p>
                  </div>
                  <Switch
                    id={`feature-${f.key}`}
                    aria-describedby={`feature-${f.key}-description`}
                    checked={Boolean(choices[f.key])}
                    disabled={disabled}
                    onCheckedChange={(on) => onChange(toggleFeature(features, choices, f.key, on))}
                    className="mt-1"
                  />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
