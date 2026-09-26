import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CurrencyInput } from "./currency-input";

function Harness({ initial = "", decimals, onValue }: { initial?: string; decimals?: number; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CurrencyInput
        aria-label="Amount"
        value={value}
        decimals={decimals}
        onValueChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
      />
      <output data-testid="value">{value}</output>
      <button type="button">elsewhere</button>
    </>
  );
}

describe("CurrencyInput", () => {
  it("shows the peso sign and adds thousands separators while typing", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Amount");
    await userEvent.type(input, "1234567.5");
    expect(input).toHaveValue("1,234,567.5");
    expect(screen.getByTestId("value")).toHaveTextContent("1234567.5");
    expect(screen.getByText("₱")).toBeInTheDocument();
  });

  it("refuses letters and extra decimals", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText("Amount");
    await userEvent.type(input, "12abc3.456");
    expect(input).toHaveValue("123.45");
    expect(onValue).not.toHaveBeenCalledWith(expect.stringMatching(/[a-z]/));
  });

  it("pads to two decimals on blur, keeping four-decimal costs", async () => {
    render(<Harness decimals={4} />);
    const input = screen.getByLabelText("Amount");
    await userEvent.type(input, "1500");
    await userEvent.click(screen.getByText("elsewhere"));
    expect(input).toHaveValue("1,500.00");
    expect(screen.getByTestId("value")).toHaveTextContent("1500.00");

    await userEvent.clear(input);
    await userEvent.type(input, "20.6667");
    await userEvent.click(screen.getByText("elsewhere"));
    expect(screen.getByTestId("value")).toHaveTextContent("20.6667");
  });

  it("formats an initial value from the form", () => {
    render(<Harness initial="98765.40" />);
    expect(screen.getByLabelText("Amount")).toHaveValue("98,765.40");
  });

  it("accepts a pasted amount with separators and a peso sign", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Amount");
    input.focus();
    await userEvent.paste("₱2,500.75");
    expect(screen.getByTestId("value")).toHaveTextContent("2500.75");
  });
});
