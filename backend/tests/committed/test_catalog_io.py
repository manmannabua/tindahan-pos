"""CSV product import (background job, inline mode) and export."""

from httpx import AsyncClient

from tests.helpers import signup

CSV = """name,sku,barcode,category,brand,unit,price,cost,tax,track_inventory,reorder_point,opening_stock
Coke 1.5L,COKE15,4800361419116,Drinks,Coca-Cola,PC,75.00,60,VAT12,yes,10,24
Sprite 1.5L,SPRITE15,036000291452,Drinks,Coca-Cola,PC,70.00,55,,yes,,12
Rice 1kg,RICE1,,Grocery,,KG,52.50,45,VAT_EXEMPT,yes,20,100.5
Bad unit,BAD1,,,,LITERS,10.00,,,,,
Negative price,NEG1,,,,PC,-5,,,,,
Gift wrap,WRAP,,Services,,PC,20.00,,,no,,
"""


async def _run_import(client: AsyncClient, headers: dict[str, str], content: str) -> dict:
    resp = await client.post(
        "/api/v1/imports/products",
        files={"file": ("products.csv", content.encode(), "text/csv")},
        headers=headers,
    )
    assert resp.status_code == 202, resp.text
    job = (await client.get(f"/api/v1/imports/{resp.json()['id']}", headers=headers)).json()
    assert job["status"] == "DONE", job
    return dict(job["result"])


async def test_import_then_upsert_then_export(
    committed_client: AsyncClient, company_code: str
) -> None:
    client = committed_client
    tenant = await signup(client, company_code)
    result = await _run_import(client, tenant.headers, CSV)
    assert result["created"] == 4 and result["updated"] == 0
    assert [e["row"] for e in result["errors"]] == [5, 6]
    assert "Unknown unit" in result["errors"][0]["errors"][0]
    assert result["opening_stock_lines"] == 3  # Gift wrap is not stock-tracked

    found = (
        await client.get("/api/v1/products", params={"q": "036000291452"}, headers=tenant.headers)
    ).json()
    assert [p["name"] for p in found["items"]] == ["Sprite 1.5L"]  # UPC-A stored as EAN-13
    categories = {
        c["name"] for c in (await client.get("/api/v1/categories", headers=tenant.headers)).json()
    }
    assert {"Drinks", "Grocery", "Services"} <= categories

    # Re-import with a new price for COKE15 updates instead of duplicating.
    result = await _run_import(
        client,
        tenant.headers,
        "name,sku,unit,price\nCoke 1.5L (new label),COKE15,PC,79.00\n",
    )
    assert (result["created"], result["updated"]) == (0, 1)

    export = await client.get("/api/v1/exports/products.csv", headers=tenant.headers)
    lines = export.text.strip().splitlines()
    assert lines[0].startswith("name,sku,barcode,category,brand,unit,price,cost")
    coke = next(line for line in lines if ",COKE15," in line)
    assert coke.startswith(
        "Coke 1.5L (new label),COKE15,4800361419116,Drinks,Coca-Cola,PC,79.00,60"
    )
    assert coke.endswith(",24.000")
    rice = next(line for line in lines if ",RICE1," in line)
    assert rice.endswith(",100.500")


async def test_import_rejects_missing_columns(
    committed_client: AsyncClient, company_code: str
) -> None:
    tenant = await signup(committed_client, company_code)
    result = await _run_import(committed_client, tenant.headers, "title,cost\nX,1\n")
    assert result["created"] == 0
    assert "Missing column" in result["errors"][0]["errors"][0]
