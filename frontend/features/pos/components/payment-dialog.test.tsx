import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LocalPaymentMethod } from "@/lib/db/schema";

import { PaymentDialog, quickTenders } from "./payment-dialog";

const method = (id: string, name: string, kind: LocalPaymentMethod["kind"], requiresReference = false): LocalPaymentMethod => ({
  id,
  code: name.toUpperCase(),
  name,
  kind,
  requiresReference,
  opensDrawer: kind === "CASH",
  sortOrder: 0,
  isActive: true,
});

describe("quickTenders", () => {
  it("offers exact amount then the next notes up", () => {
    expect(quickTenders("67.17")).toEqual(["67.17", "100.00", "200.00", "500.00", "1000.00"]);
    expect(quickTenders("20.00")).toEqual(["20.00", "50.00", "100.00", "200.00", "500.00"]);
  });
});

describe("PaymentDialog", () => {
  it("splits GCash + cash and completes when fully paid", async () => {
    const onComplete = vi.fn();
    render(
      <PaymentDialog
        open
        total="67.17"
        currency="PHP"
        methods={[method("c", "Cash", "CASH"), method("g", "GCash", "EWALLET", true)]}
        busy={false}
        onCancel={vi.fn()}
        onComplete={onComplete}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "GCash" }));
    await user.type(screen.getByLabelText("Amount"), "50");
    await user.click(screen.getByRole("button", { name: "Add GCash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("reference");
    await user.type(screen.getByLabelText("Reference number"), "GC-1{Enter}");
    expect(screen.getByTestId("remaining")).toHaveTextContent("17.17");

    await user.click(screen.getByRole("button", { name: "Cash" }));
    await user.type(screen.getByLabelText("Cash received"), "20{Enter}");
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ amount: "50.00", referenceNo: "GC-1", tendered: null }),
      expect.objectContaining({ amount: "17.17", tendered: "20.00" }),
    ]);
  });
});
