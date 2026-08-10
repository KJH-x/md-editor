(function () {
  'use strict';

  var DB_NAME = 'md-editor';
  var DB_VERSION = 2;
  var FSA_STORE = 'fsa';
  var FSA_ID = 'current';
  var currentHandle = null;
  var databasePromise = null;

  function supported() {
    return 'showOpenFilePicker' in window;
  }

  function openDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error('indexedDB unavailable'));
    }
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(function (resolve, reject) {
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains('drafts')) {
          database.createObjectStore('drafts', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(FSA_STORE)) {
          database.createObjectStore(FSA_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = function () {
        var database = request.result;
        database.onclose = function () { databasePromise = null; };
        database.onversionchange = function () { databasePromise = null; };
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

  function persistHandle(handle) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve) {
        var transaction = database.transaction(FSA_STORE, 'readwrite');
        var store = transaction.objectStore(FSA_STORE);
        try {
          store.put({ id: FSA_ID, handle: handle, updatedAt: Date.now() });
        } catch (err) {
          resolve(false);
          return;
        }
        transaction.oncomplete = function () { resolve(true); };
        transaction.onerror = function () { resolve(false); };
        transaction.onabort = function () { resolve(false); };
      });
    }).catch(function () {
      return false;
    });
  }

  function clearHandle() {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve) {
        var transaction = database.transaction(FSA_STORE, 'readwrite');
        transaction.objectStore(FSA_STORE).delete(FSA_ID);
        transaction.oncomplete = function () { resolve(true); };
        transaction.onerror = function () { resolve(false); };
        transaction.onabort = function () { resolve(false); };
      });
    }).catch(function () {
      return false;
    });
  }

  function connectHandle(handle) {
    if (!handle) {
      currentHandle = null;
      return clearHandle();
    }
    currentHandle = handle;
    return persistHandle(handle).then(function () {
      return handle;
    });
  }

  function getHandle() {
    if (currentHandle) return Promise.resolve(currentHandle);
    return openDatabase().then(function (database) {
      return new Promise(function (resolve) {
        var request = database.transaction(FSA_STORE, 'readonly')
          .objectStore(FSA_STORE).get(FSA_ID);
        request.onsuccess = function () {
          var record = request.result;
          if (record && record.handle) currentHandle = record.handle;
          resolve(currentHandle || null);
        };
        request.onerror = function () { resolve(null); };
      });
    }).catch(function () {
      return null;
    });
  }

  function openFile() {
    return window.showOpenFilePicker({
      types: [{
        description: 'Markdown',
        accept: { 'text/markdown': ['.md', '.markdown', '.txt'] }
      }]
    }).then(function (handles) {
      if (!handles || !handles[0]) return null;
      var handle = handles[0];
      return handle.getFile().then(function (file) {
        return file.arrayBuffer().then(function (buffer) {
          var decoded = mdFileIO.decodeFile(buffer);
          return connectHandle(handle).then(function () {
            return { text: decoded.text, encoding: decoded.encoding, handle: handle };
          });
        });
      });
    });
  }

  function writeHandle(handle, markdown) {
    return handle.createWritable().then(function (writable) {
      return writable.write(markdown).then(function () {
        return writable.close();
      }).then(function () {
        return 'saved';
      });
    });
  }

  function saveFile(markdown, force) {
    if (!supported()) {
      return Promise.resolve('unsupported');
    }
    if (currentHandle) {
      return currentHandle.queryPermission({ mode: 'readwrite' }).then(function (state) {
        if (state === 'granted') {
          return writeHandle(currentHandle, markdown);
        }
        if (state === 'prompt') {
          return currentHandle.requestPermission({ mode: 'readwrite' }).then(function (next) {
            if (next === 'granted') {
              return writeHandle(currentHandle, markdown);
            }
            return 'needsGesture';
          });
        }
        return 'needsGesture';
      }).catch(function () {
        return 'needsGesture';
      });
    }
    return window.showSaveFilePicker({
      types: [{
        description: 'Markdown',
        accept: { 'text/markdown': ['.md', '.markdown', '.txt'] }
      }]
    }).then(function (handle) {
      return connectHandle(handle).then(function () {
        return writeHandle(handle, markdown);
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') throw err;
      return 'needsGesture';
    });
  }

  window.MDFsa = {
    supported: supported,
    openFile: openFile,
    saveFile: saveFile,
    getHandle: getHandle,
    connectHandle: connectHandle
  };
})();
