// Applies saved/OS theme and language direction before first paint (no flash, no layout jump).
// Kept as a file, not inline, so the CSP can forbid inline scripts.
(function () {
  var d = document.documentElement;
  try {
    var t = localStorage.getItem('freepdf:theme');
    var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) d.classList.add('dark');
  } catch (e) {}
  try {
    var l = localStorage.getItem('freepdf:lang');
    if (l !== 'ar' && l !== 'en') {
      var prefs = navigator.languages || [navigator.language];
      l = 'en';
      for (var i = 0; i < prefs.length; i++) if (prefs[i] && prefs[i].toLowerCase().indexOf('ar') === 0) { l = 'ar'; break; }
    }
    d.lang = l;
    d.dir = l === 'ar' ? 'rtl' : 'ltr';
  } catch (e) {}
})();
