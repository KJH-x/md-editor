(function () {
  'use strict';

  function getVditor(callback, retries) {
    retries = retries || 0;
    var vd = window.Vditor && window.Vditor.vditors && window.Vditor.vditors['vditor'];
    if (vd) {
      callback(vd);
    } else if (retries < 50) {
      setTimeout(function () { getVditor(callback, retries + 1); }, 100);
    } else {
      console.error('[md-editor] Vditor instance not found after 5s');
    }
  }

  function deriveFilename(vd) {
    var text = vd.getValue();
    var match = text.match(/^#\s+(.+)$/m);
    return (match ? match[1].trim() : 'untitled') + '.md';
  }

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      getVditor(function (vd) {
        vd.setValue(e.target.result);
        console.log('[md-editor] Loaded: ' + file.name);
      });
    };
    reader.onerror = function () {
      console.error('[md-editor] Failed to read: ' + file.name);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function downloadFile() {
    getVditor(function (vd) {
      var content = vd.getValue();
      var filename = deriveFilename(vd);
      var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('[md-editor] Downloaded: ' + filename);
    });
  }

  function init() {
    var fileInput = document.getElementById('file-input');
    var btnOpen = document.getElementById('btn-open');
    var btnSave = document.getElementById('btn-save');

    if (btnOpen && fileInput) {
      btnOpen.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (fileInput.files[0]) {
          loadFile(fileInput.files[0]);
          fileInput.value = '';
        }
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', downloadFile);
    }

    console.log('[md-editor] File I/O ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
