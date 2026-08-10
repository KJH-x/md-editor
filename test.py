#!/usr/bin/env python3
"""
md-editor Validation & Dev Server

Usage:
  python test.py              # Validate project structure and references
  python test.py --serve      # Start local dev server on :8777
  python test.py --serve --port 3000  # Custom port
"""
import os
import sys
import re
import json
import http.server
import socketserver
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent

REQUIRED_FILES = [
    "index.html",
    "css/style.css",
    "js/editor.js",
    "js/file-io.js",
    "js/actions.js",
    "LICENSE",
    "README.md",
    ".gitignore",
    "_headers",
    "vendor/vditor/LICENSE",
    "vendor/vditor/dist/index.css",
    "vendor/vditor/dist/index.min.js",
]

JS_REQUIRED_PATTERNS = {
    "Vditor init": r"new Vditor\(",
    "mode IR": r"mode:\s*'ir'",
    "localStorage cache disabled": r"cache:\s*\{\s*enable:\s*false",
    "counter enabled": r"counter:\s*\{\s*enable:\s*true",
    "outline enabled": r"outline:\s*\{\s*enable:\s*true",
    "applyPageWidth fn": r"function\s+applyPageWidth\b",
    "toolbar open button": r"name:\s*'open'",
    "toolbar save button": r"name:\s*'save'",
    "toolbar pagewidth button": r"name:\s*'pagewidth'",
    "resize handler": r"addEventListener\('resize'",
    "MutationObserver": r"MutationObserver",
    "ready callback": r"after:\s*function",
    "IndexedDB draft storage": r"indexedDB\.open",
    "explicit Markdown sanitizer": r"sanitize:\s*true",
    "pinned local Vditor assets": r"vendor/vditor",
    "contentAreas fn": r"function\s+contentAreas\b",
    "debug logging": r"function\s+log\b",
    "IIFE wrapper": r"\(function\s*\(\)",
    "use strict": r"'use strict'",
    "md-pagewidth localStorage": r"md-pagewidth",
    "MDModal confirm": r"MDModal\.confirm",
    "MDModal prompt": r"MDModal\.prompt",
    "outline scroll-spy active": r"md-outline-active",
    "file-io sanitize": r"sanitizeFilename",
    "file-io decode": r"decodeFile",
    "action registry": r"MD_ACTIONS",
    "floating format bar module": r"MDFormatBar",
}

CSS_REQUIRED_PATTERNS = {
    "body style": r"body\s*\{",
    "#vditor height": r"#vditor\s*\{",
    "editor-brand": r"\.editor-brand\s*\{",
    "outline active style": r"md-outline-active",
}

def green(s):
    return f"\033[32m{s}\033[0m"

def red(s):
    return f"\033[31m{s}\033[0m"

def yellow(s):
    return f"\033[33m{s}\033[0m"

def validate():
    errors = []
    warnings = []

    print("=" * 56)
    print("  md-editor — Validation")
    print("=" * 56)

    # ---- 1. File existence ----
    print(f"\n{'[1] File existence':<30}", end=" ")
    for f in REQUIRED_FILES:
        if (ROOT / f).exists():
            print(f"  {green(chr(0x2713))} {f}")
        else:
            print(f"  {red(chr(0x2717))} {f} MISSING")
            errors.append(f"Missing file: {f}")

    # ---- 2. HTML references ----
    print(f"\n{'[2] HTML references':<30}")
    html_path = ROOT / "index.html"
    if html_path.exists():
        html = html_path.read_text(encoding="utf-8")
        refs = []

        for attr, pattern in [("href", r'href="([^"]+\.css)"'), ("src", r'src="([^"]+\.js)"')]:
            for m in re.finditer(pattern, html):
                ref = m.group(1)
                label = "external" if ref.startswith("http") else "local"
                refs.append((ref, label))

        for ref, label in refs:
            if label == "external":
                print(f"  {red(chr(0x2717))} {ref} EXTERNAL")
                errors.append(f"External runtime dependency: {ref}")
            else:
                p = ROOT / ref
                if p.exists():
                    print(f"  {green(chr(0x2713))} {ref}")
                else:
                    print(f"  {red(chr(0x2717))} {ref} NOT FOUND")
                    errors.append(f"Reference not found: {ref}")

        if 'id="vditor"' not in html:
            errors.append("Missing #vditor container element")
            print(f"  {red(chr(0x2717))} #vditor container MISSING")
        else:
            print(f"  {green(chr(0x2713))} #vditor container found")

        if 'file-io.js' in html:
            if (ROOT / "js/file-io.js").exists():
                print(f"  {green(chr(0x2713))} file-io.js referenced and present")
            else:
                print(f"  {red(chr(0x2717))} file-io.js referenced but NOT FOUND")
                errors.append("Reference not found: js/file-io.js")
        else:
            print(f"  {yellow('!')} file-io.js reference missing")
            warnings.append("HTML: file-io.js reference missing")
    else:
        errors.append("index.html not found")

    # ---- 3. JS code validation ----
    print(f"\n{'[3] JS structure':<30}")
    js_path = ROOT / "js/editor.js"
    if js_path.exists():
        js = js_path.read_text(encoding="utf-8")
        for label, pattern in JS_REQUIRED_PATTERNS.items():
            if re.search(pattern, js):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {red(chr(0x2717))} {label} MISSING")
                errors.append(f"JS: {label}")
    else:
        errors.append("js/editor.js not found")

    # ---- 4. CSS code validation ----
    print(f"\n{'[4] CSS structure':<30}")
    css_path = ROOT / "css/style.css"
    if css_path.exists():
        css = css_path.read_text(encoding="utf-8")
        for label, pattern in CSS_REQUIRED_PATTERNS.items():
            if re.search(pattern, css):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {yellow('!')} {label} MISSING")
                warnings.append(f"CSS: {label}")
    else:
        errors.append("css/style.css not found")

    # ---- 5. DOM structure analysis (static) ----
    print(f"\n{'[5] Editor initialization check':<30}")
    if js_path.exists():
        js = js_path.read_text(encoding="utf-8")

        checks = {
            "Container selector 'vditor'": r"new Vditor\('vditor'",
            "Toolbar open button": r"name:\s*'open'",
            "Toolbar save button": r"name:\s*'save'",
            "Toolbar pagewidth button": r"name:\s*'pagewidth'",
            "Resize reapplies width": r"applyPageWidth\(pageWidth\)",
            "pageWidth from guarded storage": r"safeStorageGet\('md-pagewidth'",
        }
        for label, pattern in checks.items():
            if re.search(pattern, js):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {red(chr(0x2717))} {label}")
                errors.append(f"Init check: {label}")

        if re.search(r"\bvditor\.resize\s*\(", js):
            print(f"  {red(chr(0x2717))} Unsupported vditor.resize call")
            errors.append("Unsupported vditor.resize call")
        else:
            print(f"  {green(chr(0x2713))} No unsupported vditor.resize call")

        try:
            node = subprocess.run(
                ["node", "--check", str(js_path)],
                capture_output=True,
                text=True,
                check=False,
            )
        except (FileNotFoundError, OSError):
            print("  node not found; skipped JavaScript syntax check")
            node = None
        if node is not None and node.returncode == 0:
            print(f"  {green(chr(0x2713))} JavaScript syntax")
        elif node is not None:
            print(f"  {red(chr(0x2717))} JavaScript syntax")
            errors.append(node.stderr.strip() or "JavaScript syntax check failed")

    # ---- 6. i18n dictionaries ----
    print(f"\n{'[6] i18n dictionaries':<30}")
    i18n_codes = ["zh-CN", "en-US", "es-ES", "hi-IN", "ar-AR"]
    for code in i18n_codes:
        p = ROOT / f"js/i18n/{code}.js"
        if p.exists():
            print(f"  {green(chr(0x2713))} js/i18n/{code}.js")
        else:
            print(f"  {red(chr(0x2717))} js/i18n/{code}.js MISSING")
            errors.append(f"Missing i18n dict: {code}.js")
    idx_path = ROOT / "js/i18n/index.js"
    if idx_path.exists():
        idx = idx_path.read_text(encoding="utf-8")
        for code in ["es-ES", "hi-IN", "ar-AR"]:
            if f"'{code}'" in idx:
                print(f"  {green(chr(0x2713))} index.js registers {code}")
            else:
                print(f"  {red(chr(0x2717))} index.js missing {code}")
                errors.append(f"i18n: index.js missing {code}")
    else:
        errors.append("js/i18n/index.js not found")

    # ---- Summary ----
    print(f"\n{'=' * 56}")
    if errors:
        print(f"{red('FAILED')} — {len(errors)} error(s):")
        for e in errors:
            print(f"  {red(chr(0x2717))} {e}")
    else:
        print(f"{green('ALL CHECKS PASSED')}")

    if warnings:
        print(f"\n{yellow('WARNINGS')}:")
        for w in warnings:
            print(f"  {yellow('!')} {w}")

    return len(errors) == 0


def serve(port=8080):
    os.chdir(ROOT)
    handler = http.server.SimpleHTTPRequestHandler

    class QuietHandler(handler):
        def log_message(self, format, *args):
            print(f"  [{self.log_date_time_string()}] {args[0]}")

    class ReusableTCPServer(socketserver.TCPServer):
        allow_reuse_address = True

    with ReusableTCPServer(("127.0.0.1", port), QuietHandler) as httpd:
        print(f"\n  Dev server running at: {green(f'http://127.0.0.1:{port}')}")
        print(f"  Serving from: {ROOT}")
        print(f"  Press Ctrl+C to stop\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print(f"\n  Server stopped.")


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="md-editor validation & dev server")
    p.add_argument("--serve", action="store_true", help="Start dev server")
    p.add_argument("--port", type=int, default=8777, help="Server port (default: 8777)")
    args = p.parse_args()

    if args.serve:
        serve(args.port)
    else:
        ok = validate()
        sys.exit(0 if ok else 1)
