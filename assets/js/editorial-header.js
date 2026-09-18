// Header enhancement only: native links/details remain usable without JavaScript.
const header = document.querySelector('.header-inner');
const menu = document.querySelector('.site-menu');
const syncHeader = () => header?.classList.toggle('is-condensed', window.scrollY > 100);
syncHeader();
window.addEventListener('scroll', syncHeader, { passive: true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.open) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});
menu?.addEventListener('click', event => {
  if (event.target.closest('a')) menu.open = false;
});
