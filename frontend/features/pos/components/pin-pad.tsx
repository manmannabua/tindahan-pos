"use client";

import { DeleteIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  label?: string;
}

/** Numeric PIN entry: physical keyboard (input) and a large touch keypad. */
export function PinPad({ value, onChange, onSubmit, disabled, label = "PIN" }: PinPadProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const press = (key: string) => value.length < 8 && onChange(value + key);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.length >= 4) onSubmit();
      }}
    >
      <Input
        ref={input}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        value={value}
        disabled={disabled}
        maxLength={8}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
        className="h-14 text-center text-2xl tracking-[0.5em]"
      />
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <Button key={k} type="button" variant="outline" className="h-14 text-xl" disabled={disabled} onClick={() => press(k)}>
            {k}
          </Button>
        ))}
        <Button type="button" variant="ghost" className="h-14" disabled={disabled} onClick={() => onChange(value.slice(0, -1))} aria-label="Delete digit">
          <DeleteIcon className="size-6" />
        </Button>
        <Button type="button" variant="outline" className="h-14 text-xl" disabled={disabled} onClick={() => press("0")}>
          0
        </Button>
        <Button type="submit" className="h-14 text-base" disabled={disabled || value.length < 4}>
          OK
        </Button>
      </div>
    </form>
  );
}
