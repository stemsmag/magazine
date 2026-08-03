#!/usr/bin/env python3
"""
Escanea articulos/*.html buscando el bloque:
  <script type="application/json" id="article-meta"> ... </script>
y regenera articles.json en la raíz del repo.

Los artículos "próximamente" (sin archivo .html real, solo entradas
manuales con "comingSoon": true en articles.json) se conservan tal
cual, siempre que no exista ya un artículo real con el mismo slug.

Uso: python3 scripts/build_articles_json.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTICLES_DIR = ROOT / "articulos"
OUTPUT = ROOT / "articles.json"

META_RE = re.compile(
    r'<script[^>]+id=["\']article-meta["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)


def scan_articles():
    entries = []
    if not ARTICLES_DIR.exists():
        return entries

    for html_file in sorted(ARTICLES_DIR.glob("*.html")):
        text = html_file.read_text(encoding="utf-8")
        match = META_RE.search(text)
        if not match:
            print(f"  [aviso] {html_file.name} no tiene bloque article-meta, se omite")
            continue
        try:
            meta = json.loads(match.group(1))
        except json.JSONDecodeError as e:
            print(f"  [error] JSON inválido en {html_file.name}: {e}")
            continue

        slug = f"articulos/{html_file.name}"
        meta["slug"] = slug
        meta.setdefault("comingSoon", False)
        entries.append(meta)
        print(f"  ✓ {slug}")

    return entries


def load_existing_coming_soon():
    if not OUTPUT.exists():
        return []
    try:
        data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [a for a in data if a.get("comingSoon")]


def main():
    print("Escaneando articulos/*.html ...")
    real_entries = scan_articles()
    real_slugs = {a["slug"] for a in real_entries}

    coming_soon = [
        a for a in load_existing_coming_soon() if a.get("slug") not in real_slugs
    ]

    final = real_entries + coming_soon
    final.sort(key=lambda a: a.get("date", ""), reverse=True)

    OUTPUT.write_text(
        json.dumps(final, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\narticles.json actualizado — {len(real_entries)} artículo(s) real(es), "
          f"{len(coming_soon)} placeholder(s) de 'próximamente'.")


if __name__ == "__main__":
    sys.exit(main())
