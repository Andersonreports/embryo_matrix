"""Gzip-at-rest storage for backend/app/uploads.

Every new file is written gzip-compressed (stored name gets a ".gz" suffix
appended on top of its real extension, e.g. "abc123.jpg.gz"), and read back
transparently decompressed. Files written before this existed have no ".gz"
suffix and are still served as-is - no backfill/migration needed, both forms
are read at once.
"""
import gzip
from pathlib import Path


def write_compressed(dest_dir: Path, stored_name: str, fileobj) -> str:
    """Gzips `fileobj`'s contents into dest_dir, returns the stored filename
    (stored_name + '.gz')."""
    gz_name = f"{stored_name}.gz"
    with gzip.open(dest_dir / gz_name, "wb") as out:
        while chunk := fileobj.read(1024 * 1024):
            out.write(chunk)
    return gz_name


def write_compressed_bytes(dest_dir: Path, stored_name: str, data: bytes) -> str:
    gz_name = f"{stored_name}.gz"
    with gzip.open(dest_dir / gz_name, "wb") as out:
        out.write(data)
    return gz_name


def is_gzip(path: Path) -> bool:
    if path.suffix == ".gz":
        return True
    try:
        with path.open("rb") as f:
            return f.read(2) == b"\x1f\x8b"
    except OSError:
        return False


def read_decompressed(path: Path) -> bytes:
    if is_gzip(path):
        with gzip.open(path, "rb") as f:
            return f.read()
    return path.read_bytes()
