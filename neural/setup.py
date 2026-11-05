"""Fetch pinned public experimental assets. Never sends local audio anywhere."""

import hashlib
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
MODEL_NAME = "pc_nsf_hifigan_44.1k_hop512_128bin_2025.02"
MODEL_URL = f"https://github.com/openvpi/vocoders/releases/download/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02/{MODEL_NAME}.oudep"
MODEL_HASH = "ba7d43142d41f6900c8264b5662ca7125a50feb8760bb8b9615c61a8f5e6902e"
FIXTURE_URL = "https://zenodo.org/records/5578807/files/vocadito.zip?download=1"
FIXTURE_MD5 = "dea40fd18f14d899643c4ba221b33a46"


def download(url, path, digest, algorithm="sha256"):
    path.parent.mkdir(exist_ok=True, parents=True)

    def check(p):
        h = hashlib.new(algorithm)
        with p.open("rb") as f:
            for b in iter(lambda: f.read(1024 * 1024), b""):
                h.update(b)
        return h.hexdigest() == digest

    if path.exists() and check(path):
        return
    temp = path.with_suffix(path.suffix + ".partial")
    print(f"Downloading {path.name}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as src, temp.open("wb") as out:
        shutil.copyfileobj(src, out)
    if not check(temp):
        raise ValueError(f"Checksum mismatch: {path.name}")
    temp.replace(path)


def extract(archive, dest):
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            relative = Path(item.filename)
            if "__MACOSX" in relative.parts or item.is_dir():
                continue
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Unsafe archive path")
            target = dest / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(item) as src, target.open("wb") as out:
                shutil.copyfileobj(src, out)


def main():
    download(MODEL_URL, ROOT / f"models/{MODEL_NAME}.oudep", MODEL_HASH)
    extract(ROOT / f"models/{MODEL_NAME}.oudep", ROOT / "models")
    download(FIXTURE_URL, ROOT / "fixtures/vocadito.zip", FIXTURE_MD5, "md5")
    extract(ROOT / "fixtures/vocadito.zip", ROOT / "fixtures")
    print(
        "Verified model and fixtures. Model: CC BY-NC-SA 4.0 (noncommercial); vocadito: CC BY 4.0."
    )


if __name__ == "__main__":
    main()
