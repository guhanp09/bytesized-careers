"""Where uploaded media goes, behind one seam.

Today it goes to the application's own filesystem, which works exactly until the
application has more than one instance or is redeployed onto fresh disk. Then
half the avatars are missing on half the requests, and nothing in the code says
why: the write and the read were never the same concern, they just happened to
share a directory.

So there is a seam. `MediaStorage` is what the profile service talks to; the
local adapter is what it talks to now; an object-store adapter is what it will
talk to later, and that swap is a constructor rather than a rewrite. The
provider adapter itself is not written here — it needs a bucket, credentials and
a bill, which are external — but the contract it must satisfy is, and a fake
that satisfies it is exercised by the tests.

The part with teeth is the object key. A key is built from an owner and a
random token and is then VALIDATED before any filesystem path is derived from
it, because "the caller only ever passes keys we generated" is an assumption
that survives exactly as long as nobody adds a second caller.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

#: Deliberately strict: lowercase segments, one dot before a short extension, no
#: traversal, no absolute paths, no spaces, no encoded separators. Anything a
#: real key needs fits; almost nothing an attacker wants does.
_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*(?:/[a-z0-9][a-z0-9_-]*)*\.[a-z0-9]{1,5}$")

#: Long enough that keys cannot be guessed and enumerated. Avatars are public
#: once linked, but "public if you know the URL" and "listable" are different
#: things, and the second one is a privacy problem.
_TOKEN_BYTES = 16


class InvalidObjectKeyError(Exception):
    """A key that will not be turned into a path."""


@dataclass(frozen=True)
class StoredObject:
    key: str
    url: str


def build_object_key(*, prefix: str, owner_id: uuid.UUID, extension: str) -> str:
    """`prefix/owner/random.ext`.

    The owner is in the path so an object can be attributed and swept without a
    database lookup — a deletion that has to join back to a table is a deletion
    that stops happening when the table is the thing being cleaned up.

    The random part means a key cannot be guessed from an account id, so knowing
    somebody's user id does not let you enumerate what they have uploaded.
    """

    token = uuid.uuid4().hex[:_TOKEN_BYTES]
    key = f"{prefix}/{owner_id.hex}/{token}.{extension.lower()}"
    return validate_object_key(key)


def validate_object_key(key: str) -> str:
    """Refuse anything that is not a plain, relative, lowercase object key.

    Checked here rather than at each call site, and checked even for keys this
    module generated, because the value of a boundary is that it does not depend
    on who is calling.
    """

    if not key or len(key) > 512:
        raise InvalidObjectKeyError("Object key is missing or too long.")
    if not _KEY_PATTERN.match(key):
        raise InvalidObjectKeyError("Object key contains characters that are not allowed.")
    # Belt and braces: the pattern already excludes these, and a future edit to
    # the pattern must not quietly reintroduce them.
    if ".." in key or key.startswith("/") or "\\" in key:
        raise InvalidObjectKeyError("Object key may not traverse.")
    return key


class MediaStorage(Protocol):
    """What the application needs from a place to put media.

    Small on purpose. Every method an adapter must implement is a method every
    future adapter must implement, and the ones that are easy on a filesystem
    are the ones that are awkward on an object store.
    """

    def url_for(self, key: str) -> str: ...

    async def put(self, key: str, data: bytes, *, content_type: str) -> StoredObject: ...

    async def delete(self, key: str) -> bool: ...

    async def exists(self, key: str) -> bool: ...


class LocalMediaStorage:
    """The filesystem adapter — what runs today, and what tests run against.

    Fine for development and for a single instance. It is NOT a production
    answer: the files live with the process, so a second instance cannot see
    them and a redeploy onto fresh disk loses them. That is recorded here rather
    than discovered later.
    """

    def __init__(self, *, root: Path | str, public_base_url: str, base_path: str) -> None:
        self.root = Path(root)
        self.public_base_url = public_base_url.rstrip("/")
        self.base_path = f"/{base_path.strip('/')}"

    def _path_for(self, key: str) -> Path:
        validated = validate_object_key(key)
        candidate = (self.root / validated).resolve()
        root = self.root.resolve()
        # The key is already validated; this is the second, independent check
        # that the resolved path is still inside the root. Symlinks and unicode
        # normalisation are why a regex alone is not enough.
        if not candidate.is_relative_to(root):
            raise InvalidObjectKeyError("Object key resolves outside the media root.")
        return candidate

    def url_for(self, key: str) -> str:
        return f"{self.public_base_url}{self.base_path}/{validate_object_key(key)}"

    async def put(self, key: str, data: bytes, *, content_type: str) -> StoredObject:
        path = self._path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return StoredObject(key=key, url=self.url_for(key))

    async def delete(self, key: str) -> bool:
        path = self._path_for(key)
        if not path.exists():
            # Not an error: deleting something already gone is the outcome the
            # caller wanted, and raising would make cleanup jobs fail on retry.
            return False
        path.unlink()
        return True

    async def exists(self, key: str) -> bool:
        return self._path_for(key).exists()


def key_from_url(url: str | None, *, public_base_url: str, base_path: str) -> str | None:
    """The object key a URL of ours refers to, or None if it is not ours.

    Replacing an avatar used to leave the previous file on disk for ever: the
    row pointed somewhere new and nothing pointed at the old object, so nothing
    could ever decide to remove it. Storage that only grows is a bill that only
    grows, and every orphan is a copy of someone's face that outlived their
    decision to change it.

    Returning None rather than raising is deliberate. Avatars can legitimately
    be somewhere else entirely — a YouTube channel image, a URL from before this
    seam existed — and "not ours" is an ordinary answer, not a failure.
    """

    if not url:
        return None

    prefix = f"{public_base_url.rstrip('/')}/{base_path.strip('/')}/"
    if not url.startswith(prefix):
        return None

    try:
        return validate_object_key(url[len(prefix) :])
    except InvalidObjectKeyError:
        # A URL under our prefix that is not a key we would ever have written.
        # Refusing to act on it is the safe half of the answer.
        return None
