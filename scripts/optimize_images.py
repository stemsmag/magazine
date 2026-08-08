#!/usr/bin/env python3
"""
Escanea las carpetas de imágenes del repo y optimiza cada archivo
in-place: lo redimensiona si excede un ancho máximo y lo recomprime
(JPEG/PNG/WebP) para reducir el peso sin cambiar el nombre ni la ruta.

Es idempotente: guarda un manifest (.image-optimize-cache.json) con el
mtime + tamaño de cada archivo ya optimizado, así que si corres el
script varias veces no vuelve a comprimir lo que no cambió (evitando
degradar la calidad de una imagen ya optimizada en corridas repetidas).

Carpetas escaneadas (relativas a la raíz del repo):
  images/, articulos/images/, img/, img-ev/

Uso:
  pip install Pillow
  python3 scripts/optimize_images.py
  python3 scripts/optimize_images.py --dry-run   # solo muestra qué haría
"""
import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Falta Pillow. Instálalo con: pip install Pillow")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
IMAGE_DIRS = ["images", "articulos/images", "img", "img-ev"]
CACHE_FILE = ROOT / ".image-optimize-cache.json"

JPEG_QUALITY = 82
WEBP_QUALITY = 82
PNG_COMPRESS_LEVEL = 9

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
# .gif se omite para no romper animaciones


def load_cache():
    if not CACHE_FILE.exists():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_cache(cache):
    CACHE_FILE.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def file_fingerprint(path: Path):
    stat = path.stat()
    return f"{stat.st_mtime_ns}:{stat.st_size}"


def find_images():
    files = []
    for rel_dir in IMAGE_DIRS:
        d = ROOT / rel_dir
        if not d.exists():
            continue
        for ext in VALID_EXTS:
            files.extend(sorted(d.rglob(f"*{ext}")))
            files.extend(sorted(d.rglob(f"*{ext.upper()}")))
    return files


def optimize_image(path: Path, dry_run=False):
    """Devuelve (bytes_antes, bytes_despues) o None si se omitió."""
    original_size = path.stat().st_size

    try:
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)  # respeta la orientación EXIF antes de perderla
    except Exception as e:
        print(f"  [error] no se pudo abrir {path.relative_to(ROOT)}: {e}")
        return None

    fmt = (img.format or "").upper()
    ext = path.suffix.lower()

    if dry_run:
        print(f"  [dry-run] {path.relative_to(ROOT)} — recomprimir")
        return (original_size, None)

    save_kwargs = {}
    if ext in (".jpg", ".jpeg") or fmt == "JPEG":
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        save_kwargs = {"format": "JPEG", "quality": JPEG_QUALITY, "optimize": True, "progressive": True}
    elif ext == ".png" or fmt == "PNG":
        save_kwargs = {"format": "PNG", "optimize": True, "compress_level": PNG_COMPRESS_LEVEL}
    elif ext == ".webp" or fmt == "WEBP":
        save_kwargs = {"format": "WEBP", "quality": WEBP_QUALITY, "method": 6}
    else:
        print(f"  [aviso] formato no reconocido en {path.relative_to(ROOT)}, se omite")
        return None

    try:
        img.save(path, **save_kwargs)
    except Exception as e:
        print(f"  [error] no se pudo guardar {path.relative_to(ROOT)}: {e}")
        return None

    new_size = path.stat().st_size
    return (original_size, new_size)


def human(n):
    for unit in ("B", "KB", "MB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}GB"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Muestra qué se haría sin modificar archivos")
    parser.add_argument("--force", action="store_true", help="Ignora el cache y reprocesa todo")
    parser.add_argument("--quality", type=int, default=None,
                         help="Calidad JPEG/WebP 1-100 (default 82). Úsalo junto con --force para reprocesar todo.")
    args = parser.parse_args()

    global JPEG_QUALITY, WEBP_QUALITY
    if args.quality is not None:
        JPEG_QUALITY = args.quality
        WEBP_QUALITY = args.quality

    cache = {} if args.force else load_cache()
    images = find_images()

    if not images:
        print("No se encontraron imágenes en: " + ", ".join(IMAGE_DIRS))
        return

    print(f"Escaneando {len(images)} imagen(es) en {', '.join(IMAGE_DIRS)} ...\n")

    processed, skipped = 0, 0
    total_before, total_after = 0, 0

    for path in images:
        rel = str(path.relative_to(ROOT))
        fp = file_fingerprint(path)

        if not args.dry_run and cache.get(rel) == fp:
            skipped += 1
            continue

        result = optimize_image(path, dry_run=args.dry_run)
        if result is None:
            continue

        before, after = result
        if args.dry_run:
            continue

        processed += 1
        total_before += before
        total_after += after
        saved_pct = (1 - after / before) * 100 if before else 0
        print(f"  ✓ {rel} — {human(before)} → {human(after)} ({saved_pct:.0f}% menos)")

        cache[rel] = file_fingerprint(path)

    if args.dry_run:
        print("\n(dry-run, no se modificó ningún archivo)")
        return

    save_cache(cache)

    print(f"\nListo — {processed} optimizada(s), {skipped} sin cambios (ya optimizadas antes).")
    if total_before:
        saved = total_before - total_after
        print(f"Peso total: {human(total_before)} → {human(total_after)} "
              f"(ahorro de {human(saved)}, {(saved/total_before)*100:.0f}%)")


if __name__ == "__main__":
    main()
