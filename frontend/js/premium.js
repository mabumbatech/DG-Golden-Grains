/**
 * GOLDEN GRAINS - Premium look (all app pages)
 * Adds the page banner at the top of every page and gives the stat cards
 * their icon + colour tone. Purely visual: no data, no API calls.
 * Needs: <body class="premium-page"> and css/premium.css
 */
(function () {
  'use strict';

  var TAGLINES = {
    products:    'Your full stock catalogue — rice, flour, oil and more.',
    purchases:   'Record stock coming in and keep supplier costs in check.',
    sales:       'Every sale, payment and customer in one clear view.',
    'cash-audit':'Count the till and make sure every shilling adds up.',
    expenses:    'Track running costs so your profit stays honest.',
    damages:     'Log spoilage and losses so stock stays accurate.',
    store:       'Follow every product from the farm to the main store to the shop.',
    reports:     'Day, week, month or year — profit at a glance.',
    debts:       'Who owes what, and when it is due.',
    customers:   'Know your customers and their buying history.',
    users:       'Control who can use the shop system.',
    'audit-log': 'Who created, edited or deleted what, and when.',
    profile:     'Manage your account and keep it secure.'
  };

  // [pattern in card label, icon id in assets/icons.svg]
  var ICONS = [
    [/profit|margin|gain/i, 'trending-up'],
    [/credit|owed|debt|outstanding|unpaid|balance/i, 'credit-card'],
    [/expens|cost/i, 'bulb'],
    [/damage|loss|waste|low|alert/i, 'alert-triangle'],
    [/transaction|receipt|invoice|count/i, 'receipt'],
    [/customer|user|people|worker/i, 'users'],
    [/product|stock|item|purchase|variant/i, 'package'],
    [/sale|revenue|spent|income|cash|paid|total/i, 'coins']
  ];

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function svgIcon(id) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ui-icon');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', 'assets/icons.svg#' + id);
    svg.appendChild(use);
    return svg;
  }

  function pageKey() {
    var file = (location.pathname.split('/').pop() || '').replace(/\.html?$/i, '');
    return file;
  }

  function buildHero(main) {
    var titleEl = document.querySelector('.topbar .page-title');
    var title = titleEl ? titleEl.textContent.trim() : document.title.split('—')[0].trim();
    var subEl = document.querySelector('.topbar .page-sub');
    var key = pageKey();
    var line = TAGLINES[key] || (subEl ? subEl.textContent.trim() : '');

    var active = document.querySelector('.sidebar .nav-link.active');
    var group = active ? active.closest('.nav-group') : null;
    var labelEl = group ? group.querySelector('.nav-label') : null;
    var eyebrow = labelEl ? labelEl.textContent.trim() : 'Golden Grains';
    var useEl = active ? active.querySelector('use') : null;
    var iconRef = useEl ? (useEl.getAttribute('href') || '') : '';
    var iconId = iconRef.split('#')[1] || 'home';

    var hero = document.createElement('section');
    hero.className = 'p-hero no-print';

    var grains = '';
    for (var i = 0; i < 9; i++) {
      grains += '<span class="ph-grain" style="--x:' + (5 + i * 11 + Math.round(Math.random() * 5)) +
        '%;--s:' + (5 + Math.round(Math.random() * 6)) + 'px;--d:' + (8 + Math.round(Math.random() * 6)) +
        's;--delay:-' + Math.round(Math.random() * 12) + 's"></span>';
    }

    hero.innerHTML =
      '<span class="ph-orb o1"></span><span class="ph-orb o2"></span>' +
      '<div class="ph-grains" aria-hidden="true">' + grains + '</div>' +
      '<div class="ph-text">' +
        '<div class="ph-eyebrow"></div>' +
        '<h1 class="ph-title"></h1>' +
        '<p class="ph-line"></p>' +
      '</div>' +
      '<div class="ph-badge" aria-hidden="true"></div>';

    hero.querySelector('.ph-eyebrow').textContent = eyebrow;
    hero.querySelector('.ph-title').textContent = title;
    var lineEl = hero.querySelector('.ph-line');
    if (line) lineEl.textContent = line; else lineEl.remove();
    hero.querySelector('.ph-badge').appendChild(svgIcon(iconId));

    main.insertBefore(hero, main.firstChild);
  }

  function decorateStats() {
    document.querySelectorAll('.stat-card').forEach(function (card) {
      var value = card.querySelector('.value');
      if (value) {
        if (value.classList.contains('red')) card.classList.add('st-red');
        else if (value.classList.contains('green')) card.classList.add('st-green');
        else if (value.classList.contains('gold')) card.classList.add('st-gold');
      }
      if (!card.querySelector('.icon')) {
        var labelEl = card.querySelector('.label');
        var text = labelEl ? labelEl.textContent : '';
        var id = 'coins';
        for (var i = 0; i < ICONS.length; i++) {
          if (ICONS[i][0].test(text)) { id = ICONS[i][1]; break; }
        }
        var chip = document.createElement('div');
        chip.className = 'icon';
        chip.appendChild(svgIcon(id));
        card.insertBefore(chip, card.firstChild);
      }
    });
  }

  ready(function () {
    if (!document.body.classList.contains('premium-page')) return;
    var main = document.querySelector('.main-content');
    if (main && !main.querySelector('.dash-hero') && !main.querySelector('.p-hero')) buildHero(main);
    decorateStats();
  });
})();
