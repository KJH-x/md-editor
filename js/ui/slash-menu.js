(function () {
  'use strict';

  function label(key) {
    return mdI18n.t(key);
  }

  function headingMarks(level) {
    return new Array(level + 1).join('#');
  }

  function createItems() {
    var list = [];
    var level;
    for (level = 1; level <= 6; level++) {
      list.push(item(
        headingMarks(level),
        label('slash.heading' + level),
        headingMarks(level) + ' ',
        'heading h' + level + ' 标题'
      ));
    }
    list.push(item('>', label('slash.quote'), '> ', 'quote blockquote 引用'));
    list.push(item('{}', label('slash.code'), '```\n\n```', 'code block 代码块'));
    list.push(item('`', label('slash.inline'), '`code`', 'inline code 行内代码'));
    list.push(item('||', label('slash.table'), '|  |  |\n| --- | --- |\n|  |  |', 'table 表格'));
    list.push(item('[ ]', label('slash.task'), '- [ ] ' + label('slash.taskText'), 'task list todo checkbox 任务'));
    list.push(item('$$', label('slash.math'), '$$\n\n$$', 'math formula 数学'));
    list.push(item('◆', label('slash.mermaid'), '```mermaid\ngraph TD\n  A-->B\n```', 'mermaid diagram 图表'));
    list.push(item('!', label('slash.callout'), '> [!NOTE]\n> ', 'callout note tip warning danger 提示'));
    list.push(item('—', label('slash.hr'), '***', 'horizontal rule divider 分割线'));
    list.push(item('img', label('slash.image'), '![alt](url)', 'image picture 图片'));
    return list;
  }

  function item(mark, text, value, search) {
    return {
      html: '<span class="md-slash__mark">' + mark + '</span> ' + text,
      value: value,
      search: (text + ' ' + search).toLowerCase()
    };
  }

  function buildItems(query) {
    var q = (query || '').trim().toLowerCase();
    var all = createItems();
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (q && all[i].search.indexOf(q) === -1) continue;
      out.push({ html: all[i].html, value: all[i].value });
    }
    return out;
  }

  window.MDSlashMenu = {
    buildItems: buildItems
  };
})();
