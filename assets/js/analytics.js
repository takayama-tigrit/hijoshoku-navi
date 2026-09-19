/* Production-only Google tag. No form, memo, storage or application-state reads. */
(() => {
  'use strict';
  try {
    const loader = document.currentScript;
    const origin = 'https://hijoshoku-navi.com';
    if (!loader || loader.dataset.analyticsEnabled !== 'true' || location.origin !== origin) return;
    const id = loader.dataset.measurementId;
    if (!/^G-[A-Z0-9]{10}$/.test(id || '')) return;
    // Only a built page at its exact canonical path is eligible, including on 200 fallbacks.
    const canonical = new URL(loader.dataset.pageLocation);
    if (canonical.origin !== origin || canonical.search || canonical.hash || canonical.pathname !== location.pathname) return;
    let referrer = '';
    try {
      const previous = new URL(document.referrer);
      if (previous.protocol === 'https:' || previous.protocol === 'http:') referrer = previous.origin + '/';
    } catch { /* Empty or invalid referrer: do not forward it. */ }
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted'
    });
    gtag('js', new Date());
    gtag('config', id, {
      page_location: canonical.href,
      page_referrer: referrer,
      page_title: loader.dataset.pageTitle,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      send_page_view: true,
      cookie_domain: 'hijoshoku-navi.com',
      cookie_flags: 'SameSite=Lax;Secure'
    });
    const tag = document.createElement('script');
    tag.async = true;
    tag.referrerPolicy = 'no-referrer';
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(tag);
  } catch { /* Analytics must never prevent the independent calculator/menu from working. */ }
})();
