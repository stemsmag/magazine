#!/usr/bin/env python3
"""
Genera sitemap.xml escaneando todos los archivos .html del repositorio.
Se ejecuta automáticamente vía GitHub Actions en cada push a main,
pero también se puede correr a mano: python3 generate_sitemap.py
"""
import os
import subprocess
import sys
from datetime import datetime, timezone

BASE_URL = "https://stemsmag.fyi"

# Carpetas que se ignoran por completo
EXCLUDE_DIRS = {".git", ".github", "node_modules", ".venv", "__pycache__"}

# Archivos .html individuales que NO deben entrar al sitemap
# (páginas de error, plantillas, borradores, etc.)
EXCLUDE_FILES = {"404.html"}


def get_last_modified(filepath):
    """Fecha del último commit que tocó el archivo.
    Si no hay historial de git disponible, usa la fecha de modificación en disco."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cI", "--", filepath],
            capture_output=True, text=True, check=True
        )
        date = result.stdout.strip()
        if date:
            return date[:10]
    except Exception:
        pass
    return datetime.fromtimestamp(os.path.getmtime(filepath), tz=timezone.utc).strftime("%Y-%m-%d")


def find_html_files(root="."):
    html_files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for name in filenames:
            if name.endswith(".html") and name not in EXCLUDE_FILES:
                full = os.path.normpath(os.path.join(dirpath, name))
                html_files.append(full)
    return sorted(html_files)


def to_url(filepath):
    rel = filepath.replace(os.sep, "/")
    if rel.startswith("./"):
        rel = rel[2:]
    if rel == "index.html":
        return BASE_URL + "/"
    if rel.endswith("/index.html"):
        return BASE_URL + "/" + rel[: -len("index.html")]
    return BASE_URL + "/" + rel


def priority_for(url):
    # Portada = prioridad más alta; entre más profunda la URL, menos prioridad.
    path = url.replace(BASE_URL, "")
    depth = path.strip("/").count("/")
    if path == "/":
        return "1.0"
    if depth == 0:
        return "0.8"
    return "0.6"


def build_sitemap(files):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for f in files:
        url = to_url(f)
        lastmod = get_last_modified(f)
        priority = priority_for(url)
        lines.append("  <url>")
        lines.append(f"    <loc>{url}</loc>")
        lines.append(f"    <lastmod>{lastmod}</lastmod>")
        lines.append(f"    <priority>{priority}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main():
    files = find_html_files(".")
    if not files:
        print("No se encontraron archivos .html", file=sys.stderr)
        sys.exit(1)
    sitemap = build_sitemap(files)
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write(sitemap)
    print(f"sitemap.xml generado con {len(files)} URLs.")


if __name__ == "__main__":
    main()
