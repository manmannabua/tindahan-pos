"""Generate the app icons (SVG + PNGs) from one geometry: a store front with a striped awning.

    python scripts/generate-icons.py      (needs Pillow; run from frontend/)

Outputs public/icons/icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png,
app/icon.svg (favicon) and app/apple-icon.png (180 px).
"""

from pathlib import Path

from PIL import Image, ImageDraw

TEAL = "#0f5257"
LIGHT = "#cfe8e5"
WINDOW = "#8fc9c2"
WHITE = "#ffffff"
ROOT = Path(__file__).resolve().parent.parent


def shapes(pad: float = 0.0) -> list[tuple]:
    """Geometry in a 64-unit box; `pad` shrinks the drawing toward the centre (maskable)."""
    scale = (64 - 2 * pad) / 64

    def p(x: float, y: float) -> tuple[float, float]:
        return (pad + x * scale, pad + y * scale)

    items: list[tuple] = [("rect", p(12, 11), p(52, 14.5), WHITE, 1.5)]  # roof edge
    stripe = 40 / 4
    for i in range(4):  # awning: alternating stripes with scalloped bottoms
        x0 = 12 + i * stripe
        colour = WHITE if i % 2 == 0 else LIGHT
        items.append(("rect", p(x0, 14.5), p(x0 + stripe, 23), colour, 0))
        r = stripe / 2
        items.append(("ellipse", p(x0, 23 - r), p(x0 + stripe, 23 + r), colour, 0))
    items.append(("rect", p(15, 29), p(49, 52), WHITE, 2.5))  # shop body
    items.append(("rect", p(19, 34), p(30, 43), WINDOW, 1.5))  # window
    items.append(("rect", p(34, 35), p(44, 52), TEAL, 1.5))  # door
    items.append(("rect", p(12, 51), p(52, 53.5), WHITE, 1.2))  # step
    return items, scale


def svg(pad: float = 0.0, radius: float = 14) -> str:
    items, scale = shapes(pad)
    body = [f'<rect width="64" height="64" rx="{radius}" fill="{TEAL}"/>']
    for kind, (x0, y0), (x1, y1), colour, rx in items:
        if kind == "rect":
            body.append(
                f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{x1 - x0:.2f}" height="{y1 - y0:.2f}" '
                f'rx="{rx * scale:.2f}" fill="{colour}"/>'
            )
        else:
            body.append(
                f'<ellipse cx="{(x0 + x1) / 2:.2f}" cy="{(y0 + y1) / 2:.2f}" '
                f'rx="{(x1 - x0) / 2:.2f}" ry="{(y1 - y0) / 2:.2f}" fill="{colour}"/>'
            )
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  ' + "\n  ".join(body) + "\n</svg>\n"


def png(size: int, pad: float = 0.0, radius: float = 14) -> Image.Image:
    ss = 4  # supersample for smooth edges
    k = size * ss / 64
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, size * ss - 1, size * ss - 1), radius=radius * k, fill=TEAL)
    items, scale = shapes(pad)
    for kind, (x0, y0), (x1, y1), colour, rx in items:
        box = (x0 * k, y0 * k, x1 * k, y1 * k)
        if kind == "rect":
            d.rounded_rectangle(box, radius=rx * scale * k, fill=colour)
        else:
            d.ellipse(box, fill=colour)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    icons = ROOT / "public" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    (icons / "icon.svg").write_text(svg(), encoding="utf-8")
    (ROOT / "app" / "icon.svg").write_text(svg(), encoding="utf-8")
    png(192).save(icons / "icon-192.png")
    png(512).save(icons / "icon-512.png")
    # Maskable: full-bleed background, artwork inside the 80% safe zone.
    png(512, pad=8, radius=0).save(icons / "icon-maskable-512.png")
    png(180, radius=0).convert("RGB").save(ROOT / "app" / "apple-icon.png")
    print("icons written")


if __name__ == "__main__":
    main()
