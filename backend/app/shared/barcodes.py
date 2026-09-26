"""Barcode normalization and symbology detection.

Mirrors `frontend/lib/barcode/normalize.ts`. See docs/BARCODE_SCANNER.md.

Storage rule: barcodes are stored *canonically*. A valid 12-digit UPC-A is stored as its 13-digit
EAN-13 form (leading 0), because they are the same GTIN printed two ways. Everything else is
stored as scanned (after trimming), so internal codes and Code 128 values keep their case.
"""

import re
from enum import StrEnum

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_AIM_PREFIX = re.compile(r"^\][A-Za-z][0-9A-Za-z]")


class Symbology(StrEnum):
    EAN13 = "EAN13"
    EAN8 = "EAN8"
    UPCA = "UPCA"
    UPCE = "UPCE"
    CODE39 = "CODE39"
    OTHER = "CODE128_OR_OTHER"


def gtin_check_digit(body: str) -> int:
    """Check digit for GTIN-8/12/13/14 given the digits without the check digit."""
    total = 0
    for i, ch in enumerate(reversed(body)):
        total += int(ch) * (3 if i % 2 == 0 else 1)
    return (10 - total % 10) % 10


def has_valid_check_digit(code: str) -> bool:
    return code.isdigit() and len(code) >= 2 and gtin_check_digit(code[:-1]) == int(code[-1])


def expand_upce(code: str) -> str | None:
    """Expand an 8-digit UPC-E (number system 0/1) to 12-digit UPC-A, or None if invalid."""
    if len(code) != 8 or not code.isdigit() or code[0] not in "01":
        return None
    ns, d, check = code[0], code[1:7], code[7]
    last = d[5]
    if last in "012":
        body = f"{d[0]}{d[1]}{last}0000{d[2]}{d[3]}{d[4]}"
    elif last == "3":
        body = f"{d[0]}{d[1]}{d[2]}00000{d[3]}{d[4]}"
    elif last == "4":
        body = f"{d[0]}{d[1]}{d[2]}{d[3]}00000{d[4]}"
    else:
        body = f"{d[0]}{d[1]}{d[2]}{d[3]}{d[4]}0000{last}"
    upca = f"{ns}{body}{check}"
    return upca if has_valid_check_digit(upca) else None


def clean(raw: str) -> str:
    """Trim, drop control characters and an AIM symbology identifier prefix (e.g. ']E0')."""
    value = _CONTROL_CHARS.sub("", raw).strip()
    return _AIM_PREFIX.sub("", value, count=1).strip()


def detect_symbology(code: str) -> Symbology:
    if code.isdigit():
        if len(code) == 13 and has_valid_check_digit(code):
            return Symbology.EAN13
        if len(code) == 12 and has_valid_check_digit(code):
            return Symbology.UPCA
        if len(code) == 8:
            if has_valid_check_digit(code):
                return Symbology.EAN8
            if expand_upce(code):
                return Symbology.UPCE
        # Numeric but not a valid GTIN: most likely Code 128 / ITF, not Code 39.
        return Symbology.OTHER
    if re.fullmatch(r"[0-9A-Z \-.$/+%]+", code):
        return Symbology.CODE39
    return Symbology.OTHER


def canonicalize(raw: str) -> str:
    """The form a barcode is stored in (and must be unique in)."""
    code = clean(raw)
    if len(code) == 12 and code.isdigit() and has_valid_check_digit(code):
        return "0" + code
    return code


def internal_ean13(sequence: int, prefix: str = "2") -> str:
    """EAN-13 in the restricted-circulation range (prefix 2): never collides with retail GTINs."""
    body = f"{prefix}{sequence:011d}"
    if len(body) != 12:
        raise ValueError("Internal barcode sequence exhausted")
    return body + str(gtin_check_digit(body))
