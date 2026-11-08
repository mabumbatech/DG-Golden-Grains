/* GOLDEN GRAINS — animated landing page behaviour (progress bar, grains, reveals, intro skip) */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Time-of-day greeting in the hero welcome line ---- */
  var wl = document.getElementById('lpWelcomeText');
  if (wl) {
    var h = new Date().getHours();
    var g = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
    wl.textContent = g + ' · Welcome to';
  }

  /* ---- Welcome intro: click / key to skip ---- */
  var splash = document.getElementById('lpSplash');
  if (splash && root.classList.contains('lp-intro')) {
    var skip = function () {
      splash.classList.add('lp-done');
      root.style.setProperty('--lp-base', '0s');   // start the hero animations right away
    };
    splash.addEventListener('click', skip);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') skip();
    }, { once: true });
  }

  /* ---- Floating golden grains in the hero ---- */
  var hero = document.querySelector('.hero');
  var box = document.getElementById('lpGrains');
  function sizeHero() { if (hero) hero.style.setProperty('--hh', (hero.offsetHeight + 60) + 'px'); }
  if (hero && box && !reduce) {
    sizeHero();
    window.addEventListener('resize', sizeHero);
    var count = window.innerWidth < 600 ? 12 : 22;
    for (var i = 0; i < count; i++) {
      var g2 = document.createElement('span');
      g2.className = 'lp-grain';
      g2.style.setProperty('--x', (Math.random() * 100).toFixed(1) + '%');
      g2.style.setProperty('--s', (5 + Math.random() * 9).toFixed(1) + 'px');
      g2.style.setProperty('--d', (9 + Math.random() * 12).toFixed(1) + 's');
      g2.style.setProperty('--delay', (-Math.random() * 20).toFixed(1) + 's');
      g2.style.setProperty('--b', (Math.random() < 0.3 ? 1.5 : 0) + 'px');
      box.appendChild(g2);
    }
  }

  /* ---- Scroll progress bar ---- */
  var bar = document.getElementById('lpProgress');
  if (bar && !reduce) {
    var ticking = false;
    var update = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.setProperty('--lp-p', max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : 0);
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ---- Reveal on scroll ---- */
  var items = document.querySelectorAll('.lp-reveal');
  if (!('IntersectionObserver' in window) || reduce) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---- Pointer spotlight on feature cards ---- */
  document.querySelectorAll('.feature').forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
})();
