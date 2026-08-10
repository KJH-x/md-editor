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
                markdown: typeof doc.markdown === 'string' ? doc.markdown : ''
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

  function exportJSON() {
    return listDocs().then(function (docs) {
      return JSON.stringify({ docs: docs, exportedAt: Date.now() });
    });
  }

  function importJSON(data) {
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
      records.push(normalizeDoc(item));
    }
    return withLock(function () {
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(DOCS_STORE, 'readwrite');
          var store = transaction.objectStore(DOCS_STORE);
          for (var j = 0; j < records.length; j++) store.put(records[j]);
          transaction.oncomplete = function () { resolve(records.length); };
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
    exportJSON: exportJSON,
    importJSON: importJSON,
    migrateLegacy: migrateLegacy
  };

  openDatabase().catch(function () {
    databasePromise = null;
  });
})();
