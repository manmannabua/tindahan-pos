import pytest

from app.shared.barcodes import (
    Symbology,
    canonicalize,
    clean,
    detect_symbology,
    expand_upce,
    has_valid_check_digit,
    internal_ean13,
)


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("4800361419116", Symbology.EAN13),  # Philippine GS1 prefix 480
        ("036000291452", Symbology.UPCA),
        ("96385074", Symbology.EAN8),
        ("04252614", Symbology.UPCE),
        ("ABC-123", Symbology.CODE39),
        ("abc-123", Symbology.OTHER),  # lowercase → not Code 39
        # The example code from the spec has a wrong check digit. It must still be usable.
        ("4800361419117", Symbology.OTHER),
    ],
)
def test_detect_symbology(code: str, expected: Symbology) -> None:
    assert detect_symbology(code) == expected


def test_check_digits() -> None:
    assert has_valid_check_digit("4800361419116")
    assert not has_valid_check_digit("4800361419117")


def test_upce_expansion() -> None:
    assert expand_upce("04252614") == "042100005264"
    assert expand_upce("12345678") is None  # invalid check digit


def test_clean_strips_control_chars_and_aim_prefix() -> None:
    assert clean("  ]E04800361419116\r\n") == "4800361419116"
    assert clean("\x02ABC123\x03") == "ABC123"


def test_canonical_form_merges_upca_and_ean13() -> None:
    assert canonicalize("036000291452") == "0036000291452"
    assert canonicalize("0036000291452") == "0036000291452"
    # Non-GTIN codes are kept exactly (Code 128 is case-sensitive).
    assert canonicalize("Item-42a") == "Item-42a"


def test_internal_barcodes_are_valid_restricted_ean13() -> None:
    code = internal_ean13(42)
    assert code.startswith("2")
    assert len(code) == 13
    assert has_valid_check_digit(code)
    assert detect_symbology(code) == Symbology.EAN13
