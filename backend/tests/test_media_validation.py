"""What an upload has to survive before it is stored and served.

Two things were previously taken on trust, and both are the caller's word rather
than a fact.

The stored file's extension came from the `content_type` in the request, so
anyone could declare `image/png`, upload something that is not a PNG, and have
it served from this application's own origin at a `.png` path. What a browser
does with same-origin bytes depends on how it sniffs them, and "depends" is not
a security property.

And the bytes were stored exactly as received, EXIF included. A creator
uploading an avatar taken on a phone was publishing the GPS coordinates of
wherever they took it, alongside their face. Nobody chose that.

The images here are built byte by byte rather than loaded from files, so each
test says exactly which property of the container it is about — and so a test
cannot pass because some fixture happened to be well-formed.
"""

from __future__ import annotations

import struct
import zlib

import pytest

from app.services.media_validation import (
    MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS,
    InvalidImageError,
    inspect_image,
    prepare_upload,
    sniff_media_type,
    strip_metadata,
)


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload))
    )


def png(width: int = 4, height: int = 4, *, extra: bytes = b"") -> bytes:
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + extra
        + _png_chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
        + _png_chunk(b"IEND", b"")
    )


def jpeg(width: int = 4, height: int = 4, *, exif: bytes | None = None) -> bytes:
    parts = [b"\xff\xd8"]
    parts.append(b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x02\x00\x00\x01\x00\x01\x00\x00")
    if exif is not None:
        parts.append(b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif)
    frame = struct.pack(">BHHB", 8, height, width, 3) + b"\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    parts.append(b"\xff\xc0" + struct.pack(">H", len(frame) + 2) + frame)
    parts.append(b"\xff\xda" + struct.pack(">H", 8) + b"\x01\x01\x00\x00\x3f\x00")
    parts.append(b"\xff\xd9")
    return b"".join(parts)


def gif(width: int = 4, height: int = 4) -> bytes:
    return b"GIF89a" + struct.pack("<HH", width, height) + b"\x00\x00\x00" + b"\x3b"


def webp_lossy(width: int = 4, height: int = 4) -> bytes:
    payload = b"\x00\x00\x00" + b"\x9d\x01\x2a" + struct.pack("<HH", width, height) + b"\x00\x00"
    body = b"VP8 " + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WEBP" + body


class TestTheBytesDecideWhatAFileIs:
    @pytest.mark.parametrize(
        ("data", "expected"),
        [
            (png(), "image/png"),
            (jpeg(), "image/jpeg"),
            (gif(), "image/gif"),
            (webp_lossy(), "image/webp"),
        ],
    )
    def test_each_supported_format_is_recognised(self, data: bytes, expected: str) -> None:
        assert sniff_media_type(data) == expected
        assert inspect_image(data).media_type == expected

    def test_something_that_is_not_an_image_is_refused(self) -> None:
        """The important case: HTML stored as .png and served same-origin."""

        with pytest.raises(InvalidImageError):
            inspect_image(b"<html><script>alert(1)</script></html>")

    def test_a_mislabelled_file_is_refused_rather_than_renamed(self) -> None:
        """A caller mislabelling a file is confused or trying something, and
        neither is a reason to store it under a name that lies about it."""

        with pytest.raises(InvalidImageError, match="does not match"):
            prepare_upload(png(), declared_type="image/jpeg")

    def test_the_extension_comes_from_the_bytes(self) -> None:
        _cleaned, facts = prepare_upload(jpeg(), declared_type="image/jpeg")

        assert facts.extension == "jpg"

    def test_an_empty_file_is_refused(self) -> None:
        with pytest.raises(InvalidImageError):
            inspect_image(b"")

    def test_a_truncated_header_is_refused_not_guessed(self) -> None:
        """"We could not tell" and "it is fine" are different answers, and only
        one of them is safe to act on."""

        with pytest.raises(InvalidImageError):
            inspect_image(b"\x89PNG\r\n\x1a\n" + b"\x00" * 4)


class TestSizeIsMeasuredInPixels:
    def test_dimensions_are_read_from_each_container(self) -> None:
        for data in (png(7, 11), jpeg(7, 11), gif(7, 11), webp_lossy(7, 11)):
            facts = inspect_image(data)
            assert (facts.width, facts.height) == (7, 11), facts.media_type

    def test_a_decompression_bomb_is_refused(self) -> None:
        """A few hundred bytes can declare 60,000 x 60,000. The byte ceiling
        elsewhere cannot see this at all, which is why pixels are their own
        limit rather than a tighter version of the same one."""

        with pytest.raises(InvalidImageError, match="too large"):
            inspect_image(png(60_000, 60_000))

    def test_the_pixel_budget_binds_even_within_the_dimension_limit(self) -> None:
        side = MAX_IMAGE_DIMENSION - 1
        assert side * side > MAX_IMAGE_PIXELS

        with pytest.raises(InvalidImageError, match="too large"):
            inspect_image(png(side, side))

    def test_an_ordinary_image_is_accepted(self) -> None:
        assert inspect_image(png(1200, 800)).pixels == 960_000

    def test_a_zero_dimension_is_refused(self) -> None:
        with pytest.raises(InvalidImageError):
            inspect_image(png(0, 10))


class TestMetadataIsRemoved:
    def test_png_text_chunks_are_dropped(self) -> None:
        comment = _png_chunk(b"tEXt", b"Comment\x00taken at home")
        original = png(extra=comment)
        assert b"taken at home" in original

        cleaned, _facts = prepare_upload(original, declared_type="image/png")

        assert b"taken at home" not in cleaned
        assert b"tEXt" not in cleaned

    def test_png_exif_chunks_are_dropped(self) -> None:
        original = png(extra=_png_chunk(b"eXIf", b"II*\x00gps-coordinates"))

        cleaned = strip_metadata(original, media_type="image/png")

        assert b"gps-coordinates" not in cleaned

    def test_the_png_still_has_what_makes_it_an_image(self) -> None:
        """Stripping must not produce a file that no longer renders."""

        cleaned = strip_metadata(png(extra=_png_chunk(b"tEXt", b"x\x00y")), media_type="image/png")

        assert cleaned.startswith(b"\x89PNG\r\n\x1a\n")
        for required in (b"IHDR", b"IDAT", b"IEND"):
            assert required in cleaned
        # And it is still readable as the same image.
        assert inspect_image(cleaned).width == 4

    def test_jpeg_exif_is_dropped(self) -> None:
        """The one that matters most: a phone photo carries where it was taken."""

        original = jpeg(exif=b"Exif\x00\x00II*\x00GPSLatitude 51.5074")
        assert b"GPSLatitude" in original

        cleaned, _facts = prepare_upload(original, declared_type="image/jpeg")

        assert b"GPSLatitude" not in cleaned
        assert inspect_image(cleaned).width == 4

    def test_the_jpeg_keeps_its_jfif_header(self) -> None:
        """APP0 describes pixel density and says nothing about the person."""

        cleaned = strip_metadata(jpeg(exif=b"Exif\x00\x00secret"), media_type="image/jpeg")

        assert b"JFIF" in cleaned

    def test_jpeg_image_data_survives(self) -> None:
        original = jpeg(exif=b"Exif\x00\x00secret")

        cleaned = strip_metadata(original, media_type="image/jpeg")

        assert cleaned.startswith(b"\xff\xd8")
        assert cleaned.endswith(b"\xff\xd9")

    def test_webp_exif_and_xmp_chunks_are_dropped(self) -> None:
        base = webp_lossy()
        exif_chunk = b"EXIF" + struct.pack("<I", 8) + b"gpsdata!"
        original = (
            base[:4] + struct.pack("<I", len(base) - 8 + len(exif_chunk)) + base[8:] + exif_chunk
        )
        assert b"gpsdata!" in original

        cleaned = strip_metadata(original, media_type="image/webp")

        assert b"gpsdata!" not in cleaned
        assert inspect_image(cleaned).media_type == "image/webp"

    def test_gif_is_passed_through_and_that_is_recorded(self) -> None:
        """A known limitation rather than an oversight: GIF extensions are
        interleaved with frame data, a wrong rewrite corrupts the image, and
        GIFs do not carry EXIF — so the exposure that motivated this is absent.
        """

        original = gif()

        assert strip_metadata(original, media_type="image/gif") == original


class TestPrepareUpload:
    def test_it_returns_cleaned_bytes_and_the_facts(self) -> None:
        cleaned, facts = prepare_upload(png(20, 10), declared_type="image/png")

        assert facts.width == 20
        assert facts.height == 10
        assert facts.extension == "png"
        assert cleaned.startswith(b"\x89PNG")

    def test_a_missing_declared_type_is_fine(self) -> None:
        """The declared type is a hint. Its absence is not a reason to refuse a
        file whose bytes are unambiguous."""

        _cleaned, facts = prepare_upload(png())

        assert facts.media_type == "image/png"

    def test_an_unsupported_declared_type_does_not_override_the_bytes(self) -> None:
        _cleaned, facts = prepare_upload(png(), declared_type="application/octet-stream")

        assert facts.media_type == "image/png"
