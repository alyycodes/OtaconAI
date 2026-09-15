// Works with web-vitals v2 (getCLS…) and v3/v4 (onCLS…), so upgrading the
// package later won't silently break metric reporting.
const reportWebVitals = (onPerfEntry) => {
  if (!onPerfEntry || !(onPerfEntry instanceof Function)) return;

  import('web-vitals')
    .then((vitals) => {
      const pick = (...names) => names.map((n) => vitals[n]).find(Boolean);

      [
        pick('onCLS', 'getCLS'),
        pick('onINP', 'onFID', 'getFID'),
        pick('onFCP', 'getFCP'),
        pick('onLCP', 'getLCP'),
        pick('onTTFB', 'getTTFB'),
      ]
        .filter(Boolean)
        .forEach((report) => report(onPerfEntry));
    })
    .catch(() => {
      /* web-vitals isn't installed — reporting is optional */
    });
};

export default reportWebVitals;
