"""The seam between "we have some bytes" and "they are somewhere".

Media goes to the application's own filesystem today, which works exactly until
there is more than one instance or a redeploy lands on fresh disk. Then half the
avatars are missing on half the requests. The adapter here does not fix that —
an object store does — but it is what makes the fix a constructor swap instead
of a rewrite, so it is worth having the contract pinned before the swap.

The part with teeth is the object key. Everything below is about the assumption
"the caller only ever passes keys we generated", which survives exactly as long
as nobody adds a second caller.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.services.media_storage import (
    InvalidObjectKeyError,
    LocalMediaStorage,
    build_object_key,
    validate_object_key,
)


@pytest.fixture
def storage(tmp_path: Path) -> LocalMediaStorage:
    return LocalMediaStorage(
        root=tmp_path, public_base_url="https://example.test/", base_path="/media/"
    )


class TestObjectKeys:
    def test_a_key_names_its_owner_and_is_unguessable(self) -> None:
        owner = uuid.uuid4()

        key = build_object_key(prefix="avatars", owner_id=owner, extension="png")

        assert key.startswith(f"avatars/{owner.hex}/")
        assert key.endswith(".png")

    def test_two_keys_for_one_owner_differ(self) -> None:
        """Knowing an account id must not let you enumerate its uploads:
        "public if you know the URL" and "listable" are different things."""

        owner = uuid.uuid4()

        first = build_object_key(prefix="avatars", owner_id=owner, extension="png")
        second = build_object_key(prefix="avatars", owner_id=owner, extension="png")

        assert first != second

    @pytest.mark.parametrize(
        "key",
        [
            "../../etc/passwd",
            "avatars/../../secrets.png",
            "/etc/passwd.png",
            "avatars/..%2Fescape.png",
            "avatars\\windows.png",
            "avatars/file name.png",
            "AVATARS/UPPER.PNG",
            "avatars/no-extension",
            "",
            "avatars/x." + "e" * 12,
        ],
    )
    def test_a_key_that_could_escape_is_refused(self, key: str) -> None:
        with pytest.raises(InvalidObjectKeyError):
            validate_object_key(key)

    def test_an_ordinary_key_is_accepted(self) -> None:
        assert validate_object_key("avatars/abc123/deadbeef.png")

    def test_a_generated_key_passes_its_own_validator(self) -> None:
        """Otherwise the rule and the generator disagree and one of them is
        wrong in production rather than here."""

        for extension in ("png", "jpg", "webp", "gif"):
            key = build_object_key(
                prefix="banners", owner_id=uuid.uuid4(), extension=extension
            )
            assert validate_object_key(key) == key


class TestTheLocalAdapter:
    async def test_it_stores_and_reads_back(self, storage: LocalMediaStorage) -> None:
        key = build_object_key(prefix="avatars", owner_id=uuid.uuid4(), extension="png")

        stored = await storage.put(key, b"bytes", content_type="image/png")

        assert stored.key == key
        assert await storage.exists(key) is True
        assert (storage.root / key).read_bytes() == b"bytes"

    async def test_the_url_is_built_from_the_key(self, storage: LocalMediaStorage) -> None:
        key = "avatars/abc/deadbeef.png"

        assert storage.url_for(key) == "https://example.test/media/avatars/abc/deadbeef.png"

    async def test_deleting_something_absent_is_not_an_error(
        self, storage: LocalMediaStorage
    ) -> None:
        """A cleanup job that raises on an already-deleted object is a cleanup
        job that fails every time it retries."""

        assert await storage.delete("avatars/abc/never-written.png") is False

    async def test_deleting_removes_it(self, storage: LocalMediaStorage) -> None:
        key = build_object_key(prefix="avatars", owner_id=uuid.uuid4(), extension="png")
        await storage.put(key, b"bytes", content_type="image/png")

        assert await storage.delete(key) is True
        assert await storage.exists(key) is False

    @pytest.mark.parametrize("method", ["put", "delete", "exists"])
    async def test_every_entry_point_validates_the_key(
        self, storage: LocalMediaStorage, method: str
    ) -> None:
        """A boundary that only one method checks is not a boundary."""

        with pytest.raises(InvalidObjectKeyError):
            if method == "put":
                await storage.put("../escape.png", b"x", content_type="image/png")
            elif method == "delete":
                await storage.delete("../escape.png")
            else:
                await storage.exists("../escape.png")

    async def test_it_refuses_to_write_outside_its_root(
        self, tmp_path: Path
    ) -> None:
        """The independent second check. The pattern already excludes traversal;
        this catches the day someone loosens the pattern."""

        nested = LocalMediaStorage(
            root=tmp_path / "media", public_base_url="https://example.test", base_path="media"
        )

        with pytest.raises(InvalidObjectKeyError):
            await nested.put("avatars/../../outside.png", b"x", content_type="image/png")


class TestTheContractIsSmall:
    """Every method an adapter must implement is one every FUTURE adapter must
    implement, and the ones that are easy on a filesystem are the awkward ones
    on an object store. Growing this interface has a cost that is paid later."""

    def test_the_protocol_has_not_grown(self) -> None:
        from app.services.media_storage import MediaStorage

        methods = {
            name
            for name in dir(MediaStorage)
            if not name.startswith("_") and callable(getattr(MediaStorage, name, None))
        }

        assert methods == {"url_for", "put", "delete", "exists"}

    async def test_a_fake_adapter_satisfies_it(self) -> None:
        """The point of the seam: something that is not a filesystem can be
        substituted without touching a caller."""

        from app.services.media_storage import MediaStorage, StoredObject

        class InMemoryStorage:
            def __init__(self) -> None:
                self.objects: dict[str, bytes] = {}

            def url_for(self, key: str) -> str:
                return f"https://cdn.example.test/{validate_object_key(key)}"

            async def put(self, key: str, data: bytes, *, content_type: str) -> StoredObject:
                self.objects[validate_object_key(key)] = data
                return StoredObject(key=key, url=self.url_for(key))

            async def delete(self, key: str) -> bool:
                return self.objects.pop(validate_object_key(key), None) is not None

            async def exists(self, key: str) -> bool:
                return validate_object_key(key) in self.objects

        fake: MediaStorage = InMemoryStorage()
        key = build_object_key(prefix="avatars", owner_id=uuid.uuid4(), extension="png")

        stored = await fake.put(key, b"bytes", content_type="image/png")

        assert stored.url.startswith("https://cdn.example.test/")
        assert await fake.exists(key) is True
        assert await fake.delete(key) is True
        assert await fake.exists(key) is False


class TestTheLocalAdapterIsNotAProductionAnswer:
    def test_it_says_so(self) -> None:
        """Recorded in the code rather than discovered during an incident: the
        files live with the process, so a second instance cannot see them."""

        import inspect

        from app.services.media_storage import LocalMediaStorage as Local

        documentation = " ".join((inspect.getdoc(Local) or "").split()).lower()
        assert "not a production answer" in documentation
