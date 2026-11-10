// Applies the saved/OS theme before first paint to avoid a flash. Kept as a file (not inline) so the CSP can forbid inline scripts.
(function () {
  try {
    var t = localStorage.getItem('freepdf:theme');
    var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
