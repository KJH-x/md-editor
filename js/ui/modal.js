(function () {
  'use strict';

  var activeOverlays = [];

  function createDialog(opts) {
    var backdrop = document.createElement('div');
    backdrop.className = 'md-modal-backdrop';

    var dialog = document.createElement('div');
    dialog.className = 'md-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    var titleId = 'md-modal-title-' + Date.now() + '-' + activeOverlays.length;
    dialog.setAttribute('aria-labelledby', titleId);

    var title = document.createElement('h2');
    title.className = 'md-modal__title';
    title.id = titleId;
    title.textContent = opts.title || '';

    dialog.appendChild(title);

    if (opts.message) {
      var message = document.createElement('p');
      message.className = 'md-modal__message';
      message.textContent = opts.message;
      dialog.appendChild(message);
    }

    return { backdrop: backdrop, dialog: dialog };
  }

  function focusableElements(dialog) {
    var nodes = dialog.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    var list = [];
    for (var i = 0; i < nodes.length; i++) list.push(nodes[i]);
    return list;
  }

  function trapFocus(dialog, event) {
    if (event.key !== 'Tab') return;
    var focusables = focusableElements(dialog);
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last || !dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDialog(opts) {
    var previousFocus = document.activeElement;
    var built = createDialog(opts);
    var backdrop = built.backdrop;
    var dialog = built.dialog;
    var closed = false;

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    function close() {
      if (closed) return;
      closed = true;
      dialog.removeEventListener('keydown', onDialogKeydown);
      document.removeEventListener('keydown', onDocumentKeydown, true);
      backdrop.removeEventListener('click', onBackdropClick);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      var index = activeOverlays.indexOf(dialog);
      if (index !== -1) activeOverlays.splice(index, 1);
      if (previousFocus && previousFocus !== document.body &&
          previousFocus.focus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    }

    function cancel() {
      if (closed) return;
      close();
      if (opts.onCancel) opts.onCancel();
    }

    function onDialogKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      } else {
        trapFocus(dialog, event);
      }
    }

    function onDocumentKeydown(event) {
      if (event.key !== 'Escape') return;
      if (!activeOverlays.length || activeOverlays[activeOverlays.length - 1] !== dialog) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }

    function onBackdropClick(event) {
      if (event.target === backdrop) cancel();
    }

    dialog.addEventListener('keydown', onDialogKeydown);
    document.addEventListener('keydown', onDocumentKeydown, true);
    backdrop.addEventListener('click', onBackdropClick);
    activeOverlays.push(dialog);

    return { dialog: dialog, backdrop: backdrop, close: close };
  }

  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var state = openDialog({
        title: opts.title,
        message: opts.message,
        onCancel: function () { resolve(false); }
      });
      var dialog = state.dialog;

      var actions = document.createElement('div');
      actions.className = 'md-modal__actions';

      var cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'md-modal__btn';
      cancelButton.textContent = opts.cancelLabel || 'Cancel';

      var confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'md-modal__btn md-modal__btn--primary' +
        (opts.danger ? ' md-modal__btn--danger' : '');
      confirmButton.textContent = opts.confirmLabel || 'OK';

      cancelButton.addEventListener('click', function () {
        state.close();
        resolve(false);
      });
      confirmButton.addEventListener('click', function () {
        state.close();
        resolve(true);
      });

      actions.appendChild(cancelButton);
      actions.appendChild(confirmButton);
      dialog.appendChild(actions);

      confirmButton.focus();
    });
  }

  function prompt(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var state = openDialog({
        title: opts.title,
        message: null,
        onCancel: function () { resolve(null); }
      });
      var dialog = state.dialog;

      var field = document.createElement('div');
      field.className = 'md-modal__field';

      var label = document.createElement('label');
      label.className = 'md-modal__label';
      label.textContent = opts.label || '';

      var errorId = 'md-modal-error-' + Date.now();

      var input = document.createElement('input');
      input.className = 'md-modal__input';
      input.type = 'text';
      input.spellcheck = false;
      if (opts.value !== undefined && opts.value !== null) input.value = String(opts.value);

      var error = document.createElement('p');
      error.className = 'md-modal__error';
      error.id = errorId;
      error.setAttribute('role', 'alert');
      error.hidden = true;

      field.appendChild(label);
      field.appendChild(input);
      field.appendChild(error);
      dialog.appendChild(field);

      var actions = document.createElement('div');
      actions.className = 'md-modal__actions';

      var cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'md-modal__btn';
      cancelButton.textContent = opts.cancelLabel || 'Cancel';

      var confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'md-modal__btn md-modal__btn--primary';
      confirmButton.textContent = opts.confirmLabel || 'OK';

      function showError(message) {
        if (!message) {
          error.hidden = true;
          input.removeAttribute('aria-invalid');
          input.removeAttribute('aria-describedby');
          return;
        }
        error.textContent = message;
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errorId);
        input.focus();
      }

      function submit() {
        var value = input.value.trim();
        var validationError = null;
        if (opts.validate) {
          try {
            validationError = opts.validate(value);
          } catch (err) {
            validationError = err && err.message ? err.message : String(err);
          }
        }
        if (validationError) {
          showError(validationError);
          return;
        }
        state.close();
        resolve(value);
      }

      cancelButton.addEventListener('click', function () {
        state.close();
        resolve(null);
      });
      confirmButton.addEventListener('click', submit);
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });
      input.addEventListener('input', function () {
        if (!error.hidden) showError(null);
      });

      actions.appendChild(cancelButton);
      actions.appendChild(confirmButton);
      dialog.appendChild(actions);

      input.focus();
      if (input.value) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }

  window.MDModal = {
    confirm: confirm,
    prompt: prompt
  };
})();
