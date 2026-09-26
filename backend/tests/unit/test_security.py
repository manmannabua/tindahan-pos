import base64
import hashlib
import uuid

import pytest

from app.core.security import (
    InvalidPublicKeyError,
    InvalidTokenError,
    TokenType,
    create_jwt,
    decode_jwt,
    device_challenge_message,
    hash_secret,
    load_device_public_key,
    make_offline_pin_verifier,
    public_key_to_pem,
    verify_device_signature,
    verify_secret,
)
from tests.helpers import new_device_key, sign_webcrypto_style, spki_b64


def test_password_hash_roundtrip() -> None:
    hashed = hash_secret("s3cret-password")
    assert hashed.startswith("$argon2id$")
    assert verify_secret("s3cret-password", hashed)
    assert not verify_secret("wrong", hashed)


def test_verify_secret_with_missing_hash_is_false() -> None:
    assert not verify_secret("anything", None)


def test_offline_pin_verifier_matches_pbkdf2() -> None:
    """The POS recomputes this with WebCrypto PBKDF2; both sides must agree byte-for-byte."""
    v = make_offline_pin_verifier("482915", iterations=1000)
    expected = hashlib.pbkdf2_hmac("sha256", b"482915", base64.b64decode(v.salt), 1000, dklen=32)
    assert base64.b64decode(v.verifier) == expected
    assert v.iterations == 1000


def test_jwt_roundtrip() -> None:
    user, company, device = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    token, _ = create_jwt(
        subject=user,
        company_id=company,
        token_type=TokenType.ACCESS,
        ttl_seconds=60,
        device_id=device,
    )
    claims = decode_jwt(token)
    assert (claims.subject, claims.company_id, claims.device_id) == (user, company, device)
    assert claims.token_type == TokenType.ACCESS


def test_expired_jwt_rejected() -> None:
    token, _ = create_jwt(
        subject=uuid.uuid4(), company_id=uuid.uuid4(), token_type=TokenType.ACCESS, ttl_seconds=-1
    )
    with pytest.raises(InvalidTokenError):
        decode_jwt(token)


def test_tampered_jwt_rejected() -> None:
    token, _ = create_jwt(
        subject=uuid.uuid4(), company_id=uuid.uuid4(), token_type=TokenType.ACCESS, ttl_seconds=60
    )
    with pytest.raises(InvalidTokenError):
        decode_jwt(token[:-2] + ("AA" if not token.endswith("AA") else "BB"))


def test_device_signature_webcrypto_format() -> None:
    key = new_device_key()
    pem = public_key_to_pem(load_device_public_key(spki_b64(key)))
    device_id = uuid.uuid4()
    msg = device_challenge_message(device_id, "nonce-123")
    sig = sign_webcrypto_style(key, msg)
    assert verify_device_signature(pem, msg, sig)
    # Signature for a different nonce must fail.
    assert not verify_device_signature(pem, device_challenge_message(device_id, "other"), sig)
    # Another device's key must fail.
    other = public_key_to_pem(load_device_public_key(spki_b64(new_device_key())))
    assert not verify_device_signature(other, msg, sig)


def test_non_p256_key_rejected() -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP384R1())
    der = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    with pytest.raises(InvalidPublicKeyError):
        load_device_public_key(base64.b64encode(der).decode())
    with pytest.raises(InvalidPublicKeyError):
        load_device_public_key("not base64 !!")
