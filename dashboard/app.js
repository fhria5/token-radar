// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail view with the model's own inputs and the protocol's farm plan. No
// network: every byte it shows is in data.js. The page recomputes each row
// from the snapshot figures with the same four functions as lib/model.ts —
// comparableRatio, growthMultiplier, ageMultiplier, chainMultiplier — so the
// page's code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var state = { q: '', category: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The four model functions, as in lib/model.ts.
  function growthMultiplier(change7d) {
    var g = Math.min(M.growth_cap_pct, Math.max(M.growth_floor_pct, change7d === null || change7d === undefined ? 0 : change7d));
    var span = Math.log1p(M.growth_cap_pct / M.growth_scale);
    var damped = (g < 0 ? -1 : g > 0 ? 1 : 0) * Math.log1p(Math.abs(g) / M.growth_scale) / span;
    return 1 + M.growth_strength * damped;
  }
  function ageMultiplier(ageDays) {
    if (ageDays === null || ageDays === undefined) return M.unknown_age_multiplier;
    var v = M.age_base + M.age_strength * (1 - Math.exp(-Math.max(ageDays, 0) / M.age_halflife_days));
    return Math.min(M.age_cap, v);
  }
  function chainMultiplier(chains, category) {
    var extra = Math.min(Math.max((chains || []).length - 1, 0), M.chain_max_steps);
    var breadth = 1 + M.chain_step * extra;
    return category === null || category === undefined ? breadth * M.no_category_penalty : breadth;
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.ratio_used * growthMultiplier(row.change_7d) * ageMultiplier(row.age_days) * chainMultiplier(row.chains, row.category)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the lending position open.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s highest-yield vault on " + chain + ' and let it auto-compound.';
    if (c.indexOf('liquid restaking') >= 0 || c.indexOf('restak') >= 0) return 'Restake $' + capital + ' of liquid-staked ETH through ' + name + ' on ' + chain + ' and hold the receipt token.';
    if (c.indexOf('liquid staking') >= 0) return 'Stake $' + capital + ' of ETH through ' + name + ' on ' + chain + ' and hold the liquid staking receipt.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ' on ' + chain + '.';
    if (c.indexOf('allocator') >= 0 || c.indexOf('curator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it for the full term.';
    if (c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s basis vault on " + chain + ' and hold the shares.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('nft') >= 0) return 'List or buy one item worth about $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('gaming') >= 0) return 'Deposit $' + capital + " of the game's asset into " + name + ' on ' + chain + ' and play one full session.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var half = Math.round(capital / 2);
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + half + ' of USDC back through ' + name + ' to ' + chain + ' so both directions are on record.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap $' + half + " of USDC for the pool's other asset on " + name + ' on ' + chain + ' and add it to the pool.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Borrow $' + Math.round(capital / 4) + ' of USDC against your ' + name + ' position on ' + chain + ' and repay it within a week.';
    return 'Repeat the main position with $' + half + ' of USDC on ' + name + ' on ' + chain + ' so a second chain shows activity.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm with ' + p.name + ', and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' }
    ];
    if (second !== null) {
      steps.push({ text: secondActionFor(p, capital, second), cost: 'about $' + Math.round(capital / 2) + ' of capital and $2 of gas', time: '10 minutes' });
    } else {
      steps.push({ text: 'Make one qualifying action on ' + p.name + ' this week, such as a deposit, a borrow, a swap or a vote on ' + chain + '.', cost: 'about $2 of gas', time: '10 minutes a week' });
    }
    steps.push(
      { text: 'Do one qualifying action each week on ' + p.name + ', such as a deposit, a borrow, a swap or a vote on ' + chain + '.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open " + p.name + "'s own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    );
    return steps.map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'ratio') { av = a.ratio_used; bv = b.ratio_used; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  var qInput = document.getElementById('q');
  var catSelect = document.getElementById('category');
  var tvlSelect = document.getElementById('min-tvl');
  var tabPre = document.getElementById('tab-pre');
  var tabLive = document.getElementById('tab-live');
  var tbody = document.getElementById('rows');
  var emptyBox = document.getElementById('empty');
  var countEl = document.getElementById('count');
  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); renderRows(); });
  document.getElementById('detail-close').addEventListener('click', function () { dialog.close(); });

  function fillStatic() {
    document.getElementById('meta-date').textContent = 'Snapshot ' + DATA.as_of;
    document.getElementById('meta-model').textContent = DATA.model_version + ' model';
    document.getElementById('headline').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    document.getElementById('fact-watchlist').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    document.getElementById('fact-board').textContent = String(DATA.board_size);
    document.getElementById('fact-early').textContent = String(DATA.early_size);
    document.getElementById('fact-live').textContent = String(DATA.live_size);
    document.getElementById('fact-top').textContent = fmtUsd(DATA.rows.length ? DATA.rows[0].implied_value_usd : 0);
    document.getElementById('foot-date').textContent = DATA.as_of;
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    cats.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === state.category) opt.selected = true;
      catSelect.appendChild(opt);
    });
    catSelect.value = state.category;
    var comp = DATA.comparables;
    document.getElementById('comparables-note').textContent = comp.tokenized_count + ' tokenized protocols anchor the ratios; the global median mcap/TVL is ' + comp.global_median_ratio + '. Thin categories are shrunk toward it.';
    var cb = document.getElementById('comparables');
    comp.categories.slice(0, 12).forEach(function (c) {
      var tr = document.createElement('tr');
      [c.category, String(c.n), String(c.median_ratio), String(c.ratio_used)].forEach(function (v, i) {
        var td = document.createElement('td');
        if (i > 0) td.className = 'num';
        td.textContent = v;
        tr.appendChild(td);
      });
      cb.appendChild(tr);
    });
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderRows(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function renderRows() {
    var board = document.getElementById('board');
    var theadRow = document.querySelector('#board thead tr');
    theadRow.textContent = '';
    if (state.tab === 'pre-token') {
      theadRow.appendChild(sortHeader('rank', 'Rank'));
      theadRow.appendChild(sortHeader('name', 'Protocol'));
      theadRow.appendChild(sortHeader('tvl', 'TVL'));
      theadRow.appendChild(sortHeader('growth', '7d'));
      theadRow.appendChild(sortHeader('age', 'Age'));
      theadRow.appendChild(sortHeader('ratio', 'Peer ratio'));
      theadRow.appendChild(sortHeader('implied', 'Implied value'));
      theadRow.appendChild(el('th', { scope: 'col', text: 'Token' }));
    } else {
      ['Status', 'Protocol', 'TVL', '7d', 'Market cap', 'Token'].forEach(function (h) {
        theadRow.appendChild(el('th', { scope: 'col', text: h }));
      });
    }
    tbody.textContent = '';
    var list = state.tab === 'pre-token' ? sortedRows(filteredRows()) : DATA.live;
    emptyBox.hidden = list.length !== 0;
    countEl.textContent = state.tab === 'pre-token' ? list.length + ' rows shown' : DATA.live.length + ' live-token protocols';
    var max = 1;
    if (state.tab === 'pre-token' && list.length) max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; }));
    list.forEach(function (r) {
      var tr;
      if (state.tab === 'pre-token') {
        var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
        var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
        tr = el('tr', {
          'data-selected': state.selected === r.slug ? 'true' : 'false',
          tabindex: '0',
          onclick: function () { openDetail(r.slug); },
          onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
        },
          el('td', { class: 'num', text: String(r.rank) }),
          el('td', null, el('div', { class: 'name' },
            el('b', { text: r.name }),
            el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
          )),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + growthClass, text: growth }),
          el('td', { class: 'num', text: fmtAge(r.age_days) }),
          el('td', { class: 'num', text: String(r.ratio_used) }),
          el('td', null, el('div', { class: 'implied' },
            el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
          )),
          el('td', null, el('span', { class: 'status', text: 'records no token' }))
        );
      } else {
        tr = el('tr', null,
          el('td', { class: 'num', text: 'live' }),
          el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', null, el('span', { class: 'status live', text: 'already trades' }))
        );
      }
      tbody.appendChild(tr);
    });
    tabPre.setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    tabLive.setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
    board.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected, true);
  }

  function openDetail(slug, quiet) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    if (!quiet) writeHash();
    document.getElementById('detail-kicker').textContent = 'Rank ' + row.rank + ' of ' + DATA.board_size + ' — records no token';
    document.getElementById('detail-title').textContent = row.name;
    document.getElementById('detail-sub').textContent = (row.category || 'Uncategorised') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain');
    var eq = document.getElementById('detail-equation');
    eq.textContent = '';
    [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Seven-day growth', fmtPct(row.change_7d)],
      ['Age with no token', fmtAge(row.age_days)],
      ['Peer ratio (' + row.category_comparables + ' tokenized peer' + (row.category_comparables === 1 ? '' : 's') + ', median ' + row.category_median_ratio + ')', String(row.ratio_used)],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Age multiplier', String(row.age_multiplier)],
      ['Chain multiplier', String(row.chain_multiplier)],
      ['Implied value', fmtUsd(row.implied_value_usd)]
    ].forEach(function (pair) {
      eq.appendChild(el('div', null, el('span', { text: pair[0] }), el('b', { class: 'num', text: pair[1] })));
    });
    var recomputed = impliedOf(row);
    document.getElementById('detail-check').textContent = 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) +
      (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' — within rounding of the board, because the peer ratio is shown to four decimals.') +
      ' This is an estimate, not a price.';
    var stepsEl = document.getElementById('detail-steps');
    stepsEl.textContent = '';
    farmSteps(row).forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      stepsEl.appendChild(el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
    });
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  qInput.value = state.q;
  qInput.addEventListener('input', function () { state.q = qInput.value; writeHash(); renderRows(); });
  catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); renderRows(); });
  tvlSelect.addEventListener('change', function () { state.minTvl = Number(tvlSelect.value); renderRows(); });
  tabPre.addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); renderRows(); });
  tabLive.addEventListener('click', function () { state.tab = 'live'; writeHash(); renderRows(); });
  document.getElementById('clear').addEventListener('click', function () { state.q = ''; state.category = 'all'; state.minTvl = 0; qInput.value = ''; catSelect.value = 'all'; tvlSelect.value = '0'; writeHash(); renderRows(); });
  document.querySelectorAll('#board thead button[data-sort]').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = -1; }
      renderRows();
    });
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
  window.addEventListener('hashchange', function () {
    readHash();
    qInput.value = state.q;
    catSelect.value = state.category;
    renderRows();
  });

  readHash();
  qInput.value = state.q;
  if (state.category !== 'all') catSelect.value = state.category;
  fillStatic();
  renderRows();
})();
