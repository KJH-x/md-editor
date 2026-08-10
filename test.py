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
    "vditor-shell.html",
    "css/style.css",
    "js/editor.js",
    "js/shell.js",
    "js/file-io.js",
    "js/fsa.js",
    "js/tab-store.js",
    "js/actions.js",
    "js/ui/find-replace.js",
    "sw.js",
    "js/sw-register.js",
    "vendor/dockview/index.mjs",
    "vendor/dockview/dockview.css",
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
    "command palette": r"MDCommandPalette",
    "slash menu": r"MDSlashMenu",
    "floating format bar module": r"MDFormatBar",
    "find & replace": r"MDFindReplace",
    "copyAsHtml fn": r"function\s+copyAsHtml\b",
    "ClipboardItem write": r"ClipboardItem",
    "printToPdf fn": r"function\s+printToPdf\b",
    "shareCurrent fn": r"function\s+shareCurrent\b",
    "export toolbar button": r"name:\s*'export2'",
    "custom vditor i18n object": r"mdVditorI18n",
    "RTL detection": r"isRTL",
    "accessibility keys (a11y)": r"a11y",
    "aria-label usage": r"aria-label",
    "tab bridge": r"TabHost",
    "postMessage bridge": r"postMessage",
    "URLSearchParams": r"URLSearchParams",
}

CSS_REQUIRED_PATTERNS = {
    "body style": r"body\s*\{",
    "#vditor height": r"#vditor\s*\{",
    "editor-brand": r"\.editor-brand\s*\{",
    "outline active style": r"md-outline-active",
}

FSA_REQUIRED_PATTERNS = {
    "FSA open picker": r"showOpenFilePicker",
    "FSA save picker": r"showSaveFilePicker",
    "FSA writable": r"createWritable",
}

TAB_STORE_REQUIRED_PATTERNS = {
    "MDStore global": r"window\.MDStore",
    "listDocs API": r"\blistDocs\b",
    "getDoc API": r"\bgetDoc\b",
    "putDoc API": r"\bputDoc\b",
    "deleteDoc API": r"\bdeleteDoc\b",
    "snapshot API": r"\bsnapshot\b",
    "exportJSON API": r"\bexportJSON\b",
    "importJSON API": r"\bimportJSON\b",
    "migrateLegacy API": r"\bmigrateLegacy\b",
    "navigator locks wrap": r"navigator\.locks\.request",
    "IndexedDB open": r"indexedDB\.open",
    "IIFE wrapper": r"\(function\s*\(\)",
    "use strict": r"'use strict'",
}

SHELL_JS_REQUIRED_PATTERNS = {
    "Dockview import": r"DockviewComponent",
    "Dockview instantiation": r"new\s+DockviewComponent",
    "addPanel API": r"\.addPanel\(",
    "component name": r"'vditor-tab'",
    "iframe host": r"vditor-shell\.html",
    "sandbox flags": r"allow-scripts allow-same-origin",
    "postMessage router": r"postMessage",
    "message origin check": r"event\.origin\s*!==\s*window\.location\.origin",
    "MDStore.listDocs": r"MDStore\.listDocs",
    "MDStore.putDoc": r"MDStore\.putDoc",
    "layout key": r"md-editor-layout",
    "layout restore": r"fromJSON",
    "layout serialization": r"toJSON",
    "setTheme broadcast": r"setTheme",
    "setLang broadcast": r"setLang",
    "setPageWidth broadcast": r"setPageWidth",
    "new tab shortcut": r"Ctrl\+T",
    "close tab shortcut": r"Ctrl\+W",
    "save active": r"saveActiveTab",
    "dirty badge": r"setTitle\(\(dirty",
}

SW_REQUIRED_PATTERNS = {
    "version constant": r"const\s+VER\s*=\s*\d+",
    "shell cache name": r"md-shell-v",
    "runtime cache name": r"md-runtime-v",
    "precache list": r"(?i)precache",
    "allSettled install": r"Promise\.allSettled",
    "skipWaiting": r"skipWaiting",
    "clients.claim": r"clients\.claim",
    "navigate network-first": r"mode\s*===\s*'navigate'",
    "vendor cache-first": r"/vendor/",
}

SW_REGISTER_REQUIRED_PATTERNS = {
    "serviceWorker guard": r"'serviceWorker' in navigator",
    "register /sw.js": r"register\('/sw\.js'",
    "scope /": r"scope\s*:\s*'/'",
    "controllerchange": r"controllerchange",
    "md-sw-update dispatch": r"md-sw-update",
    "IIFE wrapper": r"\(function\s*\(\)",
    "use strict": r"'use strict'",
}

SHELL_SW_REQUIRED_PATTERNS = {
    "md-sw-update listener": r"md-sw-update",
    "updateReady i18n": r"sw\.updateReady",
    "statusbar toast": r"showStatus",
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
    html_paths = ["index.html", "vditor-shell.html"]
    for html_path in html_paths:
        html_file = ROOT / html_path
        if not html_file.exists():
            errors.append(f"{html_path} not found")
            print(f"  {red(chr(0x2717))} {html_path} MISSING")
            continue
        html = html_file.read_text(encoding="utf-8")
        refs = []

        for attr, pattern in [("href", r'href="([^"]+\.css)"'), ("src", r'src="([^"]+\.js)"')]:
            for m in re.finditer(pattern, html):
                ref = m.group(1)
                label = "external" if ref.startswith("http") else "local"
                refs.append((ref, label))

        for ref, label in refs:
            if label == "external":
                print(f"  {red(chr(0x2717))} {html_path}: {ref} EXTERNAL")
                errors.append(f"External runtime dependency: {ref} ({html_path})")
            else:
                p = ROOT / ref
                if p.exists():
                    print(f"  {green(chr(0x2713))} {html_path}: {ref}")
                else:
                    print(f"  {red(chr(0x2717))} {html_path}: {ref} NOT FOUND")
                    errors.append(f"Reference not found: {ref} ({html_path})")

        if html_path == "vditor-shell.html":
            if 'id="vditor"' not in html:
                errors.append(f"Missing #vditor container element ({html_path})")
                print(f"  {red(chr(0x2717))} {html_path}: #vditor container MISSING")
            else:
                print(f"  {green(chr(0x2713))} {html_path}: #vditor container found")
        else:
            shell_checks = [
                ("dockview container", 'id="dockview-container"'),
                ("module shell.js", 'type="module" src="js/shell.js"'),
                ("dockview css ref", 'href="vendor/dockview/dockview.css"'),
            ]
            for label, pattern in shell_checks:
                if pattern in html:
                    print(f"  {green(chr(0x2713))} {html_path}: {label} found")
                else:
                    print(f"  {red(chr(0x2717))} {html_path}: {label} MISSING")
                    errors.append(f"Missing {label} ({html_path})")

        if 'file-io.js' in html:
            if (ROOT / "js/file-io.js").exists():
                print(f"  {green(chr(0x2713))} {html_path}: file-io.js referenced and present")
            else:
                print(f"  {red(chr(0x2717))} {html_path}: file-io.js referenced but NOT FOUND")
                errors.append(f"Reference not found: js/file-io.js ({html_path})")
        else:
            print(f"  {yellow('!')} {html_path}: file-io.js reference missing")
            warnings.append(f"HTML: file-io.js reference missing ({html_path})")

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

    # ---- 4. FSA module validation ----
    print(f"\n{'[4] FSA module':<30}")
    fsa_path = ROOT / "js/fsa.js"
    if fsa_path.exists():
        fsa = fsa_path.read_text(encoding="utf-8")
        for label, pattern in FSA_REQUIRED_PATTERNS.items():
            if re.search(pattern, fsa):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {red(chr(0x2717))} {label} MISSING")
                errors.append(f"FSA: {label}")
    else:
        print(f"  {red(chr(0x2717))} js/fsa.js MISSING")
        errors.append("js/fsa.js not found")

    # ---- 5. Tab store module validation ----
    print(f"\n{'[5] Tab store module':<30}")
    tab_store_path = ROOT / "js/tab-store.js"
    if tab_store_path.exists():
        tab_store = tab_store_path.read_text(encoding="utf-8")
        for label, pattern in TAB_STORE_REQUIRED_PATTERNS.items():
            if re.search(pattern, tab_store):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {red(chr(0x2717))} {label} MISSING")
                errors.append(f"TabStore: {label}")
    else:
        print(f"  {red(chr(0x2717))} js/tab-store.js MISSING")
        errors.append("js/tab-store.js not found")

    # ---- 5b. Shell module validation ----
    print(f"\n{'[5b] Shell module (js/shell.js)':<30}")
    shell_path = ROOT / "js/shell.js"
    if shell_path.exists():
        shell = shell_path.read_text(encoding="utf-8")
        for label, pattern in SHELL_JS_REQUIRED_PATTERNS.items():
            if re.search(pattern, shell):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {red(chr(0x2717))} {label} MISSING")
                errors.append(f"ShellJS: {label}")
        for label, pattern in SHELL_SW_REQUIRED_PATTERNS.items():
            if re.search(pattern, shell):
                print(f"  {green(chr(0x2713))} SW toast: {label}")
            else:
                print(f"  {red(chr(0x2717))} SW toast: {label} MISSING")
                errors.append(f"ShellJS SW toast: {label}")
        try:
            shell_node = subprocess.run(
                ["node", "--input-type=module", "--check"],
                input=shell,
                capture_output=True,
                text=True,
                check=False,
            )
        except (FileNotFoundError, OSError):
            print("  node not found; skipped ESM syntax check")
            shell_node = None
        if shell_node is not None and shell_node.returncode == 0:
            print(f"  {green(chr(0x2713))} ESM syntax (node --check)")
        elif shell_node is not None:
            print(f"  {red(chr(0x2717))} ESM syntax")
            errors.append(shell_node.stderr.strip() or "shell.js ESM syntax check failed")
    else:
        print(f"  {red(chr(0x2717))} js/shell.js MISSING")
        errors.append("js/shell.js not found")

    # ---- 5c. Service worker (sw.js) ----
    print(f"\n{'[5c] Service worker (sw.js)':<30}")
    sw_path = ROOT / "sw.js"
    if sw_path.exists():
        sw = sw_path.read_text(encoding="utf-8")
        for label, pattern in SW_REQUIRED_PATTERNS.items():
            if re.search(pattern, sw):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {red(chr(0x2717))} {label} MISSING")
                errors.append(f"SW: {label}")
        if re.search(r"\bimport\b", sw):
            print(f"  {red(chr(0x2717))} sw.js must not use import")
            errors.append("SW: sw.js must not use import")
        else:
            print(f"  {green(chr(0x2713))} no ESM import")
        precache_section = re.search(r"const\s+PRECACHE\s*=\s*\[(.*?)\]", sw, re.S)
        if precache_section:
            paths = re.findall(r"['\"]([^'\"]+)['\"]", precache_section.group(1))
            if not paths:
                print(f"  {red(chr(0x2717))} precache list is empty")
                errors.append("SW: precache list is empty")
            for p in paths:
                rel = p.lstrip("/")
                if (ROOT / rel).exists():
                    print(f"  {green(chr(0x2713))} precache: {p}")
                else:
                    print(f"  {red(chr(0x2717))} precache: {p} MISSING")
                    errors.append(f"SW: precache path not found on disk: {p}")
        else:
            print(f"  {red(chr(0x2717))} PRECACHE array not found")
            errors.append("SW: PRECACHE array not found")
        try:
            sw_node = subprocess.run(
                ["node", "--check", str(sw_path)],
                capture_output=True,
                text=True,
                check=False,
            )
        except (FileNotFoundError, OSError):
            print("  node not found; skipped JavaScript syntax check")
            sw_node = None
        if sw_node is not None and sw_node.returncode == 0:
            print(f"  {green(chr(0x2713))} JavaScript syntax")
        elif sw_node is not None:
            print(f"  {red(chr(0x2717))} JavaScript syntax")
            errors.append(sw_node.stderr.strip() or "sw.js JavaScript syntax check failed")
    else:
        print(f"  {red(chr(0x2717))} sw.js MISSING")
        errors.append("sw.js not found")

    # ---- 5d. SW registration (js/sw-register.js) ----
    print(f"\n{'[5d] SW registration (js/sw-register.js)':<30}")
    swr_path = ROOT / "js/sw-register.js"
    if swr_path.exists():
        swr = swr_path.read_text(encoding="utf-8")
        for label, pattern in SW_REGISTER_REQUIRED_PATTERNS.items():
            if re.search(pattern, swr):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {red(chr(0x2717))} {label} MISSING")
                errors.append(f"SWRegister: {label}")
        try:
            swr_node = subprocess.run(
                ["node", "--check", str(swr_path)],
                capture_output=True,
                text=True,
                check=False,
            )
        except (FileNotFoundError, OSError):
            print("  node not found; skipped JavaScript syntax check")
            swr_node = None
        if swr_node is not None and swr_node.returncode == 0:
            print(f"  {green(chr(0x2713))} JavaScript syntax")
        elif swr_node is not None:
            print(f"  {red(chr(0x2717))} JavaScript syntax")
            errors.append(swr_node.stderr.strip() or "js/sw-register.js JavaScript syntax check failed")
    else:
        print(f"  {red(chr(0x2717))} js/sw-register.js MISSING")
        errors.append("js/sw-register.js not found")

    # ---- 6. CSS code validation ----
    print(f"\n{'[6] CSS structure':<30}")
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

    # ---- 6. _headers CSP & caching ----
    print(f"\n{'[6] _headers':<30}")
    headers_path = ROOT / "_headers"
    if headers_path.exists():
        headers = headers_path.read_text(encoding="utf-8")
        headers_required = {
            "frame-ancestors 'self'": r"frame-ancestors 'self'",
            "X-Frame-Options: SAMEORIGIN": r"X-Frame-Options: SAMEORIGIN",
            "frame-src 'self'": r"frame-src 'self'",
            "connect-src 'self'": r"connect-src 'self'",
            "upgrade-insecure-requests": r"upgrade-insecure-requests",
            "clipboard-write=(self)": r"clipboard-write=\(self\)",
            "web-share=(self)": r"web-share=\(self\)",
            "/sw.js block": r"^/sw\.js$",
            "/sw.js no-cache": r"Cache-Control: no-cache",
        }
        for label, pattern in headers_required.items():
            if re.search(pattern, headers, re.MULTILINE):
                print(f"  {green(chr(0x2713))} {label}")
            else:
                print(f"  {red(chr(0x2717))} {label} MISSING")
                errors.append(f"_headers: {label}")
    else:
        print(f"  {red(chr(0x2717))} _headers MISSING")
        errors.append("Missing file: _headers")

    # ---- 7. DOM structure analysis (static) ----
    print(f"\n{'[7] Editor initialization check':<30}")
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

    # ---- 8. i18n dictionaries ----
    print(f"\n{'[8] i18n dictionaries':<30}")
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

    # ---- 8. PWA manifest & icons ----
    print(f"\n{'[8] PWA manifest & icons':<30}")
    manifest_path = ROOT / "manifest.webmanifest"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            print(f"  {green(chr(0x2713))} manifest.webmanifest parses as JSON")
        except json.JSONDecodeError as e:
            errors.append(f"PWA: manifest.webmanifest invalid JSON ({e})")
            manifest = None
        if manifest is not None:
            if manifest.get("display") == "standalone":
                print(f"  {green(chr(0x2713))} display: standalone")
            else:
                errors.append("PWA: display is not 'standalone'")
                print(f"  {red(chr(0x2717))} display is not 'standalone'")
            icons = manifest.get("icons", [])
            for ico in icons:
                p = ROOT / ico["src"].lstrip("/")
                if p.exists():
                    print(f"  {green(chr(0x2713))} icon {ico['src']}")
                else:
                    errors.append(f"PWA: icon missing {ico['src']}")
                    print(f"  {red(chr(0x2717))} icon {ico['src']} MISSING")
            try:
                import PIL.Image
                pil_ok = True
            except ImportError:
                pil_ok = False
            if pil_ok:
                for ico in icons:
                    p = ROOT / ico["src"].lstrip("/")
                    if p.exists():
                        w, h = PIL.Image.open(p).size
                        expected = tuple(int(v) for v in ico["sizes"].split("x"))
                        if (w, h) == expected:
                            print(f"  {green(chr(0x2713))} {ico['src']} {w}x{h}")
                        else:
                            errors.append(f"PWA: {ico['src']} is {w}x{h}, expected {expected}")
                            print(f"  {red(chr(0x2717))} {ico['src']} {w}x{h} != {expected}")
            else:
                print(f"  {yellow('!')} PIL unavailable; icon dimensions not verified")
    else:
        errors.append("manifest.webmanifest not found")
        print(f"  {red(chr(0x2717))} manifest.webmanifest MISSING")

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
