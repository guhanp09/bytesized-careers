"""Deciding what an uploaded image actually is, and removing what it carries.

Uploads were trusted twice over. The stored file's extension came from the
`content_type` the *caller* declared, and the bytes were written exactly as
received. Two consequences follow, and neither needs a clever attacker.

Anyone could declare `image/png`, upload something that is not a PNG, and have
it served from the application's own origin at a `.png` path. What a browser
does with same-origin bytes depends on how it sniffs them, and "depends" is not
a security property.

And an ordinary photograph carries EXIF. A creator uploading an avatar taken on
a phone was publishing, alongside their face, the GPS coordinates of wherever
they took it. Nobody chose that; nobody was asked.

So the format is decided by the BYTES, the extension follows from that decision,
the declared type is only ever a hint, and the metadata a camera attached is
removed before anything is stored.

What is deliberately NOT here: re-encoding. Decoding and re-emitting an image is
the strongest form of this — it neutralises anything hiding in a container this
code parses correctly but a decoder reads differently — and it needs an imaging
library, which is a dependency decision rather than a coding one. Everything
below is the part that can be done exactly, with no new dependency, and it is
written to fail closed: a container this module cannot parse is refused rather
than passed through.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

#: The formats the product accepts. A file whose bytes say anything else is
#: refused, whatever its declared type or extension claimed.
SUPPORTED_MEDIA_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

#: Pixels, not bytes. A 200-byte PNG can declare 60,000 x 60,000, and anything
#: that later decodes it — a thumbnailer, a browser, a future re-encoder — is
#: asked for 14 GB of memory. The byte ceiling elsewhere does not see this at
#: all, which is why it is a separate limit rather than a tighter one.
MAX_IMAGE_PIXELS = 40_000_000
MAX_IMAGE_DIMENSION = 12_000


class InvalidImageError(Exception):
    """The bytes are not an image this product accepts."""


@dataclass(frozen=True)
class ImageFacts:
    """What the bytes themselves say."""

    media_type: str
    extension: str
    width: int
    height: int

    @property
    def pixels(self) -> int:
        return self.width * self.height


def sniff_media_type(data: bytes) -> str | None:
    """The format according to the file, not according to the caller."""

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _png_dimensions(data: bytes) -> tuple[int, int]:
    # IHDR is required to be the first chunk, so its position is fixed.
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise InvalidImageError("This PNG file is damaged.")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


#: Start-of-frame markers. The arithmetic ones and the progressive ones both
#: carry the dimensions; the excluded values in this range are restart and
#: define-huffman markers, which do not.
_JPEG_SOF_MARKERS = {
    *range(0xC0, 0xC4),
    *range(0xC5, 0xC8),
    *range(0xC9, 0xCC),
    *range(0xCD, 0xD0),
}


def _jpeg_dimensions(data: bytes) -> tuple[int, int]:
    index = 2
    length = len(data)
    while index + 3 < length:
        if data[index] != 0xFF:
            raise InvalidImageError("This JPEG file is damaged.")
        marker = data[index + 1]
        if marker == 0xD8 or 0xD0 <= marker <= 0xD9:
            index += 2
            continue
        segment_length = struct.unpack(">H", data[index + 2 : index + 4])[0]
        if segment_length < 2:
            raise InvalidImageError("This JPEG file is damaged.")
        if marker in _JPEG_SOF_MARKERS:
            if index + 9 > length:
                raise InvalidImageError("This JPEG file is damaged.")
            height, width = struct.unpack(">HH", data[index + 5 : index + 9])
            return width, height
        index += 2 + segment_length
    raise InvalidImageError("This JPEG file is damaged.")


def _gif_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 10:
        raise InvalidImageError("This GIF file is damaged.")
    width, height = struct.unpack("<HH", data[6:10])
    return width, height


def _webp_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 30:
        raise InvalidImageError("This WebP file is damaged.")
    chunk = data[12:16]
    if chunk == b"VP8 ":
        # Lossy: a 3-byte frame tag, then the sync code, then 14-bit sizes.
        if data[23:26] != b"\x9d\x01\x2a":
            raise InvalidImageError("This WebP file is damaged.")
        width, height = struct.unpack("<HH", data[26:30])
        return width & 0x3FFF, height & 0x3FFF
    if chunk == b"VP8L":
        bits = struct.unpack("<I", data[21:25])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8X":
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return width, height
    raise InvalidImageError("This WebP file is damaged.")


_DIMENSION_READERS = {
    "image/png": _png_dimensions,
    "image/jpeg": _jpeg_dimensions,
    "image/gif": _gif_dimensions,
    "image/webp": _webp_dimensions,
}


def inspect_image(data: bytes) -> ImageFacts:
    """What this file is, refusing anything that cannot be answered exactly.

    A container that cannot be parsed is refused rather than stored unexamined:
    "we could not tell" and "it is fine" are not the same answer, and only one
    of them is safe to act on.
    """

    if not data:
        raise InvalidImageError("This file is empty.")

    media_type = sniff_media_type(data)
    if media_type is None:
        raise InvalidImageError("This file is not a PNG, JPEG, WebP, or GIF image.")

    width, height = _DIMENSION_READERS[media_type](data)
    if width <= 0 or height <= 0:
        raise InvalidImageError("This image reports no size.")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        raise InvalidImageError("This image is too large to use.")
    if width * height > MAX_IMAGE_PIXELS:
        raise InvalidImageError("This image is too large to use.")

    return ImageFacts(
        media_type=media_type,
        extension=SUPPORTED_MEDIA_TYPES[media_type],
        width=width,
        height=height,
    )


#: PNG chunks worth keeping: the ones that make the image an image, plus the
#: few that describe how to display its colour. Everything else — text, times,
#: embedded EXIF — is dropped, because none of it is needed to show a picture
#: and some of it says where the picture was taken.
_PNG_KEEP_CHUNKS = frozenset(
    {b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS", b"gAMA", b"cHRM", b"sRGB", b"acTL", b"fcTL", b"fdAT"}
)


def _strip_png(data: bytes) -> bytes:
    output = bytearray(data[:8])
    index = 8
    length = len(data)
    while index + 8 <= length:
        chunk_length = struct.unpack(">I", data[index : index + 4])[0]
        chunk_type = data[index + 4 : index + 8]
        end = index + 12 + chunk_length
        if end > length:
            raise InvalidImageError("This PNG file is damaged.")
        if chunk_type in _PNG_KEEP_CHUNKS:
            output += data[index:end]
        index = end
        if chunk_type == b"IEND":
            break
    return bytes(output)


def _strip_jpeg(data: bytes) -> bytes:
    """Drop APP1..APP15, which is where EXIF, GPS and XMP live.

    APP0 is kept: it is the JFIF header describing pixel density, and it carries
    nothing about the person or the place.
    """

    output = bytearray(data[:2])
    index = 2
    length = len(data)
    while index + 1 < length:
        if data[index] != 0xFF:
            raise InvalidImageError("This JPEG file is damaged.")
        marker = data[index + 1]
        if marker == 0xDA:  # start of scan — the rest is compressed image data
            output += data[index:]
            break
        if index + 4 > length:
            raise InvalidImageError("This JPEG file is damaged.")
        segment_length = struct.unpack(">H", data[index + 2 : index + 4])[0]
        if segment_length < 2:
            raise InvalidImageError("This JPEG file is damaged.")
        end = index + 2 + segment_length
        if end > length:
            raise InvalidImageError("This JPEG file is damaged.")
        if not 0xE1 <= marker <= 0xEF:
            output += data[index:end]
        index = end
    return bytes(output)


def _strip_webp(data: bytes) -> bytes:
    """Drop the EXIF and XMP chunks from the RIFF container."""

    header = bytearray(data[:12])
    body = bytearray()
    index = 12
    length = len(data)
    while index + 8 <= length:
        chunk_type = data[index : index + 4]
        chunk_length = struct.unpack("<I", data[index + 4 : index + 8])[0]
        # RIFF chunks are padded to an even length.
        end = index + 8 + chunk_length + (chunk_length % 2)
        if end > length:
            raise InvalidImageError("This WebP file is damaged.")
        if chunk_type not in (b"EXIF", b"XMP "):
            body += data[index:end]
        index = end

    header[4:8] = struct.pack("<I", len(body) + 4)
    return bytes(header + body)


def strip_metadata(data: bytes, *, media_type: str) -> bytes:
    """Remove what the camera attached, keeping what makes it an image.

    GIF is returned unchanged and that is a known limitation, recorded rather
    than hidden: its comment and application extensions are interleaved with the
    frame data, and a rewrite that gets it slightly wrong produces a corrupt
    image. GIFs do not carry EXIF, so the privacy exposure that motivated this
    is not present there.
    """

    if media_type == "image/png":
        return _strip_png(data)
    if media_type == "image/jpeg":
        return _strip_jpeg(data)
    if media_type == "image/webp":
        return _strip_webp(data)
    return data


def prepare_upload(data: bytes, *, declared_type: str | None = None) -> tuple[bytes, ImageFacts]:
    """Everything an upload must survive before it is stored.

    The declared type is accepted as a hint and never as an answer. When it
    disagrees with the bytes, the bytes win and the upload is refused — a caller
    that mislabels a file is either confused or trying something, and neither is
    a reason to store it under a name that lies about it.
    """

    facts = inspect_image(data)

    if declared_type:
        normalized = declared_type.strip().lower()
        if normalized in SUPPORTED_MEDIA_TYPES and normalized != facts.media_type:
            raise InvalidImageError("This file does not match the type it claims to be.")

    return strip_metadata(data, media_type=facts.media_type), facts
