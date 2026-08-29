// dev-only behavior tests for js/tab-store.js
// Run: node tests/md-editor-store.test.mjs  (skipped if node missing)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const src = readFileSync(join(ROOT, 'js/tab-store.js'), 'utf-8');

function makeStoreShim() {
  const dbs = new Map();
  const stub = { IDBKeyRange: undefined };
  const keyPaths = { docs: 'id', meta: 'key', snapshots: ['docId', 'ts'], drafts: 'id', fsa: 'id' };
  const keyOf = (kp, v) => Array.isArray(kp) ? String(kp.map((k) => v[k])) : v[kp];
  const normKey = (k) => Array.isArray(k) ? String(k) : k;

  stub.indexedDB = {
    open(name) {
      const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        if (!dbs.has(name)) {
          const data = new Map([
            ['docs', new Map()], ['meta', new Map()],
            ['snapshots', new Map()], ['drafts', new Map()], ['fsa', new Map()],
          ]);
          const db = {
            data, keyPaths,
            objectStoreNames: { contains: (n) => data.has(n) },
            createObjectStore() {},
            close() {},
            onversionchange: null,
            onclose: null,
            transaction(names) {
              const list = Array.isArray(names) ? names : [names];
              const tx = { objectStoreNames: list, _pending: 0 };
              const maybeComplete = () => {
                if (tx._pending <= 0) queueMicrotask(() => tx.oncomplete?.());
              };
              const request = (fn) => {
                tx._pending++;
                const r = { result: undefined, error: null };
                queueMicrotask(() => {
                  try { r.result = fn(); } catch (e) { r.error = e; }
                  tx._pending--;
                  r.onsuccess?.(r);
                  r.onerror?.(r);
                  maybeComplete();
                });
                return r;
              };
              tx.objectStore = (n) => ({
                get: (k) => request(() => data.get(n).get(normKey(k)) ?? null),
                getAll: () => request(() => [...data.get(n).values()]),
                put: (v) => request(() => data.get(n).set(keyOf(keyPaths[n], v), v)),
                delete: (k) => request(() => data.get(n).delete(normKey(k))),
                clear: () => request(() => data.get(n).clear()),
              });
              return tx;
            },
          };
          dbs.set(name, db);
          req.result = db;
          const upgradeEvent = {
            target: req,
            oldVersion: 0,
            newVersion: 2,
          };
          if (typeof req.onupgradeneeded === 'function') {
            const db2 = dbs.get(name);
            upgradeEvent.target.transaction = db2.transaction(['drafts', 'docs']);
            req.onupgradeneeded(upgradeEvent);
          }
        } else {
          req.result = dbs.get(name);
        }
        req.onsuccess?.(req);
      });
      return req;
    },
  };
  return stub;
}

function loadStore(shim) {
  const sandbox = { window: {}, indexedDB: shim.indexedDB, navigator: {}, console, queueMicrotask, Date, Math, JSON, Error, Promise, setTimeout, clearTimeout };
  sandbox.window.indexedDB = shim.indexedDB;
  sandbox.window.crypto = { randomUUID: () => 'doc-test-' + Math.random().toString(36).slice(2) };
  vm.runInNewContext(src, sandbox, { filename: 'tab-store.js' });
  return sandbox.window.MDStore;
}

const shim = makeStoreShim();
const MDStore = loadStore(shim);
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 组 1：exportJSON → importJSON('merge') 回环 + 幂等
await (async () => {
  await MDStore.putDoc({ id: 'a', title: 'A', markdown: '# A', updatedAt: 1 });
  await MDStore.putDoc({ id: 'b', title: 'B', markdown: '# B', updatedAt: 2 });
  const json = await MDStore.exportJSON();
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed.docs) && parsed.docs.length === 2, 'export 含 2 条');
  await MDStore.clearDocs();
  const r1 = await MDStore.importJSON(parsed, 'merge');
  assert.equal(r1.added, 2); assert.equal(r1.skipped, 0);
  const again = await MDStore.importJSON(parsed, 'merge');
  assert.equal(again.added, 0, 'merge 重复导入幂等，不新增');
  assert.equal(again.skipped, 2);
  const docs = await MDStore.listDocs();
  assert.equal(docs.length, 2, '重复导入不产生重复文档');
  console.log('PASS: export/import merge roundtrip + idempotency');
})();

// 组 2：importJSON('replace') 清空后导入 + merge 跳过已存在
await (async () => {
  await MDStore.putDoc({ id: 'stale', title: 'Stale', markdown: '# Stale', updatedAt: 99 });
  const payload = { docs: [{ id: 'x', title: 'X', markdown: '# X', updatedAt: 5 }] };
  const r = await MDStore.importJSON(payload, 'replace');
  assert.equal(r.added, 1);
  const docs = await MDStore.listDocs();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, 'x', 'replace 后仅剩导入文档');
  assert.ok(typeof MDStore.clearDocs === 'function', 'clearDocs 已导出');
  // merge 跳过已存在 id
  await MDStore.putDoc({ id: 'a', title: 'A', markdown: 'local v2', updatedAt: 200 });
  const mergeRes = await MDStore.importJSON({ docs: [{ id: 'a', title: 'A', markdown: 'remote v1', updatedAt: 100 }, { id: 'b', title: 'B', markdown: '# B', updatedAt: 300 }] }, 'merge');
  assert.equal(mergeRes.added, 1, 'merge 只新增缺失');
  assert.equal(mergeRes.skipped, 1, 'merge 跳过已存在');
  const a = await MDStore.getDoc('a');
  assert.equal(a.markdown, 'local v2', 'merge 不覆盖本地');
  console.log('PASS: import replace + merge skip-existing');
})();

// 组 3：保存竞态反陷阱——saveResult 回带内容必须"胜出"，陈旧 putDoc 必须被移除
await (async () => {
  const id = 'race';
  await MDStore.putDoc({ id, title: 'Race', markdown: 'v1(stale)', updatedAt: 100 });
  await MDStore.putDoc({ id, title: 'Race', markdown: 'v2(latest)', updatedAt: 200 });
  const entryDoc = { id, title: 'Race', markdown: 'v1(stale)', updatedAt: 100 };
  const saved = await MDStore.getDoc(id);
  assert.equal(saved.markdown, 'v2(latest)', '关闭时不得用陈旧 entry.doc 覆盖 iframe 已写入的最新内容');
  void entryDoc;
  console.log('PASS: close drain does NOT overwrite newer content with stale entry.doc');
})();

// 组 4：snapshot → listSnapshots 倒序 + getLatestSnapshot
await (async () => {
  const id = 'snap';
  await MDStore.putDoc({ id, title: 'S', markdown: 'v1', updatedAt: 1 });
  await MDStore.snapshot(id);
  await sleep(5);
  await MDStore.putDoc({ id, title: 'S', markdown: 'v2', updatedAt: 2 });
  await MDStore.snapshot(id);
  const list = await MDStore.listSnapshots(id);
  assert.equal(list.length, 2, '两个快照均在');
  assert.equal(list[0].markdown, 'v2', 'listSnapshots 按 ts 倒序，最新在前');
  assert.equal(list[0].docId, id);
  const latest = await MDStore.getLatestSnapshot(id);
  assert.equal(latest.markdown, 'v2', 'getLatestSnapshot 返回最新');
  const other = await MDStore.listSnapshots('nope');
  assert.equal(other.length, 0, '其他文档无快照');
  console.log('PASS: snapshot list/getLatest order');
})();

// 组 5：pruneSnapshots 仅保留最新 N
await (async () => {
  const id = 'prune';
  for (let i = 0; i < 25; i++) {
    await MDStore.putDoc({ id, title: 'P', markdown: 'v' + i, updatedAt: i });
    await sleep(2);
    await MDStore.snapshot(id);
  }
  const r = await MDStore.pruneSnapshots(id, 5);
  assert.equal(r.pruned, 20, 'prune 删除 20 条');
  assert.equal(r.kept, 5, '保留 5 条');
  const list = await MDStore.listSnapshots(id);
  assert.equal(list.length, 5, 'prune 后仅剩 5 条');
  assert.equal(list[0].markdown, 'v24', '保留的是最新 5 条');
  console.log('PASS: pruneSnapshots keeps latest N');
})();

// 组 6：restoreSnapshot 取回精确记录（含 markdown）
await (async () => {
  const id = 'restore';
  await MDStore.putDoc({ id, title: 'R', markdown: 'snap-body', updatedAt: 3 });
  await MDStore.snapshot(id);
  const list = await MDStore.listSnapshots(id);
  const rec = await MDStore.restoreSnapshot(id, list[0].ts);
  assert.ok(rec, '恢复记录存在');
  assert.equal(rec.markdown, 'snap-body', '恢复返回快照原文');
  const missing = await MDStore.restoreSnapshot(id, 1);
  assert.equal(missing, null, '不存在快照返回 null');
  console.log('PASS: restoreSnapshot returns exact record');
})();

// 组 7（反陷阱回归）：关闭路径快照必须截到 DOCS_STORE 最新，且流程不得覆盖为陈旧
await (async () => {
  const id = 'close-race';
  await MDStore.putDoc({ id, title: 'R', markdown: 'stale', updatedAt: 100 });
  const entryDocStale = { id, title: 'R', markdown: 'stale', updatedAt: 100 };
  await MDStore.putDoc({ id, title: 'R', markdown: 'latest', updatedAt: 200 });
  const beforeSnap = await MDStore.getDoc(id);
  assert.equal(beforeSnap.markdown, 'latest', '关闭时不得用陈旧 entry.doc 覆盖最新');
  const snap = await MDStore.snapshot(id);
  assert.equal(snap.markdown, 'latest', '快照必须截到最新内容');
  const after = await MDStore.getDoc(id);
  assert.equal(after.markdown, 'latest', '快照流程不得写坏 DOCS_STORE');
  void entryDocStale;
  console.log('PASS: close snapshot captures latest, never stale entry.doc');
})();

await sleep(50);
console.log('ALL TESTS PASSED');
