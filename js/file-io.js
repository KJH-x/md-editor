(function () {
  'use strict';

  function getVditor() {
    if (window.__vditor) return window.__vditor;
    throw new Error('Vditor instance not ready — editor.js must load before file-io.js');
  }

  function deriveFilename(vd) {
    var text = vd.getValue();
    var match = text.match(/^#\s+(.+)$/m);
    return (match ? match[1].trim() : 'untitled') + '.md';
  }

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var vd = getVditor();
        var hasContent = vd.getValue().trim().length > 0;
        if (hasContent && !confirm('当前编辑区有内容，打开新文件将替换全部内容，是否继续？')) {
          return;
        }
        vd.setValue(e.target.result);
        console.log('[md-editor] Loaded: ' + file.name);
      } catch (err) {
        console.error('[md-editor] ' + err.message);
      }
    };
    reader.onerror = function () {
      console.error('[md-editor] Failed to read: ' + file.name);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function downloadFile() {
    try {
      var vd = getVditor();
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
    } catch (err) {
      console.error('[md-editor] ' + err.message);
    }
  }

  function init() {
    var fileInput = document.getElementById('file-input');
    var btnOpen = document.getElementById('btn-open');
    var btnSave = document.getElementById('btn-save');
    var inputWidth = document.getElementById('input-pagewidth');

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

    if (inputWidth) {
      var saved = localStorage.getItem('md-pagewidth');
      if (saved) inputWidth.value = saved;

      function apply() {
        var val = inputWidth.value.trim();
        if (window.__applyPageWidth) {
          window.__applyPageWidth(val);
        }
      }

      inputWidth.addEventListener('change', apply);
      inputWidth.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { apply(); inputWidth.blur(); }
      });
    }

    console.log('[md-editor] File I/O ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
