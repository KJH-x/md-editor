# VENDOR_UPDATE — Upgrading vendored runtime libraries

`vendor/` is fully self-hosted and pinned; there is no `npm install` at build or CI time.
The two vendored libraries:

| Library | Repo | Pinned version | Vendored files |
|---------|------|----------------|----------------|
| vditor | https://github.com/Vanessa219/vditor | 3.11.2 | `vendor/vditor/{LICENSE,dist/}` |
| dockview-core | https://github.com/mathuo/dockview | 6.2.2 | `vendor/dockview/{LICENSE,index.mjs,dockview.css}` |

Cloudflare serves `vendor/*` with `Cache-Control: public, max-age=31536000, immutable`
(see `_headers`), so a vendor update is **not** picked up by clients unless the cache is purged.

> **Every deploy note**: `/js/*` and `/css/*` use `stale-while-revalidate` and Pages may keep a
> stale edge copy for a short window after any deploy (not just vendor updates). If a deployment
> isn't picked up, purge `/js/*`, `/css/*`, `/index.html`, `/sw.js` (see step 3) — or the whole
> zone with `{"purge_everything":true}`.

> **Clean-URL note**: Cloudflare Pages redirects `vditor-shell.html` → `/vditor-shell` (308).
> All code must reference the clean URL `/vditor-shell` (the shell's iframe `src` and the SW
> precache entry); `_headers` preloads are scoped to `/vditor-shell`. Local dev serves the
> extensionless path via a fallback in `test.py` so behavior matches production.

> Replace `<REPO>` below with the path to this repo, and `<VER>` with the target version.

## 1. Download the pinned release and replace the subtree

### vditor (source tarball, `dist/` is prebuilt)

```bash
cd /tmp/vendor-update
VER=3.11.2
curl -fL -o vditor.tar.gz "https://github.com/Vanessa219/vditor/archive/refs/tags/v${VER}.tar.gz"
tar -xzf vditor.tar.gz
rm -rf <REPO>/vendor/vditor
mkdir -p <REPO>/vendor/vditor
cp -r "vditor-${VER}/dist" <REPO>/vendor/vditor/dist
cp "vditor-${VER}/LICENSE" <REPO>/vendor/vditor/LICENSE
```

### dockview-core (npm tarball — upstream publishes no release assets)

```bash
cd /tmp/vendor-update
VER=6.2.2
curl -fL -o dockview-core.tgz "https://registry.npmjs.org/dockview-core/-/dockview-core-${VER}.tgz"
tar -xzf dockview-core.tgz
rm -rf <REPO>/vendor/dockview
mkdir -p <REPO>/vendor/dockview
cp package/dist/index.mjs <REPO>/vendor/dockview/index.mjs
cp package/dist/dockview.css <REPO>/vendor/dockview/dockview.css
cp package/LICENSE <REPO>/vendor/dockview/LICENSE
```

Verify nothing unexpected changed in the subtree:

```bash
cd <REPO> && git status vendor/ && git diff --stat vendor/
```

## 2. Bump `VER` in `sw.js` and refresh the precache list

When a service worker is deployed (`sw.js`), every runtime resource is precached and the SW
version drives cache-busting. After replacing `vendor/`:

1. Bump the `VER` constant in `sw.js` (e.g. `VER = '2026-08-10'` → new date) so all clients
   install the new SW on next load.
2. Regenerate the `PRECACHE` array from the current file tree, keeping only runtime assets
   (the HTML entry points, `css/`, `js/`, `vendor/`, `manifest.webmanifest`, icons — **not**
   `README.md`, `VENDOR_UPDATE.md`, `DEPLOY_PLAN.md`, `test.py`, docs):

```bash
cd <REPO>
python -c "import pathlib; print('\n'.join(sorted('/'+str(p).replace(chr(92),'/') for p in pathlib.Path('.').rglob('*') if p.is_file() and '.git' not in p.parts)))"
```

Paste the filtered output into `PRECACHE`. Commit the updated `vendor/`, `sw.js`, and
`_headers` together. If `sw.js` is not yet present in the tree, skip this step.

## 3. Cloudflare Purge Cache

`vendor/*` is immutable for 1 year, so a fresh subtree with the same URLs is never revalidated
by browsers. Purge the affected URLs (or the whole zone):

```bash
# zone + token with "Cache Purge" permission
export CF_ZONE_ID="<zone id>"
export CF_API_TOKEN="<api token>"

# targeted purge — exact URLs, or {"purge_everything":true} to be safe
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"files":["https://md.nslc.top/vendor/vditor/dist/index.min.js","https://md.nslc.top/vendor/vditor/dist/index.css","https://md.nslc.top/vendor/dockview/index.mjs","https://md.nslc.top/vendor/dockview/dockview.css","https://md.nslc.top/sw.js"]}'
```

Purge `/sw.js` too — it is served `no-cache`, but purging removes any stale edge copy.

## 4. Run the validation gate

```bash
cd <REPO> && python test.py     # must end with ALL CHECKS PASSED
```

## 5. Post-deploy `curl -I` spot checks

```bash
for u in \
  https://md.nslc.top/ \
  https://md.nslc.top/vendor/vditor/dist/index.min.js \
  https://md.nslc.top/vendor/dockview/index.mjs \
  https://md.nslc.top/sw.js; do
  curl -sI "$u" | rg -i "HTTP/|content-type|cache-control|cf-cache-status"
  echo "---"
done
```

Expected: `200 OK`; `cf-cache-status: MISS` (then `HIT` on the second request); vendor assets
`cache-control: public, max-age=31536000, immutable`; `/sw.js` `cache-control: no-cache`.

## 6. Playwright offline / multi-tab re-check

With the browser agent running (global config, port 8932):

```powershell
Start-Process node -ArgumentList "browser-agent.mjs" -WorkingDirectory "C:\Users\NSLC\.config\opencode\agent" -WindowStyle Minimized
Start-Sleep 4; netstat -ano | Select-String "8932"   # expect LISTENING
```

In the agent session:

1. Load `https://md.nslc.top`, wait for the shell and the first vditor tab.
2. Open 2–3 more tabs (`Ctrl+T`), switch themes and language, make an edit, then reload.
3. Switch the DevTools Network panel to **Offline** (or `navigator.onLine=false` + reload) and
   confirm the shell and all tabs render from the SW cache with no network requests failing.
4. Restore online mode and verify save/persist still works.

Regression here almost always means the precache list (step 2) missed a newly added file.
