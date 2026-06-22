/* Budżet Polski 2026 — Terra Cracovianum
   Vanilla JS + D3 v7. No build step. */

(function () {
  "use strict";

  var DATA = null;
  var YEAR = 2026;                  // currently displayed year
  var YEAR_CACHE = {};              // year -> data json
  var YEAR_FILES = { 2026: "budget-data.json", 2025: "budget-2025.json", 2024: "budget-2024.json", 2023: "budget-2023.json", 2022: "budget-2022.json", 2021: "budget-2021.json", 2020: "budget-2020.json", 2019: "budget-2019.json", 2018: "budget-2018.json", 2017: "budget-2017.json", 2016: "budget-2016.json", 2015: "budget-2015.json", 2014: "budget-2014.json", 2013: "budget-2013.json", 2012: "budget-2012.json", 2011: "budget-2011.json" };
  var axis = "dzialy";        // "dzialy" | "czesci"
  var view = "tree";          // "tree" | "flow" | "type"
  var path = [];              // drill-down stack of node objects

  var fmtPL = new Intl.NumberFormat("pl-PL");
  var tooltip = document.getElementById("tooltip");

  var MOBILE_Q = window.matchMedia("(max-width: 760px)");
  var COARSE_Q = window.matchMedia("(pointer: coarse)");
  function isMobile() {
    // treat as mobile if the viewport is narrow OR it's a touch device with a not-wide screen
    if (MOBILE_Q.matches) return true;
    if (COARSE_Q.matches && window.innerWidth < 900) return true;
    return false;
  }
  var MOBILE_TOP = 12;        // tiles shown before grouping into "Pozostałe"
  var restExpanded = false;   // mobile: is the "Pozostałe" list expanded?

  // ---- category color assignment (by dział/część theme) ----
  function colorKey(name) {
    var n = (name || "").toLowerCase();
    if (/ubezpiecz|emeryt|rodzin|pomoc spo|polityki spo|zabezpiecz/.test(n)) return "social";
    if (/różne rozlicz|rozliczenia|subwen/.test(n)) return "transfer";
    if (/obron|wojsk/.test(n)) return "defense";
    if (/dług|obsługa dłu/.test(n)) return "debt";
    if (/zdrow/.test(n)) return "health";
    if (/oświat|szkoln|nauk|eduk|wychowani/.test(n)) return "edu";
    if (/administ|urzęd|wymiar spr|sądown|bezpiecz|sprawiedliw|skarb/.test(n)) return "admin";
    if (/transport|łączn|infrastr|drog|kolej|gospodar|budownict|mieszkani|środowisk/.test(n)) return "infra";
    return "other";
  }
  var CMAP = {
    social:   { fill: "var(--c-social)",   ink: "var(--c-social-ink)",   line: "var(--c-social-line)",   label: "Społeczne i ubezpieczenia" },
    transfer: { fill: "var(--c-transfer)", ink: "var(--c-transfer-ink)", line: "var(--c-transfer-line)", label: "Transfery i rozliczenia" },
    defense:  { fill: "var(--c-defense)",  ink: "var(--c-defense-ink)",  line: "var(--c-defense-line)",  label: "Obrona" },
    debt:     { fill: "var(--c-debt)",     ink: "var(--c-debt-ink)",     line: "var(--c-debt-line)",     label: "Obsługa długu" },
    health:   { fill: "var(--c-health)",   ink: "var(--c-health-ink)",   line: "var(--c-health-line)",   label: "Zdrowie" },
    edu:      { fill: "var(--c-edu)",      ink: "var(--c-edu-ink)",      line: "var(--c-edu-line)",      label: "Edukacja i nauka" },
    admin:    { fill: "var(--c-admin)",    ink: "var(--c-admin-ink)",    line: "var(--c-admin-line)",    label: "Administracja i sprawiedliwość" },
    infra:    { fill: "var(--c-infra)",    ink: "var(--c-infra-ink)",    line: "var(--c-infra-line)",    label: "Infrastruktura i gospodarka" },
    other:    { fill: "var(--c-other)",    ink: "var(--c-other-ink)",    line: "var(--c-other-line)",    label: "Pozostałe" }
  };

  // resolve a CSS var to a concrete color for SVG fills that need it
  function cssVar(v) {
    var m = /var\((--[\w-]+)\)/.exec(v);
    if (!m) return v;
    return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || v;
  }

  // thousands of zł -> human string in mld/mln
  function money(thousands) {
    var zl = thousands * 1000;
    if (zl >= 1e9) return (zl / 1e9).toLocaleString("pl-PL", { maximumFractionDigits: 1 }) + " mld zł";
    if (zl >= 1e6) return (zl / 1e6).toLocaleString("pl-PL", { maximumFractionDigits: 0 }) + " mln zł";
    return fmtPL.format(zl) + " zł";
  }
  function moneyShort(thousands) {
    var zl = thousands * 1000;
    if (zl >= 1e9) return (zl / 1e9).toLocaleString("pl-PL", { maximumFractionDigits: 1 }) + " mld";
    if (zl >= 1e6) return (zl / 1e6).toLocaleString("pl-PL", { maximumFractionDigits: 0 }) + " mln";
    return fmtPL.format(Math.round(zl / 1000)) + " tys.";
  }

  // ---------- bootstrap ----------

  fetch("budget-data.json")
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (json) {
      DATA = json;
      YEAR = (json.meta && json.meta.rok) || 2026;
      YEAR_CACHE[YEAR] = json;
      renderStats();
      buildLegend();
      drawTree();
      wireTabs();
      wireAxis();
      wireYear();
      window.addEventListener("resize", debounce(onResize, 150));
      // release the staggered first-load entrance after the first paint
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { document.body.classList.add("is-loaded"); });
      });
    })
    .catch(function (err) {
      var s = document.getElementById("tree-state");
      if (s) s.innerHTML = '<i class="ti ti-alert-triangle"></i> Nie udało się wczytać danych budżetu. Odśwież stronę lub spróbuj ponownie później.';
      document.body.classList.add("is-loaded"); // reveal hero even if data fails
      console.error(err);
    });

  // ---------- count-up animation for stat numbers ----------
  var prevStatVals = {};   // label -> last numeric value, so year changes count from the old value
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function tweenValue(from, to, dur, onUpdate) {
    if (prefersReduced() || !dur || from === to) { onUpdate(to); return; }
    var startTs = null;
    function step(ts) {
      if (startTs === null) startTs = ts;
      var p = Math.min(1, (ts - startTs) / dur);
      onUpdate(from + (to - from) * easeOutCubic(p));
      if (p < 1) requestAnimationFrame(step);
      else onUpdate(to);
    }
    requestAnimationFrame(step);
  }
  // formatter locked to the TARGET's magnitude so the unit never flickers mid-count
  function statMoneyFmt(toThousands) {
    var zl = toThousands * 1000, div, unit, dec;
    if (zl >= 1e9) { div = 1e9; unit = "mld zł"; dec = 1; }
    else if (zl >= 1e6) { div = 1e6; unit = "mln zł"; dec = 0; }
    else { div = 1; unit = "zł"; dec = 0; }
    return function (vThousands) {
      var n = (vThousands * 1000) / div;
      return { num: n.toLocaleString("pl-PL", { minimumFractionDigits: dec, maximumFractionDigits: dec }), unit: unit };
    };
  }
  function statPctFmt(dec) {
    return function (v) {
      return { num: v.toLocaleString("pl-PL", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + "%", unit: "" };
    };
  }

  // ---------- stats band ----------
  function renderStats() {
    var m = DATA.meta;
    var yr = m.rok || YEAR;
    var cards = [
      { label: "Wydatki", to: m.wydatki, fmt: statMoneyFmt(m.wydatki), foot: "Plan na " + yr + " r.", danger: false },
      { label: "Dochody", to: m.dochody, fmt: statMoneyFmt(m.dochody), foot: "Wpływy podatkowe i niepodatkowe", danger: false },
      { label: "Deficyt", to: m.deficyt, fmt: statMoneyFmt(m.deficyt), foot: "Wydatki minus dochody", danger: true }
    ];
    if (m.dlug_pkb_proc != null) {
      cards.push({ label: "Dług / PKB", to: m.dlug_pkb_proc, fmt: statPctFmt(1), foot: "Próg ostrożnościowy: 55%", danger: false });
    } else {
      // 2025 plan: show share of expenses covered by income instead
      cards.push({ label: "Pokrycie wydatków", to: (m.dochody / m.wydatki * 100), fmt: statPctFmt(0), foot: "Dochody / wydatki", danger: false });
    }
    var html = cards.map(function (c, i) {
      return '<div class="stat anim-in" style="--anim-delay:' + (180 + i * 50) + 'ms">' +
        '<p class="stat-label">' + c.label + '</p>' +
        '<p class="stat-value' + (c.danger ? " is-danger" : "") + '" data-k="' + i + '"></p>' +
        '<p class="stat-foot">' + c.foot + '</p></div>';
    }).join("");
    var statsEl = document.getElementById("stats");
    statsEl.innerHTML = html;

    cards.forEach(function (c, i) {
      var el = statsEl.querySelector('.stat-value[data-k="' + i + '"]');
      var from = prevStatVals[c.label]; if (from == null) from = 0;
      tweenValue(from, c.to, 900, function (v) {
        var r = c.fmt(v);
        el.innerHTML = r.num + (r.unit ? '<span class="unit">' + r.unit + '</span>' : "");
      });
      prevStatVals[c.label] = c.to;
    });

    // update hero headline amount (count up too) + year
    var heroAmt = document.querySelector(".hero h1 .amt");
    if (heroAmt) {
      var hfrom = prevStatVals["__hero"]; if (hfrom == null) hfrom = 0;
      var hf = statMoneyFmt(m.wydatki);
      tweenValue(hfrom, m.wydatki, 900, function (v) {
        var r = hf(v);
        heroAmt.textContent = (r.num + "\u00a0" + r.unit).replace(/ /g, "\u00a0");
      });
      prevStatVals["__hero"] = m.wydatki;
    }
    var eyebrow = document.querySelector(".hero .eyebrow");
    if (eyebrow) eyebrow.textContent = "Budżet państwa · rok " + yr;
    var lead = document.getElementById("hero-lead");
    if (lead) lead.textContent = "Każda złotówka z ustawy budżetowej, rozłożona na czynniki pierwsze. Wielkość pola odpowiada kwocie — kliknij, żeby wejść głębiej. Dane pochodzą wprost z ustawy budżetowej na rok " + yr + " i sumują się co do tysiąca złotych.";
    var mast = document.getElementById("masthead-meta");
    if (mast && m.ustawa) mast.textContent = m.ustawa;
  }

  // ---------- legend ----------
  function buildLegend() {
    var used = ["social", "transfer", "defense", "debt", "health", "edu", "admin", "infra", "other"];
    document.getElementById("legend").innerHTML = used.map(function (k) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' +
        CMAP[k].fill + ';border:1px solid ' + CMAP[k].line + '"></span>' + CMAP[k].label + '</span>';
    }).join("");
  }

  // ---------- data shaping for current axis & drill path ----------
  function currentNodes() {
    // returns array of {name, code, value, children?} for the current level
    if (path.length === 0) {
      if (axis === "dzialy") {
        return DATA.dzialy.map(function (d) {
          return { name: d.name, code: d.code, value: d.plan, hasChildren: false };
        });
      } else {
        return DATA.czesci.map(function (p) {
          return { name: p.name, code: p.code, value: p.plan, hasChildren: p.dzialy && p.dzialy.length > 0, ref: p };
        });
      }
    }
    // drilling only applies to części axis
    var node = path[path.length - 1];
    if (node.level === "czesc") {
      return (node.ref.dzialy || []).map(function (d) {
        return { name: d.name, code: d.code, value: d.plan, hasChildren: d.rozdzialy && d.rozdzialy.length > 0, ref: d };
      });
    }
    if (node.level === "dzial") {
      return (node.ref.rozdzialy || []).map(function (r) {
        return { name: r.name, code: r.code, value: r.plan, hasChildren: false };
      });
    }
    return [];
  }

  // ---------- treemap (dispatcher) ----------
  function drawTree() {
    var state = document.getElementById("tree-state");
    if (state) state.style.display = "none";
    renderCrumbs();

    var nodes = currentNodes().filter(function (n) { return n.value > 0; });
    nodes.sort(function (a, b) { return b.value - a.value; });

    if (isMobile()) drawTreeMobile(nodes);
    else drawTreeDesktop(nodes);
  }

  // ---------- treemap: desktop (full D3 treemap) ----------
  function drawTreeDesktop(nodes) {
    var list = document.getElementById("tree-rest");
    if (list) { list.innerHTML = ""; list.style.display = "none"; }
    var svgEl = document.getElementById("treemap");
    svgEl.style.display = "block";

    var wrap = document.getElementById("treemap-wrap");
    var W = wrap.clientWidth || 1000;
    var H = Math.max(440, Math.min(620, W * 0.62));

    var root = d3.hierarchy({ children: nodes }).sum(function (d) { return d.value; });
    d3.treemap().size([W, H]).paddingInner(4).round(true)(root);

    var svg = d3.select("#treemap").attr("viewBox", "0 0 " + W + " " + H).attr("width", "100%").attr("height", H);
    svg.selectAll("*").remove();

    var total = d3.sum(nodes, function (d) { return d.value; });

    var reduce = prefersReduced();
    var rise = reduce ? 0 : 16;
    var g = svg.selectAll("g.tile").data(root.leaves()).enter()
      .append("g").attr("class", "tile")
      .attr("transform", function (d) { return "translate(" + d.x0 + "," + (d.y0 + rise) + ")"; })
      .style("opacity", 0);

    g.transition()
      .duration(reduce ? 0 : 360)
      .delay(function (d, i) { return reduce ? 0 : Math.min(i * 26, 560); })
      .ease(d3.easeCubicOut)
      .style("opacity", 1)
      .attr("transform", function (d) { return "translate(" + d.x0 + "," + d.y0 + ")"; });

    g.append("rect")
      .attr("width", function (d) { return Math.max(0, d.x1 - d.x0); })
      .attr("height", function (d) { return Math.max(0, d.y1 - d.y0); })
      .attr("rx", 6)
      .attr("fill", function (d) { return cssVar(CMAP[colorKey(d.data.name)].fill); })
      .attr("stroke", function (d) { return cssVar(CMAP[colorKey(d.data.name)].line); })
      .attr("stroke-width", 1);

    g.each(function (d) {
      var w = d.x1 - d.x0, h = d.y1 - d.y0;
      var sel = d3.select(this);
      var ink = cssVar(CMAP[colorKey(d.data.name)].ink);
      if (w < 54 || h < 30) return;
      var pad = 9;
      var maxChars = Math.floor((w - pad * 2) / 7);
      var lines = wrapText(d.data.name, maxChars, h > 78 ? 3 : (h > 52 ? 2 : 1));
      var ty = pad + 13;
      lines.forEach(function (ln) {
        sel.append("text").attr("class", "tile-label").attr("x", pad).attr("y", ty).attr("fill", ink).text(ln);
        ty += 15;
      });
      if (h > 46) {
        sel.append("text").attr("class", "tile-value").attr("x", pad).attr("y", h - 10).attr("fill", ink).text(moneyShort(d.data.value));
        if (w > 96 && h > 64) {
          sel.append("text").attr("class", "tile-sub").attr("x", pad).attr("y", h - 26)
            .attr("fill", ink).attr("opacity", 0.7)
            .text((d.data.value / total * 100).toFixed(1).replace(".", ",") + "%");
        }
      }
    });

    g.on("mousemove", function (ev, d) { showTip(ev, d.data, total); })
      .on("mouseleave", hideTip)
      .on("click", function (ev, d) { onTileClick(d.data); })
      .style("cursor", function (d) { return canDrill(d.data) ? "pointer" : "default"; })
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", function (d) {
        return d.data.name + ", " + money(d.data.value) + (canDrill(d.data) ? ", kliknij aby wejść w szczegóły" : "");
      })
      .on("keydown", function (ev, d) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onTileClick(d.data); }
      });
  }

  // ---------- treemap: mobile (top-N tiles + "Pozostałe" bar list) ----------
  function drawTreeMobile(nodes) {
    document.getElementById("treemap").style.display = "none";
    var host = document.getElementById("tree-rest");
    host.style.display = "block";
    host.innerHTML = "";

    var total = d3.sum(nodes, function (d) { return d.value; });
    var max = nodes.length ? nodes[0].value : 1;

    var showAll = nodes.length <= MOBILE_TOP + 1;
    var headN = showAll ? nodes.length : MOBILE_TOP;
    var head = nodes.slice(0, headN);
    var tail = showAll ? [] : nodes.slice(headN);
    var tailSum = d3.sum(tail, function (d) { return d.value; });

    function bar(d, idx) {
      var c = CMAP[colorKey(d.name)];
      var w = Math.max(2, d.value / max * 100);
      var pct = (d.value / total * 100).toFixed(1).replace(".", ",");
      var drill = canDrill(d);
      var delay = Math.min((idx || 0) * 30, 360);
      var el = document.createElement(drill ? "button" : "div");
      el.className = "mbar" + (drill ? " is-drill" : "");
      el.innerHTML =
        '<span class="mbar-head">' +
          '<span class="mbar-name">' + escapeHtml(d.name) + (drill ? ' <i class="ti ti-chevron-right" aria-hidden="true"></i>' : '') + '</span>' +
          '<span class="mbar-amt">' + moneyShort(d.value) + '</span>' +
        '</span>' +
        '<span class="mbar-track"><span class="mbar-fill grow-in" style="width:' + w.toFixed(1) + '%;background:' + c.fill + ';border:1px solid ' + c.line + ';--anim-delay:' + delay + 'ms"></span></span>' +
        '<span class="mbar-pct">' + pct + '%</span>';
      if (drill) {
        el.setAttribute("aria-label", d.name + ", " + money(d.value) + ", dotknij aby wejść w szczegóły");
        el.addEventListener("click", function () { onTileClick(d); });
      }
      return el;
    }

    head.forEach(function (d, i) { host.appendChild(bar(d, i)); });

    if (tail.length) {
      var toggle = document.createElement("button");
      toggle.className = "mbar mbar-rest";
      var pct = (tailSum / total * 100).toFixed(1).replace(".", ",");
      function renderToggle() {
        toggle.innerHTML =
          '<span class="mbar-head">' +
            '<span class="mbar-name"><i class="ti ti-' + (restExpanded ? "chevron-down" : "dots") + '" aria-hidden="true"></i> ' +
            (restExpanded ? "Zwiń" : "Pozostałe (" + tail.length + ")") + '</span>' +
            '<span class="mbar-amt">' + moneyShort(tailSum) + '</span>' +
          '</span>' +
          '<span class="mbar-track"><span class="mbar-fill" style="width:' + Math.max(2, tailSum / max * 100).toFixed(1) + '%;background:var(--c-other);border:1px solid var(--c-other-line)"></span></span>' +
          '<span class="mbar-pct">' + pct + '%</span>';
      }
      renderToggle();
      toggle.setAttribute("aria-expanded", restExpanded ? "true" : "false");
      toggle.addEventListener("click", function () {
        restExpanded = !restExpanded;
        toggle.setAttribute("aria-expanded", restExpanded ? "true" : "false");
        renderToggle();
        var existing = host.querySelectorAll(".mbar-tail");
        existing.forEach(function (n) { n.remove(); });
        if (restExpanded) {
          tail.forEach(function (d, i) {
            var b = bar(d, i);
            b.classList.add("mbar-tail");
            host.appendChild(b);
          });
        }
      });
      host.appendChild(toggle);
      if (restExpanded) {
        tail.forEach(function (d, i) { var b = bar(d, i); b.classList.add("mbar-tail"); host.appendChild(b); });
      }
    }
  }

  function canDrill(d) {
    // drilling available only on części axis (część -> dział -> rozdział)
    return axis === "czesci" && d.hasChildren;
  }

  function onTileClick(d) {
    if (!canDrill(d)) return;
    restExpanded = false;
    if (path.length === 0) {
      path.push({ level: "czesc", name: d.name, code: d.code, ref: d.ref });
    } else if (path[path.length - 1].level === "czesc") {
      path.push({ level: "dzial", name: d.name, code: d.code, ref: d.ref });
    }
    drawTree();
  }

  function renderCrumbs() {
    var el = document.getElementById("crumbs");
    var root = axis === "dzialy" ? "Wszystkie działy" : "Wszystkie części";
    var html = '<button class="crumb' + (path.length === 0 ? " is-current" : "") + '" data-i="-1">' +
      '<i class="ti ti-home" aria-hidden="true"></i> ' + root + '</button>';
    path.forEach(function (p, i) {
      html += '<span class="crumb-sep"><i class="ti ti-chevron-right" aria-hidden="true"></i></span>';
      html += '<button class="crumb' + (i === path.length - 1 ? " is-current" : "") + '" data-i="' + i + '">' + p.name + '</button>';
    });
    el.innerHTML = html;
    el.querySelectorAll(".crumb").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = parseInt(b.getAttribute("data-i"), 10);
        restExpanded = false;
        path = i < 0 ? [] : path.slice(0, i + 1);
        drawTree();
      });
    });
  }

  // ---------- tooltip ----------
  function showTip(ev, d, total) {
    var share = (d.value / total * 100).toFixed(1).replace(".", ",");
    tooltip.innerHTML = '<strong>' + escapeHtml(d.name) + '</strong><br>' +
      '<span class="tt-val">' + money(d.value) + '</span> · <span class="tt-share">' + share + '% poziomu</span>' +
      (canDrill(d) ? '<br><span style="opacity:.7">kliknij, aby wejść głębiej</span>' : '');
    tooltip.style.opacity = "1";
    positionTip(ev);
  }
  function positionTip(ev) {
    var x = ev.clientX + 14, y = ev.clientY + 14;
    var r = tooltip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 12) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 12) y = ev.clientY - r.height - 14;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }
  function hideTip() { tooltip.style.opacity = "0"; }

  // ---------- sankey (dispatcher) ----------
  function buildSankeyGraph(opts) {
    opts = opts || {};
    var topN = opts.topN || 9;
    var mergeRev = !!opts.mergeRev;
    var dz = DATA.dzialy.slice().sort(function (a, b) { return b.plan - a.plan; });
    var top = dz.slice(0, topN);
    var rest = dz.slice(topN);
    var restSum = d3.sum(rest, function (d) { return d.plan; });

    var nodes = [], nodeIndex = {};
    function addNode(name, kind) {
      if (nodeIndex[name] != null) return nodeIndex[name];
      nodeIndex[name] = nodes.length;
      nodes.push({ name: name, kind: kind });
      return nodeIndex[name];
    }
    var HUB = "Budżet państwa";
    addNode(HUB, "hub");

    // revenue — optionally merge the smaller sources into "Inne podatki"
    var dochody = DATA.dochody.slice();
    var revLinks = [];
    if (mergeRev) {
      var keep = dochody.filter(function (r) { return /VAT|Akcyza/.test(r.name); });
      var mergedSum = d3.sum(dochody.filter(function (r) { return !/VAT|Akcyza/.test(r.name); }), function (r) { return r.plan; });
      keep.forEach(function (r) { addNode(r.name, "rev"); revLinks.push({ name: r.name, value: r.plan }); });
      addNode("Inne podatki", "rev"); revLinks.push({ name: "Inne podatki", value: mergedSum });
    } else {
      dochody.forEach(function (r) { addNode(r.name, "rev"); revLinks.push({ name: r.name, value: r.plan }); });
    }
    addNode("Deficyt (dług)", "rev");

    top.forEach(function (d) { addNode(d.name, "exp"); });
    if (restSum > 0) addNode("Pozostałe działy", "exp");

    var links = [];
    revLinks.forEach(function (r) { links.push({ source: nodeIndex[r.name], target: nodeIndex[HUB], value: r.value }); });
    links.push({ source: nodeIndex["Deficyt (dług)"], target: nodeIndex[HUB], value: DATA.meta.deficyt });
    top.forEach(function (d) { links.push({ source: nodeIndex[HUB], target: nodeIndex[d.name], value: d.plan }); });
    if (restSum > 0) links.push({ source: nodeIndex[HUB], target: nodeIndex["Pozostałe działy"], value: restSum });
    return { nodes: nodes, links: links, HUB: HUB };
  }

  function sankeyNodeColor(n) {
    if (n.kind === "hub") return cssVar("var(--accent)");
    if (n.name === "Deficyt (dług)") return cssVar("var(--danger)");
    if (n.kind === "rev") return cssVar("var(--c-transfer-line)");
    return cssVar(CMAP[colorKey(n.name)].line);
  }

  function drawSankey() {
    if (isMobile()) drawSankeyMobile();
    else drawSankeyDesktop();
  }

  // ---------- sankey: desktop (horizontal) ----------
  function drawSankeyDesktop() {
    var wrap = document.getElementById("sankey-wrap");
    var W = wrap.clientWidth || 1000;
    var H = Math.max(460, Math.min(640, W * 0.6));
    var svg = d3.select("#sankey").attr("viewBox", "0 0 " + W + " " + H).attr("width", "100%").attr("height", H);
    svg.selectAll("*").remove();

    var g = buildSankeyGraph();
    var sankey = d3.sankey().nodeWidth(14).nodePadding(13).extent([[4, 10], [W - 4, H - 10]]);
    var graph = sankey({
      nodes: g.nodes.map(function (d) { return Object.assign({}, d); }),
      links: g.links.map(function (d) { return Object.assign({}, d); })
    });

    var reduceS = prefersReduced();
    var slinks = svg.append("g").attr("fill", "none")
      .selectAll("path").data(graph.links).enter().append("path")
      .attr("class", "slink").attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke", function (d) {
        return d.source.name === "Deficyt (dług)" ? cssVar("var(--danger)") : sankeyNodeColor(d.target.kind === "exp" ? d.target : d.source);
      })
      .attr("stroke-width", function (d) { return Math.max(1, d.width); });
    slinks.append("title").text(function (d) { return d.source.name + " → " + d.target.name + "\n" + money(d.value); });
    slinks.attr("stroke-opacity", reduceS ? 0.3 : 0)
      .transition().duration(reduceS ? 0 : 450).ease(d3.easeCubicOut).attr("stroke-opacity", 0.3);

    var node = svg.append("g").selectAll("g").data(graph.nodes).enter().append("g").attr("class", "snode");
    node.append("rect")
      .attr("x", function (d) { return d.x0; }).attr("y", function (d) { return d.y0; })
      .attr("width", function (d) { return d.x1 - d.x0; })
      .attr("height", function (d) { return Math.max(1, d.y1 - d.y0); })
      .attr("fill", sankeyNodeColor).attr("rx", 2)
      .append("title").text(function (d) { return d.name + "\n" + money(d.value); });

    node.append("text").attr("class", "slabel")
      .attr("x", function (d) { return d.x0 < W / 2 ? d.x1 + 7 : d.x0 - 7; })
      .attr("y", function (d) { return (d.y0 + d.y1) / 2; })
      .attr("dy", "0.32em")
      .attr("text-anchor", function (d) { return d.x0 < W / 2 ? "start" : "end"; })
      .attr("fill", cssVar("var(--ink)"))
      .text(function (d) { return d.name; })
      .each(function (d) {
        d3.select(this).append("tspan").attr("class", "svalue")
          .attr("x", d.x0 < W / 2 ? d.x1 + 7 : d.x0 - 7).attr("dy", "1.25em")
          .attr("text-anchor", d.x0 < W / 2 ? "start" : "end")
          .attr("fill", cssVar("var(--ink-faint)")).text(moneyShort(d.value));
      });
  }

  // ---------- sankey: mobile (vertical, transposed) ----------
  function drawSankeyMobile() {
    var wrap = document.getElementById("sankey-wrap");
    var W = wrap.clientWidth || 360;
    var RIGHT_PAD = 70; // room for rotated expenditure labels extending right/down
    // compute layout in a transposed frame: layout width = visual height, layout height = visual width
    var LW = Math.max(520, Math.min(900, W * 2.0)); // becomes vertical extent
    var LH = W - 8;                                   // becomes horizontal extent (node spread)
    var g = buildSankeyGraph({ topN: 6, mergeRev: true });
    // extra top room for staggered revenue labels, bottom room for rotated expenditure labels
    var sankey = d3.sankey().nodeWidth(12).nodePadding(16).extent([[6, 56], [LW - 130, LH - 6]]);
    var graph = sankey({
      nodes: g.nodes.map(function (d) { return Object.assign({}, d); }),
      links: g.links.map(function (d) { return Object.assign({}, d); })
    });

    var H = LW; // visual height = layout width
    var svg = d3.select("#sankey").attr("viewBox", "0 0 " + (W + RIGHT_PAD) + " " + H).attr("width", "100%").attr("height", H * (W / (W + RIGHT_PAD)));
    svg.selectAll("*").remove();

    // transpose helper: layout (x,y) -> visual (y, x)
    function tx(d) { return d.y0; }              // visual x = layout y
    function ty(d) { return d.x0; }              // visual y = layout x

    // vertical link path: connect bottom of source to top of target using cubic in Y
    function vlink(d) {
      var sx = (d.source.y0 + d.source.y1) / 2;   // visual x center of source
      var tx2 = (d.target.y0 + d.target.y1) / 2;  // visual x center of target
      var sy = d.source.x1;                        // visual y = bottom edge of source (layout x1)
      var tyy = d.target.x0;                       // visual y = top edge of target
      // offset by link position within node for ribbon effect
      var sOff = (d.y0 - (d.source.y0 + d.source.y1) / 2);
      var tOff = (d.y1 - (d.target.y0 + d.target.y1) / 2);
      var x0 = sx + sOff, x1 = tx2 + tOff;
      var ym = (sy + tyy) / 2;
      return "M" + x0 + "," + sy + "C" + x0 + "," + ym + " " + x1 + "," + ym + " " + x1 + "," + tyy;
    }

    svg.append("g").attr("fill", "none")
      .selectAll("path").data(graph.links).enter().append("path")
      .attr("class", "slink").attr("d", vlink)
      .attr("stroke", function (d) {
        return d.source.name === "Deficyt (dług)" ? cssVar("var(--danger)") : sankeyNodeColor(d.target.kind === "exp" ? d.target : d.source);
      })
      .attr("stroke-opacity", 0.32)
      .attr("stroke-width", function (d) { return Math.max(1.5, d.width); })
      .append("title").text(function (d) { return d.source.name + " → " + d.target.name + "\n" + money(d.value); });

    var node = svg.append("g").selectAll("g").data(graph.nodes).enter().append("g").attr("class", "snode");
    node.append("rect")
      .attr("x", function (d) { return d.y0; })                       // visual x = layout y
      .attr("y", function (d) { return d.x0; })                       // visual y = layout x
      .attr("width", function (d) { return Math.max(1, d.y1 - d.y0); })
      .attr("height", function (d) { return d.x1 - d.x0; })
      .attr("fill", sankeyNodeColor).attr("rx", 2)
      .append("title").text(function (d) { return d.name + "\n" + money(d.value); });

    // labels: rev at top (staggered to avoid collisions), exp at bottom (rotated), hub centered
    var revSeq = 0;
    node.each(function (d) {
      var sel = d3.select(this);
      var cx = (d.y0 + d.y1) / 2;
      if (d.kind === "hub") {
        sel.append("text").attr("class", "slabel")
          .attr("x", cx).attr("y", (d.x0 + d.x1) / 2 + 4).attr("text-anchor", "middle")
          .attr("fill", cssVar("var(--ink)")).style("font-size", "12px").style("font-weight", "500")
          .text(shortLabel(d.name) + " · " + moneyShort(d.value));
        return;
      }
      if (d.kind === "rev") {
        // stagger across two fixed rows near the top so names never clip
        var row = (revSeq++ % 2);
        var yName = 14 + row * 22;
        var t = sel.append("text").attr("class", "slabel")
          .attr("x", cx).attr("y", yName).attr("text-anchor", "middle")
          .attr("fill", cssVar("var(--ink)")).style("font-size", "10px")
          .text(shortLabel(d.name));
        t.append("tspan").attr("x", cx).attr("dy", "1.05em")
          .attr("class", "svalue").attr("fill", cssVar("var(--ink-faint)"))
          .style("font-size", "9px").text(moneyShort(d.value));
        return;
      }
      // exp — below node, rotated to read vertically (prevents horizontal collisions)
      var yB = d.x1 + 8;
      var gx = sel.append("g").attr("transform", "translate(" + cx + "," + yB + ") rotate(40)");
      gx.append("text").attr("class", "slabel")
        .attr("x", 0).attr("y", 0).attr("text-anchor", "start")
        .attr("fill", cssVar("var(--ink)")).style("font-size", "10px")
        .text(shortLabel(d.name) + " · " + moneyShort(d.value));
    });
  }

  function shortLabel(name) {
    var map = {
      "Obowiązkowe ubezpieczenia społeczne": "Ubezp. społ.",
      "Różne rozliczenia": "Różne rozlicz.",
      "Obrona narodowa": "Obrona",
      "Obsługa długu publicznego": "Obsługa długu",
      "Ochrona zdrowia": "Zdrowie",
      "Szkolnictwo wyższe i nauka": "Szkoln. wyższe",
      "Bezpieczeństwo publiczne i ochrona ppoż.": "Bezpieczeństwo",
      "Administracja publiczna": "Administracja",
      "Pozostałe działy": "Pozostałe",
      "Inne dochody podatkowe i niepodatkowe": "Inne dochody",
      "Inne podatki": "Inne podatki",
      "Deficyt (dług)": "Deficyt",
      "Budżet państwa": "Budżet"
    };
    return map[name] || name;
  }

  // ---------- type breakdown ----------
  function typeColorKey(name) {
    var n = name.toLowerCase();
    if (/świadcz/.test(n)) return "social";
    if (/bieżąc/.test(n)) return "admin";
    if (/dotacj|subwencj/.test(n)) return "transfer";
    if (/majątk|inwestyc/.test(n)) return "infra";
    if (/dług/.test(n)) return "debt";
    if (/własne ue|środki własne/.test(n)) return "edu";
    if (/współfinans|projekt/.test(n)) return "health";
    return "other";
  }
  function drawTypes() {
    var src = (DATA && DATA.typy) ? DATA.typy : [];
    var types = src.map(function (t) {
      return { name: t.name, key: typeColorKey(t.name), value: t.plan };
    });
    if (!types.length) { document.getElementById("types").innerHTML = '<p style="color:var(--ink-faint)">Brak danych o rodzaju wydatku dla tego roku.</p>'; return; }
    var total = d3.sum(types, function (t) { return t.value; });
    var max = d3.max(types, function (t) { return t.value; });
    types.sort(function (a, b) { return b.value - a.value; });

    var el = document.getElementById("types");
    el.innerHTML = types.map(function (t, i) {
      var pct = (t.value / total * 100);
      var w = (t.value / max * 100);
      var c = CMAP[t.key];
      var delay = Math.min(i * 40, 360);
      return '<div class="type-row">' +
        '<div class="type-name">' + t.name + '</div>' +
        '<div class="type-bar-track"><div class="type-bar-fill grow-in" style="width:' + w.toFixed(1) + '%;background:' + c.fill + ';border:1px solid ' + c.line + ';--anim-delay:' + delay + 'ms"></div></div>' +
        '<div class="type-amt">' + money(t.value) + ' <span style="color:var(--ink-faint);font-weight:400">· ' + pct.toFixed(1).replace(".", ",") + '%</span></div>' +
        '</div>';
    }).join("");
  }

  // ---------- tabs & axis ----------
  function wireTabs() {
    var tabs = [["tab-tree", "panel-tree", "tree"], ["tab-flow", "panel-flow", "flow"], ["tab-type", "panel-type", "type"]];
    tabs.forEach(function (t) {
      document.getElementById(t[0]).addEventListener("click", function () { switchView(t[2]); });
    });
  }
  function switchView(v) {
    view = v;
    var map = { tree: ["tab-tree", "panel-tree"], flow: ["tab-flow", "panel-flow"], type: ["tab-type", "panel-type"] };
    Object.keys(map).forEach(function (k) {
      var isSel = k === v;
      document.getElementById(map[k][0]).setAttribute("aria-selected", isSel ? "true" : "false");
      var panel = document.getElementById(map[k][1]);
      panel.classList.toggle("is-active", isSel);
      if (isSel) {
        panel.removeAttribute("hidden");
        if (!prefersReduced()) {
          panel.classList.remove("fade-in");
          void panel.offsetWidth; // reflow so the animation re-triggers each switch
          panel.classList.add("fade-in");
        }
      } else {
        panel.setAttribute("hidden", "");
        panel.classList.remove("fade-in");
      }
    });
    // axis toggle: only meaningful for treemap
    document.getElementById("axis-toggle").style.display = (v === "tree") ? "inline-flex" : "none";
    if (v === "tree") drawTree();
    if (v === "flow") drawSankey();
    if (v === "type") drawTypes();
  }

  function wireAxis() {
    document.getElementById("axis-dzialy").addEventListener("click", function () { setAxis("dzialy"); });
    document.getElementById("axis-czesci").addEventListener("click", function () { setAxis("czesci"); });
  }

  function wireYear() {
    var seg = document.getElementById("year-seg");
    if (!seg) return;
    seg.querySelectorAll("button").forEach(function (btn) {
      btn.addEventListener("click", function () { setYear(parseInt(btn.getAttribute("data-year"), 10)); });
    });
  }

  function setYear(yr) {
    if (yr === YEAR) return;
    // reflect pressed state
    document.querySelectorAll("#year-seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", parseInt(b.getAttribute("data-year"), 10) === yr ? "true" : "false");
    });
    path = [];
    restExpanded = false;

    function apply(json) {
      DATA = json;
      YEAR = yr;
      renderStats();
      // re-render whichever year-specific view is active, with a blurred crossfade
      crossfadeRedraw(function () {
        if (view === "tree") drawTree();
        else if (view === "flow") drawSankey();
        else if (view === "type") drawTypes();
      });
    }

    if (YEAR_CACHE[yr]) { apply(YEAR_CACHE[yr]); return; }

    // lazy-load the year's file
    var file = YEAR_FILES[yr];
    if (!file) return;
    // show a quick loading hint on the treemap if that's the active view
    if (view === "tree") {
      var st = document.getElementById("tree-state");
      if (st) { st.style.display = "block"; st.innerHTML = '<div class="spinner"></div>Wczytuję budżet ' + yr + '…'; }
    }
    fetch(file)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) { YEAR_CACHE[yr] = json; apply(json); })
      .catch(function (err) {
        console.error(err);
        var st2 = document.getElementById("tree-state");
        if (st2) st2.innerHTML = '<i class="ti ti-alert-triangle"></i> Nie udało się wczytać budżetu ' + yr + '.';
      });
  }
  function setAxis(a) {
    if (axis === a) return;
    axis = a;
    path = [];
    restExpanded = false;
    document.getElementById("axis-dzialy").setAttribute("aria-pressed", a === "dzialy" ? "true" : "false");
    document.getElementById("axis-czesci").setAttribute("aria-pressed", a === "czesci" ? "true" : "false");
    drawTree();
  }

  function onResize() {
    if (view === "tree") drawTree();
    else if (view === "flow") drawSankey();
    else if (view === "type") drawTypes();
  }

  // redraw active view immediately when crossing the mobile/desktop breakpoint
  (function wireBreakpoint() {
    var handler = function () {
      restExpanded = false;
      onResize();
    };
    [MOBILE_Q, COARSE_Q].forEach(function (q) {
      if (q.addEventListener) q.addEventListener("change", handler);
      else if (q.addListener) q.addListener(handler);
    });
  })();

  // ---------- helpers ----------
  function wrapText(str, maxChars, maxLines) {
    if (maxChars < 4) return [];
    var words = str.split(" "), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (test.length > maxChars && cur) { lines.push(cur); cur = words[i]; }
      else cur = test;
      if (lines.length >= maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines && (cur || words.length > lines.join(" ").split(" ").length)) {
      var last = lines[maxLines - 1];
      if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1);
      lines[maxLines - 1] = last + "…";
    }
    return lines;
  }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function prefersReduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  // active chart container for the current view (target of the year-change crossfade)
  function activeChartEl() {
    if (view === "flow") return document.getElementById("sankey-wrap");
    if (view === "type") return document.getElementById("types");
    return document.getElementById("treemap-wrap");
  }
  // blur out → swap data → fade back in. Blur masks the imperfect state swap.
  function crossfadeRedraw(redraw) {
    var el = activeChartEl();
    if (!el || prefersReduced()) { redraw(); return; }
    el.classList.add("chart-swap", "is-swapping");
    setTimeout(function () {
      redraw();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { el.classList.remove("is-swapping"); });
      });
    }, 150);
  }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); var a = arguments, c = this; t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

})();
