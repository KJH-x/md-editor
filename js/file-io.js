(function () {
  'use strict';

  function sanitizeFilename(name) {
    var result = String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(result)) {
      result = '_' + result;
    }
    result = result.replace(/[. ]+$/g, '');
    result = Array.from(result).slice(0, 255).join('');
    return result || 'untitled';
  }

  function decodeFile(buffer) {
    var bytes = new Uint8Array(buffer);
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
    } catch (err) {
      var encoding = null;
      if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        encoding = 'utf-16le';
      } else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        encoding = 'utf-16be';
      }
      if (encoding) {
        return { text: new TextDecoder(encoding).decode(bytes.subarray(2)), encoding: encoding };
      }
      try {
        return { text: new TextDecoder('gbk').decode(bytes), encoding: 'gbk' };
      } catch (err2) {
        return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
      }
    }
  }

  window.mdFileIO = {
    sanitizeFilename: sanitizeFilename,
    decodeFile: decodeFile
  };
})();
