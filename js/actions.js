(function () {
  'use strict';

  var list = [];
  var byId = {};

  function register(action) {
    if (!action || typeof action.id !== 'string' || !action.id) {
      throw new Error('MD_ACTIONS: action requires a non-empty id');
    }
    if (byId[action.id]) {
      throw new Error('MD_ACTIONS: duplicate action id "' + action.id + '"');
    }
    if (typeof action.run !== 'function') {
      throw new Error('MD_ACTIONS: action "' + action.id + '" requires a run function');
    }
    byId[action.id] = action;
    list.push(action);
    return action;
  }

  window.MD_ACTIONS = {
    list: list,
    byId: byId,
    register: register
  };
})();
