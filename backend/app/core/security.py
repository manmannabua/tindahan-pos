"""Security primitives: hashing, tokens, signatures.

This module has no database access. Higher-level flows (login, refresh rotation, device
authentication) live in `app.modules.auth` and `app.modules.devices`.
"""

import base64
import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from app.core.config import get_settings

_hasher = PasswordHasher()

# Pre-computed hash used to equalize timing when a login email does not exist.
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


# --- Passwords & PINs --------------------------------------------------------------------


def hash_secret(secret: str) -> str:
    """argon2id hash for passwords and PINs."""
    return _hasher.hash(secret)


def verify_secret(secret: str, hashed: str | None) -> bool:
    if hashed is None:
        # Burn the same time as a real verification so response timing doesn't reveal
        # whether the account exists.
        _safe_verify(_DUMMY_HASH, secret)
        return False
    return _safe_verify(hashed, secret)


def _safe_verify(hashed: str, secret: str) -> bool:
    try:
        return _hasher.verify(hashed, secret)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    return _hasher.check_needs_rehash(hashed)


@dataclass(frozen=True, slots=True)
class OfflinePinVerifier:
    salt: str  # base64
    verifier: str  # base64
    iterations: int


def make_offline_pin_verifier(pin: str, iterations: int | None = None) -> OfflinePinVerifier:
    """PBKDF2-HMAC-SHA256 verifier the POS can check offline with WebCrypto.

    See docs/SECURITY.md#offline-authentication for the threat model.
    """
    iterations = iterations or get_settings().pin_offline_iterations
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, iterations, dklen=32)
    return OfflinePinVerifier(
        salt=base64.b64encode(salt).decode(),
        verifier=base64.b64encode(derived).decode(),
        iterations=iterations,
    )


# --- Opaque tokens (refresh tokens, nonces) ----------------------------------------------


def generate_opaque_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_opaque_token(token: str) -> str:
    """Refresh tokens are high-entropy, so a fast hash (SHA-256) is sufficient."""
    return hashlib.sha256(token.encode()).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# --- JWT ---------------------------------------------------------------------------------


class TokenType(StrEnum):
    ACCESS = "access"
    DEVICE = "device"


class InvalidTokenError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class TokenClaims:
    subject: uuid.UUID
    company_id: uuid.UUID
    token_type: TokenType
    device_id: uuid.UUID | None
    token_id: str
    expires_at: datetime


def create_jwt(
    *,
    subject: uuid.UUID,
    company_id: uuid.UUID,
    token_type: TokenType,
    ttl_seconds: int,
    device_id: uuid.UUID | None = None,
) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=ttl_seconds)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "cid": str(company_id),
        "typ": token_type.value,
        "jti": secrets.token_hex(8),
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    if device_id is not None:
        payload["did"] = str(device_id)
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_jwt(token: str) -> TokenClaims:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "cid", "typ", "exp", "iat"]},
        )
        return TokenClaims(
            subject=uuid.UUID(payload["sub"]),
            company_id=uuid.UUID(payload["cid"]),
            token_type=TokenType(payload["typ"]),
            device_id=uuid.UUID(payload["did"]) if payload.get("did") else None,
            token_id=payload.get("jti", ""),
            expires_at=datetime.fromtimestamp(payload["exp"], tz=UTC),
        )
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise InvalidTokenError(str(exc)) from exc


# --- Device signatures -------------------------------------------------------------------


class InvalidPublicKeyError(ValueError):
    pass


def load_device_public_key(spki_b64: str) -> ec.EllipticCurvePublicKey:
    """Parse a WebCrypto-exported SPKI public key (base64 DER). Only P-256 is accepted."""
    try:
        der = base64.b64decode(spki_b64, validate=True)
        key = serialization.load_der_public_key(der)
    except ValueError as exc:
        raise InvalidPublicKeyError("Public key is not valid base64 SPKI") from exc
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise InvalidPublicKeyError("Public key must be ECDSA P-256")
    return key


def device_challenge_message(device_id: uuid.UUID, nonce: str) -> bytes:
    return f"pos-device-auth\n{device_id}\n{nonce}".encode()


def verify_device_signature(public_key_pem: str, message: bytes, signature_b64: str) -> bool:
    """Verify an ECDSA P-256/SHA-256 signature.

    WebCrypto produces IEEE P1363 signatures (raw r||s, 64 bytes); `cryptography` expects DER,
    so we convert. DER signatures are accepted too.
    """
    key = serialization.load_pem_public_key(public_key_pem.encode())
    if not isinstance(key, ec.EllipticCurvePublicKey):
        return False
    try:
        raw = base64.b64decode(signature_b64, validate=True)
    except ValueError:
        return False
    if len(raw) == 64:
        r = int.from_bytes(raw[:32], "big")
        s = int.from_bytes(raw[32:], "big")
        raw = encode_dss_signature(r, s)
    try:
        key.verify(raw, message, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        return False
    return True


def public_key_to_pem(key: ec.EllipticCurvePublicKey) -> str:
    return key.public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
