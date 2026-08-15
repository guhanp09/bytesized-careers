"""One fail-closed network boundary for fetching user-influenced public URLs.

The important distinction in an SSRF defence is between *checking* DNS and
*using* the checked answer.  Resolving a hostname, deciding that it is public,
and then handing the hostname to an ordinary HTTP client leaves a second DNS
lookup at connect time.  An attacker can change that second answer.

This module resolves every hop itself and gives httpcore a network backend that
can connect only to the validated addresses.  The original hostname remains in
the HTTP URL, Host header, TLS SNI, and certificate verification; only the TCP
destination is pinned.  Redirects receive a fresh validation and a fresh
connection pool, so neither DNS state nor cookies carry across hops.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpcore
import httpx

DEFAULT_ALLOWED_PORTS = frozenset({80, 443})
DEFAULT_MAX_URL_LENGTH = 4096
DEFAULT_DNS_TIMEOUT_SECONDS = 3.0
MAX_DNS_ADDRESSES = 16
MAX_REDIRECT_LOCATION_LENGTH = 4096

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_FORBIDDEN_REQUEST_HEADERS = frozenset(
    {
        "authorization",
        "cookie",
        "host",
        "proxy-authorization",
        "proxy-connection",
    }
)
_LOCAL_HOST_SUFFIXES = (
    ".internal",
    ".local",
    ".localhost",
    ".home.arpa",
)
_DOMAIN_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_NAT64_WELL_KNOWN = ipaddress.ip_network("64:ff9b::/96")
_NAT64_LOCAL_USE = ipaddress.ip_network("64:ff9b:1::/48")

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str, int], Awaitable[list[IPAddress]]]


class SafeOutboundFetchError(Exception):
    """A stable, non-sensitive failure from the outbound network boundary."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class SafeOutboundFetchPolicy:
    """Per-feature limits layered on top of the non-negotiable SSRF policy."""

    max_response_bytes: int
    allowed_content_types: frozenset[str]
    user_agent: str
    accept: str
    max_redirects: int = 3
    connect_timeout_seconds: float = 5.0
    read_timeout_seconds: float = 8.0
    total_timeout_seconds: float = 15.0
    dns_timeout_seconds: float = DEFAULT_DNS_TIMEOUT_SECONDS
    allowed_ports: frozenset[int] = field(default_factory=lambda: DEFAULT_ALLOWED_PORTS)
    max_url_length: int = DEFAULT_MAX_URL_LENGTH
    #: An extra, caller-owned constraint on every destination.
    #:
    #: Some callers may reach only a specific set of pages — a hiring-identity
    #: verification may read a creator's own YouTube or Instagram profile and
    #: nothing else. That rule is product policy and does not belong in a generic
    #: network primitive, but it has to be enforced where the redirects are
    #: resolved: checking it only around the first call leaves the caller's
    #: allowlist satisfied by an unrelated site the first hop redirected to.
    #:
    #: So the caller supplies the predicate and this class decides *when* it
    #: runs: on the entered URL and again on every hop, before a connection is
    #: opened. It receives the normalized absolute URL. Returning False fails the
    #: fetch closed; raising is treated the same way. Default is None, which
    #: leaves the generic policy exactly as it was.
    destination_allowed: Callable[[str], bool] | None = None

    def __post_init__(self) -> None:
        if self.max_response_bytes <= 0:
            raise ValueError("max_response_bytes must be positive")
        if not self.allowed_content_types:
            raise ValueError("allowed_content_types must not be empty")
        normalized_types = frozenset(item.strip().casefold() for item in self.allowed_content_types)
        if any(not item or "/" not in item for item in normalized_types):
            raise ValueError("allowed_content_types contains an invalid media type")
        object.__setattr__(self, "allowed_content_types", normalized_types)
        if not self.user_agent.strip() or _has_control_character(self.user_agent):
            raise ValueError("user_agent must be a safe non-empty header value")
        if not self.accept.strip() or _has_control_character(self.accept):
            raise ValueError("accept must be a safe non-empty header value")
        if self.max_redirects < 0 or self.max_redirects > 10:
            raise ValueError("max_redirects must be between 0 and 10")
        if any(
            value <= 0
            for value in (
                self.connect_timeout_seconds,
                self.read_timeout_seconds,
                self.total_timeout_seconds,
                self.dns_timeout_seconds,
            )
        ):
            raise ValueError("outbound timeouts must be positive")
        if not self.allowed_ports or any(port < 1 or port > 65535 for port in self.allowed_ports):
            raise ValueError("allowed_ports must contain valid TCP ports")
        if not self.allowed_ports.issubset(DEFAULT_ALLOWED_PORTS):
            raise ValueError("public outbound ports are limited to HTTP 80 and HTTPS 443")
        if self.max_url_length < 256:
            raise ValueError("max_url_length is unreasonably small")


@dataclass(frozen=True)
class ValidatedOutboundDestination:
    url: str
    hostname: str
    port: int
    addresses: tuple[IPAddress, ...]


@dataclass(frozen=True)
class SafeOutboundResponse:
    entered_url: str
    final_url: str
    status_code: int
    content_type: str
    encoding: str
    body: bytes
    redirect_count: int
    connected_address: str | None


def _has_control_character(value: str) -> bool:
    return any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)


def _embedded_ipv4_addresses(address: ipaddress.IPv6Address) -> tuple[ipaddress.IPv4Address, ...]:
    embedded: list[ipaddress.IPv4Address] = []
    if address.ipv4_mapped is not None:
        embedded.append(address.ipv4_mapped)
    if address.sixtofour is not None:
        embedded.append(address.sixtofour)
    if address.teredo is not None:
        server, client = address.teredo
        embedded.extend((server, client))
    if address in _NAT64_WELL_KNOWN:
        embedded.append(ipaddress.IPv4Address(int(address) & 0xFFFFFFFF))
    if address in _NAT64_LOCAL_USE:
        embedded.append(ipaddress.IPv4Address(int(address) & 0xFFFFFFFF))
    return tuple(dict.fromkeys(embedded))


def is_public_outbound_address(address: IPAddress) -> bool:
    """Return true only for globally routable addresses without unsafe tunnels."""

    # ``ipaddress.is_global`` is intentionally not the only check: on supported
    # Python releases multicast addresses can report global scope even though
    # they are never valid public web-server destinations.
    if (
        not address.is_global
        or address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        return False
    if isinstance(address, ipaddress.IPv6Address):
        if address.scope_id is not None:
            return False
        if any(
            not is_public_outbound_address(embedded)
            for embedded in _embedded_ipv4_addresses(address)
        ):
            return False
    return True


async def default_public_resolver(hostname: str, port: int) -> list[IPAddress]:
    loop = asyncio.get_running_loop()
    try:
        rows = await loop.getaddrinfo(
            hostname,
            port,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise SafeOutboundFetchError(
            "DNS_FAILED",
            "The public address could not be resolved.",
        ) from exc

    addresses: list[IPAddress] = []
    for row in rows:
        raw_address = row[4][0]
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError:
            continue
        if address not in addresses:
            addresses.append(address)
        if len(addresses) >= MAX_DNS_ADDRESSES:
            break
    if not addresses:
        raise SafeOutboundFetchError(
            "DNS_FAILED",
            "The public address could not be resolved.",
        )
    return addresses


def _normalized_hostname(raw_hostname: str) -> tuple[str, IPAddress | None]:
    hostname = raw_hostname.rstrip(".").casefold()
    if not hostname:
        raise SafeOutboundFetchError("URL_INVALID", "Enter a valid public URL.")
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        try:
            hostname = hostname.encode("idna").decode("ascii")
        except UnicodeError as exc:
            raise SafeOutboundFetchError("URL_INVALID", "Enter a valid public URL.") from exc
        labels = hostname.split(".")
        if len(labels) < 2 or any(not _DOMAIN_LABEL.fullmatch(label) for label in labels):
            raise SafeOutboundFetchError(
                "HOST_UNSAFE", "That address is not a public website."
            ) from None
        if hostname == "localhost" or hostname.endswith(_LOCAL_HOST_SUFFIXES):
            raise SafeOutboundFetchError(
                "HOST_UNSAFE", "That address is not a public website."
            ) from None
        return hostname, None
    return hostname, literal


def _canonical_netloc(hostname: str, port: int, *, explicit_port: bool) -> str:
    rendered_host = f"[{hostname}]" if ":" in hostname else hostname
    return f"{rendered_host}:{port}" if explicit_port else rendered_host


class _PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Resolve nothing: connect only to addresses approved for this URL hop."""

    def __init__(
        self,
        *,
        hostname: str,
        port: int,
        addresses: Iterable[IPAddress],
        delegate: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        self._hostname = hostname.casefold()
        self._port = port
        self._addresses = tuple(str(address) for address in addresses)
        self._delegate = delegate or httpcore.AnyIOBackend()
        if not self._addresses:
            raise ValueError("a pinned backend requires at least one address")

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        if host.rstrip(".").casefold() != self._hostname or port != self._port:
            raise httpcore.ConnectError("outbound connection escaped its validated destination")

        last_error: httpcore.ConnectError | httpcore.ConnectTimeout | None = None
        for address in self._addresses:
            try:
                return await self._delegate.connect_tcp(
                    address,
                    port,
                    timeout=timeout,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise httpcore.ConnectError("the validated destination had no connectable address")

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise httpcore.UnsupportedProtocol("Unix sockets are forbidden for public URL fetches")

    async def sleep(self, seconds: float) -> None:
        await self._delegate.sleep(seconds)


class _CoreResponseStream(httpx.AsyncByteStream):
    def __init__(self, stream: object) -> None:
        self._stream = stream

    async def __aiter__(self):
        async for part in self._stream:  # type: ignore[attr-defined]
            yield part

    async def aclose(self) -> None:
        close = getattr(self._stream, "aclose", None)
        if close is not None:
            await close()


class _PinnedAsyncHTTPTransport(httpx.AsyncBaseTransport):
    """Small public-API adapter around an httpcore pool with pinned DNS."""

    def __init__(
        self,
        destination: ValidatedOutboundDestination,
        *,
        network_backend: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        backend = _PinnedNetworkBackend(
            hostname=destination.hostname,
            port=destination.port,
            addresses=destination.addresses,
            delegate=network_backend,
        )
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(verify=True, trust_env=False),
            max_connections=1,
            max_keepalive_connections=0,
            http1=True,
            http2=False,
            retries=0,
            network_backend=backend,
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if not isinstance(request.stream, httpx.AsyncByteStream):
            raise TypeError("safe outbound requests require an asynchronous byte stream")
        core_request = httpcore.Request(
            method=request.method,
            url=httpcore.URL(
                scheme=request.url.raw_scheme,
                host=request.url.raw_host,
                port=request.url.port,
                target=request.url.raw_path,
            ),
            headers=request.headers.raw,
            content=request.stream,
            extensions=request.extensions,
        )
        core_response = await self._pool.handle_async_request(core_request)
        return httpx.Response(
            status_code=core_response.status,
            headers=core_response.headers,
            stream=_CoreResponseStream(core_response.stream),
            extensions=core_response.extensions,
        )

    async def aclose(self) -> None:
        await self._pool.aclose()


class SafeOutboundFetcher:
    """Fetch bounded public content without trusting ambient network state."""

    def __init__(
        self,
        *,
        resolver: Resolver = default_public_resolver,
        transport: httpx.AsyncBaseTransport | None = None,
        allow_test_loopback: bool = False,
    ) -> None:
        self._resolver = resolver
        self._transport = transport
        self._allow_test_loopback = allow_test_loopback

    async def validate_destination(
        self,
        raw_url: str,
        policy: SafeOutboundFetchPolicy,
    ) -> ValidatedOutboundDestination:
        value = raw_url.strip()
        if not value or len(value) > policy.max_url_length:
            raise SafeOutboundFetchError("URL_INVALID", "Enter a valid public URL.")
        if _has_control_character(value) or "\\" in value:
            raise SafeOutboundFetchError("URL_INVALID", "Enter a valid public URL.")
        try:
            parts = urlsplit(value)
            explicit_port = parts.port is not None
            port = parts.port
        except ValueError as exc:
            raise SafeOutboundFetchError("URL_INVALID", "Enter a valid public URL.") from exc
        scheme = parts.scheme.casefold()
        if scheme not in {"http", "https"}:
            raise SafeOutboundFetchError(
                "SCHEME_UNSUPPORTED",
                "Only public HTTP and HTTPS URLs are supported.",
            )
        if parts.username is not None or parts.password is not None:
            raise SafeOutboundFetchError(
                "CREDENTIALS_FORBIDDEN",
                "URLs containing usernames or passwords are not supported.",
            )
        if not parts.hostname:
            raise SafeOutboundFetchError("URL_INVALID", "Enter a valid public URL.")

        hostname, literal = _normalized_hostname(parts.hostname)
        resolved_port = port if port is not None else (443 if scheme == "https" else 80)
        if resolved_port not in policy.allowed_ports and not self._allow_test_loopback:
            raise SafeOutboundFetchError("PORT_UNSAFE", "That network port is not allowed.")
        addresses: list[IPAddress]
        if literal is not None:
            addresses = [literal]
        else:
            try:
                async with asyncio.timeout(policy.dns_timeout_seconds):
                    addresses = await self._resolver(hostname, resolved_port)
            except SafeOutboundFetchError:
                raise
            except TimeoutError as exc:
                raise SafeOutboundFetchError(
                    "DNS_TIMEOUT",
                    "The public address took too long to resolve.",
                ) from exc
            except (OSError, ValueError) as exc:
                raise SafeOutboundFetchError(
                    "DNS_FAILED",
                    "The public address could not be resolved.",
                ) from exc

        unique_addresses: list[IPAddress] = []
        for raw_address in addresses[:MAX_DNS_ADDRESSES]:
            try:
                address = (
                    raw_address
                    if isinstance(raw_address, (ipaddress.IPv4Address, ipaddress.IPv6Address))
                    else ipaddress.ip_address(raw_address)
                )
            except ValueError as exc:
                raise SafeOutboundFetchError(
                    "DNS_FAILED",
                    "The public address could not be resolved.",
                ) from exc
            if address not in unique_addresses:
                unique_addresses.append(address)
        if not unique_addresses:
            raise SafeOutboundFetchError("DNS_FAILED", "The public address could not be resolved.")

        unsafe = [address for address in unique_addresses if not is_public_outbound_address(address)]
        test_loopback = bool(
            self._allow_test_loopback
            and unique_addresses
            and all(address.is_loopback for address in unique_addresses)
        )
        if unsafe and not test_loopback:
            raise SafeOutboundFetchError("DESTINATION_UNSAFE", "That address is not public.")
        if resolved_port not in policy.allowed_ports and not test_loopback:
            raise SafeOutboundFetchError("PORT_UNSAFE", "That network port is not allowed.")

        normalized_url = urlunsplit(
            (
                scheme,
                _canonical_netloc(hostname, resolved_port, explicit_port=explicit_port),
                parts.path or "/",
                parts.query,
                "",
            )
        )

        # The caller's own rule about *where* it is allowed to go, applied to the
        # normalized URL after the network policy has passed. It runs here rather
        # than at the call site because this method is what every redirect hop
        # goes through, and a rule that only guards the first request is not a
        # rule about the destination.
        if policy.destination_allowed is not None:
            try:
                permitted = bool(policy.destination_allowed(normalized_url))
            except Exception as exc:  # pragma: no cover - defensive
                raise SafeOutboundFetchError(
                    "DESTINATION_NOT_PERMITTED",
                    "That address is not allowed for this request.",
                ) from exc
            if not permitted:
                raise SafeOutboundFetchError(
                    "DESTINATION_NOT_PERMITTED",
                    "That address is not allowed for this request.",
                )

        return ValidatedOutboundDestination(
            url=normalized_url,
            hostname=hostname,
            port=resolved_port,
            addresses=tuple(unique_addresses),
        )

    @staticmethod
    def _request_headers(policy: SafeOutboundFetchPolicy) -> Mapping[str, str]:
        headers = {
            "User-Agent": policy.user_agent,
            "Accept": policy.accept,
        }
        if any(name.casefold() in _FORBIDDEN_REQUEST_HEADERS for name in headers):
            raise AssertionError("safe outbound policy attempted to send a credential header")
        return headers

    @staticmethod
    def _connected_address(
        response: httpx.Response,
        destination: ValidatedOutboundDestination,
        *,
        require_peer: bool,
    ) -> str | None:
        stream = response.extensions.get("network_stream")
        server_address = (
            stream.get_extra_info("server_addr")
            if stream is not None and hasattr(stream, "get_extra_info")
            else None
        )
        if not server_address:
            if require_peer:
                raise SafeOutboundFetchError(
                    "PEER_UNVERIFIED",
                    "The connected server address could not be verified.",
                )
            return None
        raw_address = server_address[0] if isinstance(server_address, tuple) else server_address
        raw_port = server_address[1] if isinstance(server_address, tuple) and len(server_address) > 1 else None
        try:
            address = ipaddress.ip_address(str(raw_address))
        except ValueError as exc:
            raise SafeOutboundFetchError(
                "PEER_UNVERIFIED",
                "The connected server address could not be verified.",
            ) from exc
        if address not in destination.addresses or (
            raw_port is not None and int(raw_port) != destination.port
        ):
            raise SafeOutboundFetchError(
                "PEER_MISMATCH",
                "The connected server did not match the validated address.",
            )
        return str(address)

    async def _fetch_hop(
        self,
        destination: ValidatedOutboundDestination,
        policy: SafeOutboundFetchPolicy,
    ) -> tuple[httpx.Response, bytes, str | None]:
        transport = self._transport or _PinnedAsyncHTTPTransport(destination)
        timeout = httpx.Timeout(
            policy.read_timeout_seconds,
            connect=policy.connect_timeout_seconds,
        )
        try:
            async with httpx.AsyncClient(
                follow_redirects=False,
                timeout=timeout,
                trust_env=False,
                transport=transport,
            ) as client:
                async with client.stream(
                    "GET",
                    destination.url,
                    headers=self._request_headers(policy),
                ) as response:
                    connected_address = self._connected_address(
                        response,
                        destination,
                        require_peer=self._transport is None,
                    )
                    if response.status_code in _REDIRECT_STATUSES or not (
                        200 <= response.status_code < 300
                    ):
                        return response, b"", connected_address

                    content_type = (
                        response.headers.get("content-type", "")
                        .split(";", 1)[0]
                        .strip()
                        .casefold()
                    )
                    if content_type not in policy.allowed_content_types:
                        raise SafeOutboundFetchError(
                            "CONTENT_TYPE_UNSUPPORTED",
                            "The URL did not return a supported content type.",
                        )
                    content_length = response.headers.get("content-length")
                    if content_length:
                        try:
                            declared_length = int(content_length)
                        except ValueError:
                            declared_length = -1
                        if declared_length > policy.max_response_bytes:
                            raise SafeOutboundFetchError(
                                "RESPONSE_TOO_LARGE",
                                "The response is too large to read safely.",
                            )

                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(body) + len(chunk) > policy.max_response_bytes:
                            raise SafeOutboundFetchError(
                                "RESPONSE_TOO_LARGE",
                                "The response is too large to read safely.",
                            )
                        body.extend(chunk)
                    return response, bytes(body), connected_address
        except SafeOutboundFetchError:
            raise
        except (httpx.TimeoutException, httpcore.TimeoutException) as exc:
            raise SafeOutboundFetchError(
                "TIMEOUT",
                "The public page took too long to respond.",
            ) from exc
        except (
            httpx.HTTPError,
            httpcore.NetworkError,
            httpcore.ProtocolError,
            httpcore.ConnectionNotAvailable,
            httpcore.UnsupportedProtocol,
        ) as exc:
            raise SafeOutboundFetchError(
                "FETCH_FAILED",
                "The public page could not be retrieved.",
            ) from exc

    async def fetch(
        self,
        raw_url: str,
        policy: SafeOutboundFetchPolicy,
    ) -> SafeOutboundResponse:
        try:
            async with asyncio.timeout(policy.total_timeout_seconds):
                entered = await self.validate_destination(raw_url, policy)
                current_url = entered.url
                for redirect_count in range(policy.max_redirects + 1):
                    destination = await self.validate_destination(current_url, policy)
                    response, body, connected_address = await self._fetch_hop(
                        destination,
                        policy,
                    )
                    if response.status_code in _REDIRECT_STATUSES:
                        location = response.headers.get("location")
                        if (
                            not location
                            or len(location) > MAX_REDIRECT_LOCATION_LENGTH
                            or _has_control_character(location)
                        ):
                            raise SafeOutboundFetchError(
                                "REDIRECT_INVALID",
                                "The public page returned an invalid redirect.",
                            )
                        if redirect_count >= policy.max_redirects:
                            raise SafeOutboundFetchError(
                                "TOO_MANY_REDIRECTS",
                                "The public page redirected too many times.",
                            )
                        current_url = urljoin(destination.url, location)
                        continue

                    content_type = (
                        response.headers.get("content-type", "")
                        .split(";", 1)[0]
                        .strip()
                        .casefold()
                    )
                    return SafeOutboundResponse(
                        entered_url=entered.url,
                        final_url=destination.url,
                        status_code=response.status_code,
                        content_type=content_type,
                        encoding=response.encoding or "utf-8",
                        body=body,
                        redirect_count=redirect_count,
                        connected_address=connected_address,
                    )
        except SafeOutboundFetchError:
            raise
        except TimeoutError as exc:
            raise SafeOutboundFetchError(
                "TIMEOUT",
                "The public page took too long to respond.",
            ) from exc
        raise AssertionError("unreachable")  # pragma: no cover
