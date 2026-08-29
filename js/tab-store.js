(function () {
  'use strict';

  var DB_NAME = 'md-editor';
  var DB_VERSION = 2;
  var DOCS_STORE = 'docs';
  var META_STORE = 'meta';
  var SNAPSHOTS_STORE = 'snapshots';
  var DRAFT_STORE = 'drafts';
  var DRAFT_ID = 'current';
  var FSA_STORE = 'fsa';
  var LOCK_NAME = 'md-editor-docs';

  var databasePromise = null;
  var migratedLegacy = null;

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function titleFromMarkdown(markdown) {
    var match = String(markdown || '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : 'untitled';
  }

  function normalizeDoc(doc) {
    var record = {
      id: typeof doc.id === 'string' && doc.id ? doc.id : newId(),
      title: typeof doc.title === 'string' && doc.title ? doc.title : titleFromMarkdown(doc.markdown),
      markdown: typeof doc.markdown === 'string' ? doc.markdown : '',
      updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now()
    };
    if (typeof doc.language === 'string' && doc.language) record.language = doc.language;
    if (Array.isArray(doc.tags)) {
      var tags = [];
      for (var ti = 0; ti < doc.tags.length; ti++) {
        if (typeof doc.tags[ti] === 'string' && doc.tags[ti]) tags.push(doc.tags[ti]);
      }
      record.tags = tags;
    }
    if (typeof doc.folder === 'string' && doc.folder) record.folder = doc.folder;
    return record;
  }

  function openDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error('indexedDB unavailable'));
    }
    if (databasePromise) return databasePromise;

    databasePromise = new Promise(function (resolve, reject) {
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (event) {
        var database = request.result;
        if (!database.objectStoreNames.contains(DRAFT_STORE)) {
          database.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(FSA_STORE)) {
          database.createObjectStore(FSA_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(DOCS_STORE)) {
          database.createObjectStore(DOCS_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(SNAPSHOTS_STORE)) {
          database.createObjectStore(SNAPSHOTS_STORE, { keyPath: ['docId', 'ts'] });
        }
        if (event.oldVersion < 2) {
          var transaction = event.target.transaction;
          var get = transaction.objectStore(DRAFT_STORE).get(DRAFT_ID);
          get.onsuccess = function () {
            var record = get.result;
            if (record && typeof record.markdown === 'string') {
              migratedLegacy = {
                id: newId(),
                title: titleFromMarkdown(record.markdown),
                markdown: record.markdown,
                updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
              };
              transaction.objectStore(DOCS_STORE).put(migratedLegacy);
            }
          };
        }
      };
      request.onsuccess = function () {
        var database = request.result;
        database.onversionchange = function () { database.close(); };
        database.onclose = function () { databasePromise = null; };
        resolve(database);
      };
      request.onerror = function () {
        databasePromise = null;
        reject(request.error || new Error('indexedDB open failed'));
      };
      request.onblocked = function () {
        databasePromise = null;
        reject(new Error('indexedDB blocked'));
      };
    });
    return databasePromise;
  }

  function withLock(fn) {
    if (navigator.locks && navigator.locks.request) {
      return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, function () {
        return fn();
      });
    }
    return fn();
  }

  function listDocs() {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(DOCS_STORE, 'readonly')
          .objectStore(DOCS_STORE).getAll();
        request.onsuccess = function () {
          var docs = request.result || [];
          docs.sort(function (a, b) {
            return (b.updatedAt || 0) - (a.updatedAt || 0);
          });
          resolve(docs);
        };
        request.onerror = function () {
          reject(request.error || new Error('indexedDB read failed'));
        };
      });
    });
  }

  function getDoc(id) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(DOCS_STORE, 'readonly')
          .objectStore(DOCS_STORE).get(id);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () {
          reject(request.error || new Error('indexedDB read failed'));
        };
      });
    });
  }

  function putDoc(doc) {
    if (!doc || typeof doc.id !== 'string' || !doc.id) {
      return Promise.reject(new Error('doc requires an id'));
    }
    var record = normalizeDoc(doc);
    return withLock(function () {
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(DOCS_STORE, 'readwrite');
          transaction.objectStore(DOCS_STORE).put(record);
          transaction.oncomplete = function () { resolve(record); };
          transaction.onerror = function () {
            reject(transaction.error || new Error('indexedDB write failed'));
          };
          transaction.onabort = function () {
            reject(transaction.error || new Error('indexedDB write aborted'));
          };
        });
      });
    });
  }

  function deleteDoc(id) {
    return withLock(function () {
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(DOCS_STORE, 'readwrite');
          transaction.objectStore(DOCS_STORE).delete(id);
          transaction.oncomplete = function () { resolve(true); };
          transaction.onerror = function () {
            reject(transaction.error || new Error('indexedDB delete failed'));
          };
          transaction.onabort = function () {
            reject(transaction.error || new Error('indexedDB delete aborted'));
          };
        });
      });
    });
  }

  function snapshot(docId) {
    return withLock(function () {
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction([DOCS_STORE, SNAPSHOTS_STORE], 'readwrite');
          var get = transaction.objectStore(DOCS_STORE).get(docId);
          var snapshotRecord = null;
          get.onsuccess = function () {
            var doc = get.result;
            if (doc) {
              snapshotRecord = {
                docId: docId,
                ts: Date.now(),
                markdown: typeof doc.markdown === 'string' ? doc.markdown : '',
                title: titleFromMarkdown(doc.markdown),
                size: String(doc.markdown || '').length
              };
              transaction.objectStore(SNAPSHOTS_STORE).put(snapshotRecord);
            }
          };
          transaction.oncomplete = function () { resolve(snapshotRecord); };
          transaction.onerror = function () {
            reject(transaction.error || new Error('indexedDB snapshot failed'));
          };
          transaction.onabort = function () {
            reject(transaction.error || new Error('indexedDB snapshot aborted'));
          };
        });
      });
    });
  }

  function listSnapshots(docId) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(SNAPSHOTS_STORE, 'readonly')
          .objectStore(SNAPSHOTS_STORE).getAll();
        request.onsuccess = function () {
          var all = request.result || [];
          var out = [];
          for (var i = 0; i < all.length; i++) {
            var record = all[i];
            if (record && record.docId === docId) out.push(record);
          }
          out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
          resolve(out);
        };
        request.onerror = function () {
          reject(request.error || new Error('indexedDB read failed'));
        };
      });
    });
  }

  function getLatestSnapshot(docId) {
    return listSnapshots(docId).then(function (list) {
      return list.length ? list[0] : null;
    });
  }

  function pruneSnapshots(docId, max) {
    var keep = typeof max === 'number' && max > 0 ? Math.floor(max) : 20;
    return withLock(function () {
      return openDatabase().then(function (database) {
        return listSnapshots(docId).then(function (list) {
          if (list.length <= keep) return { kept: list.length, pruned: 0 };
          var remove = list.slice(keep);
          return new Promise(function (resolve, reject) {
            var transaction = database.transaction(SNAPSHOTS_STORE, 'readwrite');
            var store = transaction.objectStore(SNAPSHOTS_STORE);
            for (var i = 0; i < remove.length; i++) {
              store.delete([remove[i].docId, remove[i].ts]);
            }
            transaction.oncomplete = function () {
              resolve({ kept: keep, pruned: remove.length });
            };
            transaction.onerror = function () {
              reject(transaction.error || new Error('indexedDB prune failed'));
            };
            transaction.onabort = function () {
              reject(transaction.error || new Error('indexedDB prune aborted'));
            };
          });
        });
      });
    });
  }

  function restoreSnapshot(docId, ts) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(SNAPSHOTS_STORE, 'readonly')
          .objectStore(SNAPSHOTS_STORE).get([docId, ts]);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () {
          reject(request.error || new Error('indexedDB read failed'));
        };
      });
    });
  }

  function deleteSnapshot(docId, ts) {
    return withLock(function () {
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(SNAPSHOTS_STORE, 'readwrite');
          transaction.objectStore(SNAPSHOTS_STORE).delete([docId, ts]);
          transaction.oncomplete = function () { resolve(true); };
          transaction.onerror = function () {
            reject(transaction.error || new Error('indexedDB delete failed'));
          };
          transaction.onabort = function () {
            reject(transaction.error || new Error('indexedDB delete aborted'));
          };
        });
      });
    });
  }

  function exportJSON() {
    return listDocs().then(function (docs) {
      return JSON.stringify({ docs: docs, exportedAt: Date.now() });
    });
  }

  function clearDocs() {
    return withLock(function () {
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(DOCS_STORE, 'readwrite');
          transaction.objectStore(DOCS_STORE).clear();
          transaction.oncomplete = function () { resolve(true); };
          transaction.onerror = function () {
            reject(transaction.error || new Error('indexedDB clear failed'));
          };
          transaction.onabort = function () {
            reject(transaction.error || new Error('indexedDB clear aborted'));
          };
        });
      });
    });
  }

  function writeImported(database, records, mode) {
    var added = 0;
    var skipped = 0;
    function next(i) {
      if (i >= records.length) {
        return Promise.resolve({ added: added, skipped: skipped, total: records.length });
      }
      var record = records[i];
      if (mode === 'merge') {
        return getDoc(record.id).then(function (existing) {
          if (existing) { skipped++; return next(i + 1); }
          return putDoc(record).then(function () { added++; return next(i + 1); });
        });
      }
      return putDoc(record).then(function () { added++; return next(i + 1); });
    }
    return next(0);
  }

  function importJSON(data, mode) {
    mode = mode === 'replace' ? 'replace' : 'merge';
    var parsed = data;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        return Promise.reject(new Error('invalid JSON payload'));
      }
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.docs)) {
      return Promise.reject(new Error('invalid import payload'));
    }
    var records = [];
    for (var i = 0; i < parsed.docs.length; i++) {
      var item = parsed.docs[i];
      if (!item || typeof item !== 'object') continue;
      if (typeof item.markdown !== 'string') continue;
      if (typeof item.id === 'string' && item.id.length > 256) continue;
      records.push(normalizeDoc(item));
    }
    return withLock(function () {
      return openDatabase().then(function (database) {
        var run = function () { return writeImported(database, records, mode); };
        return mode === 'replace' ? clearDocs(database).then(run) : run();
      });
    });
  }

  function deleteLegacyDraft() {
    return withLock(function () {
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(DRAFT_STORE, 'readwrite');
          transaction.objectStore(DRAFT_STORE).delete(DRAFT_ID);
          transaction.oncomplete = function () { resolve(); };
          transaction.onerror = function () {
            reject(transaction.error || new Error('indexedDB delete failed'));
          };
          transaction.onabort = function () {
            reject(transaction.error || new Error('indexedDB delete aborted'));
          };
        });
      });
    });
  }

  function migrateLegacy() {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(DRAFT_STORE, 'readonly')
          .objectStore(DRAFT_STORE).get(DRAFT_ID);
        request.onsuccess = function () {
          var record = request.result;
          if (migratedLegacy) {
            deleteLegacyDraft().then(function () {
              resolve(migratedLegacy);
            }, reject);
            return;
          }
          if (!record || typeof record.markdown !== 'string') {
            resolve(null);
            return;
          }
          var doc = {
            id: newId(),
            title: titleFromMarkdown(record.markdown),
            markdown: record.markdown,
            updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
          };
          putDoc(doc).then(function () {
            migratedLegacy = doc;
            return deleteLegacyDraft();
          }).then(function () {
            resolve(doc);
          }, reject);
        };
        request.onerror = function () {
          reject(request.error || new Error('indexedDB read failed'));
        };
      });
    });
  }

  window.MDStore = {
    listDocs: listDocs,
    getDoc: getDoc,
    putDoc: putDoc,
    deleteDoc: deleteDoc,
    snapshot: snapshot,
    listSnapshots: listSnapshots,
    getLatestSnapshot: getLatestSnapshot,
    pruneSnapshots: pruneSnapshots,
    restoreSnapshot: restoreSnapshot,
    deleteSnapshot: deleteSnapshot,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearDocs: clearDocs,
    migrateLegacy: migrateLegacy
  };

  openDatabase().catch(function () {
    databasePromise = null;
  });
})();
