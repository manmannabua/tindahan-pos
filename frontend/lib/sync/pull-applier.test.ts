import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lookupBarcode, searchCatalog } from "@/lib/db/catalog";
import type { PosDatabase } from "@/lib/db/schema";
import { catalogPage, createTerminalDb, destroyDb, IDS, staffRow } from "@/test-utils/terminal-fixture";
import type { PullResponse } from "@/types/sync";

import { applyPullPage, localCounts, searchTokens } from "./pull-applier";

let db: PosDatabase;
beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
});

const page = (changes: PullResponse["changes"], staff: PullResponse["staff"] = null): PullResponse => ({
  ...catalogPage(),
  changes,
  staff,
});

describe("applyPullPage", () => {
  it("stores the full catalog in camelCase and counts rows", async () => {
    expect(await localCounts(db)).toMatchObject({ products: 1, barcodes: 2, prices: 2, inventory_balances: 1, companies: 1 });
    const company = await db.settings.get("company");
    expect(company?.value).toMatchObject({ code: "ACME", pricesIncludeTax: true });
    expect(await db.staff.count()).toBe(2);
  });

  it("resolves scans of alternative barcode encodings", async () => {
    expect((await lookupBarcode(db, "]E04800361419116")).status).toBe("found");
    expect((await lookupBarcode(db, "case-coke")).status).toBe("found"); // Code 39-style uppercase fallback
    expect((await lookupBarcode(db, "4800361419117")).status).toBe("not_found");
  });

  it("moves a reassigned barcode code to its new row", async () => {
    // The server deactivated the old row and a new row now holds the code for another variant.
    await applyPullPage(
      db,
      page({
        product_variants: [{ id: "v2", product_id: IDS.coke, sku: "COKE-ZERO", name: "Zero", attributes: {}, reorder_point: null, is_default: false, is_active: true }],
        barcodes: [{ id: "bc-new", variant_id: "v2", product_unit_id: IDS.cokePc, code: "4800361419116", symbology: "EAN13", is_primary: true, is_active: true }],
      }),
    );
    const rows = await db.barcodes.where("code").equals("4800361419116").toArray();
    expect(rows.map((r) => r.id)).toEqual(["bc-new"]);
    const scan = await lookupBarcode(db, "4800361419116");
    expect(scan.status === "found" && scan.item.variantName).toBe("Zero");
  });

  it("an inactive barcode is kept but not sellable", async () => {
    await applyPullPage(
      db,
      page({ barcodes: [{ id: "bc000000-0000-7000-8000-000000000001", variant_id: IDS.cokeVariant, product_unit_id: IDS.cokePc, code: "4800361419116", symbology: "EAN13", is_primary: true, is_active: false }] }),
    );
    expect((await lookupBarcode(db, "4800361419116")).status).toBe("inactive");
  });

  it("rebuilds search tokens when a product is renamed", async () => {
    expect((await searchCatalog(db, "coke"))[0]?.productName).toBe("Coke 1.5L");
    await applyPullPage(
      db,
      page({ products: [{ ...catalogPage().changes.products![0], name: "Royal Tru-Orange" }] }),
    );
    expect(await searchCatalog(db, "coke 5l")).toEqual([]); // old name gone ("coke" alone still matches SKU COKE15)
    expect((await searchCatalog(db, "roy ora"))[0]?.sku).toBe("COKE15");
    expect((await searchCatalog(db, "coke15"))[0]?.productName).toBe("Royal Tru-Orange");
  });

  it("replaces the staff snapshot (removed users disappear)", async () => {
    await applyPullPage(db, page({}, [staffRow({ id: IDS.manager, username: "mara" })]));
    expect((await db.staff.toArray()).map((s) => s.username)).toEqual(["mara"]);
  });

  it("stores customers and ignores unknown tables", async () => {
    const changes = {
      customers: [{ id: "cu1", code: "C1", name: "Juan Dela Cruz", phone: "0917", email: null, price_level_id: null, is_active: true }],
      some_future_table: [{ id: "x" }],
    } as PullResponse["changes"];
    await applyPullPage(db, page(changes));
    expect((await db.customers.get("cu1"))?.searchTokens).toContain("juan");
  });

  it("tokenizes names", () => {
    expect(searchTokens("Coke 1.5L", null, "SKU-9")).toEqual(expect.arrayContaining(["coke", "1", "5l", "sku", "9", "sku-9"]));
  });
});
