import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.REACT_APP_TURNSTILE_SITEKEY;
const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return loading;
}

// Captcha de Cloudflare Turnstile. Sin REACT_APP_TURNSTILE_SITEKEY no se muestra
// (desarrollo y demo); el backend tampoco lo exige si no tiene TURNSTILE_SECRET.
export default function Turnstile({ onToken }) {
  const box = useRef(null);
  useEffect(() => {
    if (!SITE_KEY) return undefined;
    let widget;
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !box.current) return;
      widget = window.turnstile.render(box.current, {
        sitekey: SITE_KEY,
        callback: onToken,
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    }).catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [onToken]);
  return SITE_KEY ? <div ref={box} className="mt-sm" /> : null;
}
