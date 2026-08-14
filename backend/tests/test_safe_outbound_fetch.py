from __future__ import annotations

import asyncio
import gzip
import ipaddress
from dataclasses import replace

import httpcore
import httpx
import pytest

from app.services.safe_outbound_fetch import (
    SafeOutboundFetcher,
    SafeOutboundFetchError,
    SafeOutboundFetchPolicy,
    ValidatedOutboundDestination,
    _PinnedNetworkBackend,
    is_public_outbound_address,
)


async def _public_resolver(_hostname: str, _port: int):
    return [ipaddress.ip_address("93.184.216.34")]


def _policy(**changes) -> SafeOutboundFetchPolicy:
    base = SafeOutboundFetchPolicy(
        max_response_bytes=128,
        allowed_content_types=frozenset({"text/html", "text/plain"}),
        user_agent="CreatorJobs-SecurityTest/1.0",
        accept="text/html, text/plain",
        max_redirects=2,
        connect_timeout_seconds=0.5,
        read_timeout_seconds=0.5,
        total_timeout_seconds=1.0,
        dns_timeout_seconds=0.5,
    )
    return replace(base, **changes)


@pytest.mark.parametrize(
    "raw_address",
    [
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.0.0.1",
        "192.0.2.1",
        "192.168.0.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "240.0.0.1",
        "::",
        "::1",
        "fc00::1",
        "fe80::1",
        "ff02::1",
        "2001:db8::1",
        "::ffff:127.0.0.1",
        "::ffff:224.0.0.1",
        "2002:7f00:1::",
        "2002:e000:1::",
        "64:ff9b::127.0.0.1",
        "64:ff9b::8.8.8.8",
        "64:ff9b::224.0.0.1",
    ],
)
def test_non_public_and_transition_addresses_are_rejected(raw_address: str) -> None:
    assert is_public_outbound_address(ipaddress.ip_address(raw_address)) is False


@pytest.mark.parametrize(
    "raw_address",
    ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"],
)
def test_genuinely_public_addresses_are_accepted(raw_address: str) -> None:
    assert is_public_outbound_address(ipaddress.ip_address(raw_address)) is True


def test_policy_cannot_expand_the_non_negotiable_public_port_boundary() -> None:
    with pytest.raises(ValueError, match="HTTP 80 and HTTPS 443"):
        _policy(allowed_ports=frozenset({22, 80, 443}))


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("", "URL_INVALID"),
        ("file:///etc/passwd", "SCHEME_UNSUPPORTED"),
        ("ftp://example.com/file", "SCHEME_UNSUPPORTED"),
        ("https://user:secret@example.com/", "CREDENTIALS_FORBIDDEN"),
        ("http://localhost/", "HOST_UNSAFE"),
        ("http://service/", "HOST_UNSAFE"),
        ("http://service.internal/", "HOST_UNSAFE"),
        ("http://printer.local/", "HOST_UNSAFE"),
        ("http://metadata.home.arpa/", "HOST_UNSAFE"),
        ("http://bad_host.example/", "HOST_UNSAFE"),
        ("http://example.com\\@127.0.0.1/", "URL_INVALID"),
        ("http://example.com/\nmetadata", "URL_INVALID"),
        ("http://93.184.216.34:0/", "PORT_UNSAFE"),
        ("http://93.184.216.34:22/", "PORT_UNSAFE"),
        ("http://93.184.216.34:2375/", "PORT_UNSAFE"),
        ("http://93.184.216.34:5432/", "PORT_UNSAFE"),
        ("http://93.184.216.34:8080/", "PORT_UNSAFE"),
        ("http://169.254.169.254/latest/meta-data", "DESTINATION_UNSAFE"),
        ("http://[::1]/", "DESTINATION_UNSAFE"),
        ("http://[64:ff9b::127.0.0.1]/", "DESTINATION_UNSAFE"),
    ],
)
async def test_destination_validation_rejects_unsafe_url_forms(url: str, code: str) -> None:
    fetcher = SafeOutboundFetcher(resolver=_public_resolver)
    with pytest.raises(SafeOutboundFetchError) as caught:
        await fetcher.validate_destination(url, _policy())
    assert caught.value.code == code


async def test_destination_normalizes_idna_trailing_dot_fragment_and_default_port() -> None:
    calls: list[tuple[str, int]] = []

    async def resolver(hostname: str, port: int):
        calls.append((hostname, port))
        return [ipaddress.ip_address("93.184.216.34")]

    destination = await SafeOutboundFetcher(resolver=resolver).validate_destination(
        " HTTPS://BÜCHER.example.:443/jobs?q=one#ignored ",
        _policy(),
    )

    assert destination.url == "https://xn--bcher-kva.example:443/jobs?q=one"
    assert destination.hostname == "xn--bcher-kva.example"
    assert destination.port == 443
    assert calls == [("xn--bcher-kva.example", 443)]


async def test_destination_rejects_mixed_public_private_dns_answers() -> None:
    async def mixed_resolver(_hostname: str, _port: int):
        return [
            ipaddress.ip_address("93.184.216.34"),
            ipaddress.ip_address("10.0.0.5"),
        ]

    with pytest.raises(SafeOutboundFetchError) as caught:
        await SafeOutboundFetcher(resolver=mixed_resolver).validate_destination(
            "https://public.example/",
            _policy(),
        )
    assert caught.value.code == "DESTINATION_UNSAFE"


@pytest.mark.parametrize("answer", [[], ["not-an-ip"]])
async def test_destination_rejects_empty_or_malformed_dns_answers(answer: list[object]) -> None:
    async def resolver(_hostname: str, _port: int):
        return answer

    with pytest.raises(SafeOutboundFetchError) as caught:
        await SafeOutboundFetcher(resolver=resolver).validate_destination(
            "https://public.example/",
            _policy(),
        )
    assert caught.value.code == "DNS_FAILED"


async def test_destination_bounds_dns_resolution_time() -> None:
    async def stalled_resolver(_hostname: str, _port: int):
        await asyncio.sleep(1)
        return [ipaddress.ip_address("93.184.216.34")]

    with pytest.raises(SafeOutboundFetchError) as caught:
        await SafeOutboundFetcher(resolver=stalled_resolver).validate_destination(
            "https://public.example/",
            _policy(dns_timeout_seconds=0.01),
        )
    assert caught.value.code == "DNS_TIMEOUT"


class _UnusedStream(httpcore.AsyncNetworkStream):
    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return b""

    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        return None

    async def aclose(self) -> None:
        return None

    async def start_tls(
        self,
        ssl_context,
        server_hostname: str | None = None,
        timeout: float | None = None,
    ) -> httpcore.AsyncNetworkStream:
        return self


class _RecordingNetworkBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, *, fail_first: bool = False) -> None:
        self.calls: list[tuple[str, int]] = []
        self.fail_first = fail_first

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ) -> httpcore.AsyncNetworkStream:
        self.calls.append((host, port))
        if self.fail_first and len(self.calls) == 1:
            raise httpcore.ConnectError("first address unavailable")
        return _UnusedStream()

    async def connect_unix_socket(self, path: str, timeout=None, socket_options=None):
        raise AssertionError("Unix sockets must never be attempted")

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(0)


async def test_pinned_backend_connects_to_validated_ips_not_a_second_dns_name() -> None:
    delegate = _RecordingNetworkBackend(fail_first=True)
    backend = _PinnedNetworkBackend(
        hostname="public.example",
        port=443,
        addresses=(
            ipaddress.ip_address("93.184.216.34"),
            ipaddress.ip_address("8.8.8.8"),
        ),
        delegate=delegate,
    )

    stream = await backend.connect_tcp("public.example", 443)

    assert isinstance(stream, _UnusedStream)
    assert delegate.calls == [("93.184.216.34", 443), ("8.8.8.8", 443)]


@pytest.mark.parametrize(
    ("hostname", "port"),
    [("rebound.example", 443), ("public.example", 80)],
)
async def test_pinned_backend_rejects_any_connection_escape(hostname: str, port: int) -> None:
    delegate = _RecordingNetworkBackend()
    backend = _PinnedNetworkBackend(
        hostname="public.example",
        port=443,
        addresses=(ipaddress.ip_address("93.184.216.34"),),
        delegate=delegate,
    )

    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp(hostname, port)
    assert delegate.calls == []


class _PeerStream:
    def __init__(self, address: tuple[str, int] | None) -> None:
        self.address = address

    def get_extra_info(self, name: str):
        return self.address if name == "server_addr" else None


def test_connected_peer_must_equal_a_validated_address_and_port() -> None:
    destination = ValidatedOutboundDestination(
        url="https://public.example/",
        hostname="public.example",
        port=443,
        addresses=(ipaddress.ip_address("93.184.216.34"),),
    )
    good = httpx.Response(
        200,
        extensions={"network_stream": _PeerStream(("93.184.216.34", 443))},
    )
    assert SafeOutboundFetcher._connected_address(good, destination, require_peer=True) == (
        "93.184.216.34"
    )

    for peer in [("10.0.0.1", 443), ("93.184.216.34", 80), None]:
        response = httpx.Response(200, extensions={"network_stream": _PeerStream(peer)})
        with pytest.raises(SafeOutboundFetchError) as caught:
            SafeOutboundFetcher._connected_address(response, destination, require_peer=True)
        assert caught.value.code in {"PEER_MISMATCH", "PEER_UNVERIFIED"}


async def test_fetch_revalidates_every_redirect_and_never_reaches_private_target() -> None:
    requests: list[str] = []

    def redirect_to_metadata(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        return httpx.Response(
            302,
            headers={"Location": "http://169.254.169.254/latest/meta-data"},
            request=request,
        )

    fetcher = SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(redirect_to_metadata),
    )
    with pytest.raises(SafeOutboundFetchError) as caught:
        await fetcher.fetch("https://public.example/start", _policy())
    assert caught.value.code == "DESTINATION_UNSAFE"
    assert requests == ["https://public.example/start"]


async def test_fetch_rejects_missing_location_and_redirect_overflow() -> None:
    missing = SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(lambda request: httpx.Response(302, request=request)),
    )
    with pytest.raises(SafeOutboundFetchError) as missing_error:
        await missing.fetch("https://public.example/", _policy())
    assert missing_error.value.code == "REDIRECT_INVALID"

    attempts: list[int] = []

    def loop(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        return httpx.Response(302, headers={"Location": "/again"}, request=request)

    looping = SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(loop),
    )
    with pytest.raises(SafeOutboundFetchError) as loop_error:
        await looping.fetch("https://public.example/", _policy(max_redirects=2))
    assert loop_error.value.code == "TOO_MANY_REDIRECTS"
    assert len(attempts) == 3


async def test_redirects_do_not_forward_set_cookie_or_credentials() -> None:
    seen: list[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers)
        if len(seen) == 1:
            return httpx.Response(
                302,
                headers={"Location": "https://other.example/final", "Set-Cookie": "secret=1"},
                request=request,
            )
        return httpx.Response(
            200,
            content=b"public body",
            headers={"Content-Type": "text/plain"},
            request=request,
        )

    result = await SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(handler),
    ).fetch("https://public.example/start", _policy())

    assert result.final_url == "https://other.example/final"
    assert result.redirect_count == 1
    assert len(seen) == 2
    assert all("authorization" not in headers for headers in seen)
    assert all("proxy-authorization" not in headers for headers in seen)
    assert all("cookie" not in headers for headers in seen)


@pytest.mark.parametrize(
    ("headers", "body", "code"),
    [
        ({}, b"text", "CONTENT_TYPE_UNSUPPORTED"),
        ({"Content-Type": "application/octet-stream"}, b"binary", "CONTENT_TYPE_UNSUPPORTED"),
        ({"Content-Type": "text/plain", "Content-Length": "129"}, b"", "RESPONSE_TOO_LARGE"),
        ({"Content-Type": "text/plain"}, b"x" * 129, "RESPONSE_TOO_LARGE"),
    ],
)
async def test_fetch_enforces_content_type_and_decoded_body_ceiling(
    headers: dict[str, str],
    body: bytes,
    code: str,
) -> None:
    fetcher = SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, headers=headers, content=body, request=request)
        ),
    )
    with pytest.raises(SafeOutboundFetchError) as caught:
        await fetcher.fetch("https://public.example/", _policy())
    assert caught.value.code == code


async def test_fetch_accepts_exact_byte_ceiling_and_normalizes_content_type() -> None:
    body = b"x" * 128
    result = await SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"Content-Type": "Text/Plain; charset=utf-8"},
                content=body,
                request=request,
            )
        ),
    ).fetch("https://public.example/", _policy())

    assert result.body == body
    assert result.content_type == "text/plain"
    assert result.status_code == 200


async def test_fetch_bounds_decompressed_content_not_only_the_wire_length() -> None:
    compressed = gzip.compress(b"x" * 1024)
    assert len(compressed) < 128
    fetcher = SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={
                    "Content-Type": "text/plain",
                    "Content-Encoding": "gzip",
                    "Content-Length": str(len(compressed)),
                },
                content=compressed,
                request=request,
            )
        ),
    )

    with pytest.raises(SafeOutboundFetchError) as caught:
        await fetcher.fetch("https://public.example/", _policy())
    assert caught.value.code == "RESPONSE_TOO_LARGE"


async def test_error_status_is_returned_without_reading_or_type_trusting_its_body() -> None:
    result = await SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                403,
                headers={"Content-Type": "application/octet-stream"},
                content=b"sensitive or enormous error body",
                request=request,
            )
        ),
    ).fetch("https://public.example/", _policy())

    assert result.status_code == 403
    assert result.body == b""


async def test_fetch_maps_operation_and_total_timeouts_to_one_bounded_error() -> None:
    def operation_timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("fixture timeout")

    operation_fetcher = SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(operation_timeout),
    )
    with pytest.raises(SafeOutboundFetchError) as operation_error:
        await operation_fetcher.fetch("https://public.example/", _policy())
    assert operation_error.value.code == "TIMEOUT"

    async def slow_response(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.1)
        return httpx.Response(
            200,
            content=b"late",
            headers={"Content-Type": "text/plain"},
            request=request,
        )

    total_fetcher = SafeOutboundFetcher(
        resolver=_public_resolver,
        transport=httpx.MockTransport(slow_response),
    )
    with pytest.raises(SafeOutboundFetchError) as total_error:
        await total_fetcher.fetch(
            "https://public.example/",
            _policy(total_timeout_seconds=0.01),
        )
    assert total_error.value.code == "TIMEOUT"


async def test_real_transport_pins_validated_ip_preserves_host_and_ignores_proxies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[bytes] = []

    async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        request = await reader.readuntil(b"\r\n\r\n")
        requests.append(request)
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/plain\r\n"
            b"Content-Length: 12\r\n"
            b"Connection: close\r\n\r\n"
            b"public reply"
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("ALL_PROXY", "http://127.0.0.1:1")

    async def loopback_resolver(hostname: str, resolved_port: int):
        assert hostname == "public.example"
        assert resolved_port == port
        return [ipaddress.ip_address("127.0.0.1")]

    try:
        result = await SafeOutboundFetcher(
            resolver=loopback_resolver,
            allow_test_loopback=True,
        ).fetch(f"http://public.example:{port}/proof", _policy())
    finally:
        server.close()
        await server.wait_closed()

    assert result.body == b"public reply"
    assert result.connected_address == "127.0.0.1"
    assert len(requests) == 1
    assert f"Host: public.example:{port}\r\n".encode() in requests[0]
    assert b"Authorization:" not in requests[0]
    assert b"Cookie:" not in requests[0]
