import { useState, useEffect } from 'react';

// Renders one layout or the other, rather than drawing both and hiding one with
// CSS. A table and a card list of the same rows are the same content twice: a
// screen reader would read it twice, and every button on the page would have a
// twin. So the screens that need a genuinely different shape on a phone ask
// here and render only what fits.
//
// Anything without matchMedia — an older browser, a test environment — gets
// `false`, which is the wide layout the site has always had.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const onChange = e => setMatches(e.matches);
    setMatches(list.matches);

    // Safari only grew addEventListener on MediaQueryList in 14.
    if (list.addEventListener) {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, [query]);

  return matches;
}

// Tailwind's `sm` breakpoint is 640px and `md` is 768px; these are the same
// lines the classes use, so a component can switch layout on the one its
// styling already follows.
export function useIsPhone() {
  return useMediaQuery('(max-width: 767px)');
}

export function useIsNarrow() {
  return useMediaQuery('(max-width: 639px)');
}
