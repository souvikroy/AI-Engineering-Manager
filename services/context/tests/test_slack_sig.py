"""HMAC signature verification for /ingest/slack."""
from __future__ import annotations

import hashlib
import hmac
import time

import pytest

from app.security.slack_sig import _verify_signature, REPLAY_WINDOW_SEC


SECRET = "v0_test_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"


def _signed(secret: str, body: bytes, ts: int) -> str:
    base = b"v0:" + str(ts).encode() + b":" + body
    return "v0=" + hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()


def test_valid_signature_passes():
    body = b'{"event":{"type":"message","text":"hi"}}'
    ts = int(time.time())
    sig = _signed(SECRET, body, ts)
    assert _verify_signature(secret=SECRET, timestamp=str(ts), body=body, signature=sig)


def test_tampered_body_fails():
    body = b'{"event":{"type":"message","text":"hi"}}'
    ts = int(time.time())
    sig = _signed(SECRET, body, ts)
    tampered = body.replace(b"hi", b"haxx0r")
    assert not _verify_signature(secret=SECRET, timestamp=str(ts), body=tampered, signature=sig)


def test_wrong_secret_fails():
    body = b'{"event":{"type":"message","text":"hi"}}'
    ts = int(time.time())
    sig = _signed("other-secret", body, ts)
    assert not _verify_signature(secret=SECRET, timestamp=str(ts), body=body, signature=sig)


def test_replay_outside_window_fails():
    body = b'{"event":{"type":"message"}}'
    ts = int(time.time()) - (REPLAY_WINDOW_SEC + 60)
    sig = _signed(SECRET, body, ts)
    assert not _verify_signature(secret=SECRET, timestamp=str(ts), body=body, signature=sig)


@pytest.mark.parametrize(
    "ts,sig",
    [
        ("notanumber", "v0=abc"),
        (str(int(time.time())), "v0=deadbeef"),  # right format, wrong digest
        (str(int(time.time())), "garbage"),
    ],
)
def test_malformed_inputs_fail(ts, sig):
    assert not _verify_signature(
        secret=SECRET, timestamp=ts, body=b"{}", signature=sig
    )
