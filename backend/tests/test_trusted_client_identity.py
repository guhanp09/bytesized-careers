"""Who a request counts as, when a header claims otherwise.

Every rate limit in this product counts against a client identity, so the value
that identity is derived from decides whether any of those limits mean anything.
`X-Forwarded-For` is written by whoever is talking to us. Believing it
unconditionally — which is what this code used to do — turns every limit into a
suggestion: send a different value, get a different bucket, and the login,
registration and strong-authentication limits all stop counting.

The rule is that a forwarded header is evidence only when the peer that handed
it over is a proxy we put there ourselves, and that the chain is read from the
right, because that is the end our own infrastructure wrote.
"""

from __future__ import annotations

import pytest

from app.core import rate_limit
from app.core.rate_limit import client_identity


class _FakeClient:
    def __init__(self, host: str) -> None:
        self.host = host


class _FakeRequest:
    """Only the two things the derivation reads."""

    def __init__(self, *, peer: str | None, headers: dict[str, str] | None = None) -> None:
        self.client = _FakeClient(peer) if peer is not None else None
        self.headers = headers or {}


@pytest.fixture
def trusted(monkeypatch: pytest.MonkeyPatch):
    """Configure the proxies in front of us, bypassing the cached lookup."""

    def _configure(raw: str | None) -> None:
        monkeypatch.setattr(
            rate_limit,
            "_trusted_proxies",
            lambda: rate_limit._parse_networks(raw),
        )

    return _configure


class TestWithNoProxyConfigured:
    def test_the_socket_is_the_identity(self, trusted) -> None:
        trusted(None)

        assert client_identity(_FakeRequest(peer="203.0.113.9")) == "203.0.113.9"

    def test_a_forwarded_header_from_a_stranger_is_ignored(self, trusted) -> None:
        # This is the defect. Without a configured proxy there is nobody who
        # could legitimately have written this header, so it is just a string.
        trusted(None)

        request = _FakeRequest(peer="203.0.113.9", headers={"x-forwarded-for": "1.2.3.4"})

        assert client_identity(request) == "203.0.113.9"

    def test_a_caller_cannot_mint_a_fresh_bucket_per_request(self, trusted) -> None:
        trusted(None)

        identities = {
            client_identity(
                _FakeRequest(peer="203.0.113.9", headers={"x-forwarded-for": f"10.0.0.{n}"})
            )
            for n in range(1, 25)
        }

        # One caller, one identity, however many values they invent.
        assert identities == {"203.0.113.9"}


class TestBehindAConfiguredProxy:
    def test_the_forwarded_client_is_used(self, trusted) -> None:
        trusted("10.0.0.0/8")

        request = _FakeRequest(peer="10.0.0.7", headers={"x-forwarded-for": "203.0.113.9"})

        assert client_identity(request) == "203.0.113.9"

    def test_the_chain_is_read_from_the_right(self, trusted) -> None:
        # Each hop appends, so the rightmost entries are the ones our own
        # infrastructure wrote. Anything further left the client may have sent.
        trusted("10.0.0.0/8")

        request = _FakeRequest(
            peer="10.0.0.7",
            headers={"x-forwarded-for": "1.1.1.1, 203.0.113.9, 10.0.0.3"},
        )

        assert client_identity(request) == "203.0.113.9"

    def test_a_client_supplied_prefix_cannot_be_reached(self, trusted) -> None:
        # A caller who sends `X-Forwarded-For: 9.9.9.9` gets their real address
        # appended to the right by the proxy; the forged entry stays left of it
        # and is never selected.
        trusted("10.0.0.0/8")

        request = _FakeRequest(
            peer="10.0.0.7",
            headers={"x-forwarded-for": "9.9.9.9, 203.0.113.9"},
        )

        assert client_identity(request) == "203.0.113.9"

    def test_an_exact_address_is_accepted_as_configuration(self, trusted) -> None:
        trusted("10.0.0.7")

        request = _FakeRequest(peer="10.0.0.7", headers={"x-forwarded-for": "203.0.113.9"})

        assert client_identity(request) == "203.0.113.9"

    def test_a_proxy_that_forwarded_nothing_falls_back_to_the_socket(self, trusted) -> None:
        trusted("10.0.0.0/8")

        assert client_identity(_FakeRequest(peer="10.0.0.7")) == "10.0.0.7"

    def test_an_all_proxy_chain_falls_back_to_the_socket(self, trusted) -> None:
        trusted("10.0.0.0/8")

        request = _FakeRequest(peer="10.0.0.7", headers={"x-forwarded-for": "10.0.0.3, 10.0.0.4"})

        assert client_identity(request) == "10.0.0.7"

    def test_a_connection_that_skipped_the_proxy_is_not_trusted(self, trusted) -> None:
        trusted("10.0.0.0/8")

        request = _FakeRequest(peer="203.0.113.9", headers={"x-forwarded-for": "1.2.3.4"})

        assert client_identity(request) == "203.0.113.9"

    @pytest.mark.parametrize(
        "forwarded",
        ["not-an-ip", "", "   ", "1.2.3.4.5", "<script>", "203.0.113.9:8080"],
    )
    def test_a_malformed_hop_is_not_an_identity(self, trusted, forwarded: str) -> None:
        trusted("10.0.0.0/8")

        request = _FakeRequest(peer="10.0.0.7", headers={"x-forwarded-for": forwarded})

        assert client_identity(request) == "10.0.0.7"

    def test_a_malformed_hop_does_not_expose_the_entries_behind_it(self, trusted) -> None:
        # Reaching further left past something unparseable would let a caller
        # place a value where it would be read.
        trusted("10.0.0.0/8")

        request = _FakeRequest(
            peer="10.0.0.7",
            headers={"x-forwarded-for": "9.9.9.9, not-an-ip"},
        )

        assert client_identity(request) == "10.0.0.7"

    def test_one_address_cannot_hold_two_buckets(self, trusted) -> None:
        # `::ffff:203.0.113.9` and `203.0.113.9` are the same caller, and two
        # spellings would otherwise be two allowances.
        trusted("10.0.0.0/8")

        mapped = _FakeRequest(peer="10.0.0.7", headers={"x-forwarded-for": "::ffff:203.0.113.9"})
        plain = _FakeRequest(peer="10.0.0.7", headers={"x-forwarded-for": "203.0.113.9"})

        assert client_identity(mapped) == client_identity(plain)

    def test_an_ipv6_proxy_and_client_work(self, trusted) -> None:
        # The client address deliberately sits outside the proxy block — an
        # address inside it would be skipped as one of our own hops, which is
        # correct behaviour and would make this test prove nothing.
        trusted("2001:db8::/32")

        request = _FakeRequest(
            peer="2001:db8::1",
            headers={"x-forwarded-for": "2606:4700::1111, 2001:db8::2"},
        )

        assert client_identity(request) == "2606:4700::1111"


class TestConfigurationParsing:
    def test_a_typo_narrows_trust_rather_than_widening_it(self) -> None:
        networks = rate_limit._parse_networks("10.0.0.0/8, not-a-network, 192.168.0.0/16")

        assert len(networks) == 2

    def test_nothing_configured_trusts_nothing(self) -> None:
        for raw in [None, "", "   ", ",", "garbage"]:
            assert rate_limit._parse_networks(raw) == () or all(
                not rate_limit._is_trusted("1.2.3.4", rate_limit._parse_networks(raw))
                for _ in (0,)
            )

    def test_a_request_with_no_peer_is_still_countable(self, trusted) -> None:
        # Better one shared bucket than an unbounded one.
        trusted("10.0.0.0/8")

        assert client_identity(_FakeRequest(peer=None)) == "unknown"
