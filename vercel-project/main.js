/* ===================== NAV SCROLL & MOBILE MENU ===================== */
const nav = document.getElementById('siteNav');
function refreshNav(){ if(nav) nav.classList.toggle('scrolled', window.scrollY > 40); }
window.addEventListener('scroll', refreshNav, { passive: true });
refreshNav();

const burger = document.getElementById('burgerBtn');
const mobileMenu = document.getElementById('mobileMenu');
if (burger && mobileMenu) {
  burger.addEventListener('click', () => mobileMenu.classList.toggle('open'));
  mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => mobileMenu.classList.remove('open')));
}

/* ===================== REVEAL ON SCROLL ===================== */
const revealEls = document.querySelectorAll('.reveal:not(.is-visible)');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
revealEls.forEach(el => revealObserver.observe(el));

/* ===================== ROUTE DIVIDER PLANE TRIGGER ===================== */
const routeDividers = document.querySelectorAll('.route-divider');
const routeObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      routeObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.4 });
routeDividers.forEach(el => routeObserver.observe(el));

/* ===================== COUNTERS ===================== */
function animateCount(el) {
  const target = parseFloat(el.dataset.count);
  const duration = 1600;
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.floor(eased * target);
    el.textContent = val;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = target;
  }
  requestAnimationFrame(tick);
}
const counters = document.querySelectorAll('[data-count]');
const countObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCount(entry.target);
      countObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.6 });
counters.forEach(el => countObserver.observe(el));

/* ===================== CONTACT FORM (Formspree) ===================== */
const contactForm = document.getElementById('contactForm');
const formNote = document.getElementById('formNote');
const formSubmitBtn = contactForm ? contactForm.querySelector('.form-submit') : null;

if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    formSubmitBtn.disabled = true;
    formNote.classList.remove('ok', 'error');
    formNote.textContent = 'Enviando...';

    try {
      const response = await fetch(contactForm.action, {
        method: 'POST',
        body: new FormData(contactForm),
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        formNote.textContent = '¡Gracias! Tu mensaje se ha enviado. Un profesor de Global Crew te responderá muy pronto.';
        formNote.classList.add('ok');
        contactForm.reset();
      } else {
        const data = await response.json().catch(() => null);
        const msg = data && data.errors && data.errors.length
          ? data.errors.map(err => err.message).join(' ')
          : 'No se ha podido enviar el mensaje. Inténtalo de nuevo o escríbenos por WhatsApp.';
        formNote.textContent = msg;
        formNote.classList.add('error');
      }
    } catch (err) {
      formNote.textContent = 'No hay conexión con el servidor. Inténtalo de nuevo o escríbenos por WhatsApp.';
      formNote.classList.add('error');
    } finally {
      formSubmitBtn.disabled = false;
    }
  });
}

/* ===================== TESTIMONIALS CAROUSEL (if present) ===================== */
const testis = document.querySelectorAll('.testi');
const testiDotsWrap = document.getElementById('testiDots');
if (testis.length && testiDotsWrap) {
  let testiIndex = 0;
  testiDotsWrap.innerHTML = [...testis].map((_, i) => `<button data-i="${i}" class="${i===0?'active':''}"></button>`).join('');
  const testiDots = testiDotsWrap.querySelectorAll('button');
  function showTesti(i) {
    testis.forEach((t, idx) => t.classList.toggle('active', idx === i));
    testiDots.forEach((d, idx) => d.classList.toggle('active', idx === i));
    testiIndex = i;
  }
  testiDots.forEach(d => d.addEventListener('click', () => showTesti(parseInt(d.dataset.i))));
  setInterval(() => showTesti((testiIndex + 1) % testis.length), 6000);
}
