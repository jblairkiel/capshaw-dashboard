// Applies the member's saved display settings (text size, theme, motion)
// before the page first draws. Loaded as a plain, blocking script from
// index.html; the app keeps them up to date afterwards (src/lib/displayPrefs.js).
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('capshaw.display') || '{}');
    var root = document.documentElement;
    var allowed = {
      'data-text-size': [p.textSize, ['large', 'largest']],
      'data-theme':     [p.theme,    ['dark', 'contrast']],
      'data-motion':    [p.motion,   ['reduce']],
    };
    for (var attr in allowed) {
      if (allowed[attr][1].indexOf(allowed[attr][0]) !== -1) root.setAttribute(attr, allowed[attr][0]);
    }
  } catch { /* no storage: the usual look */ }
})();
