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
  var dzialDetail = null;     // open dział detail (code) or null — available on all years

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
      updateExecTab(); // hide the Plan vs wykonanie tab unless the current year has data
      window.addEventListener("resize", debounce(onResize, 150));
      window.addEventListener("popstate", syncFromUrl); // back/forward toggles the dział detail
      initFromUrl(); // deep link ?rok=2025&dzial=NNN
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
    if (lead) lead.textContent = "Każda złotówka z ustawy budżetowej, rozłożona na czynniki pierwsze. Wielkość pola odpowiada kwocie. Kliknij, żeby wejść głębiej. Dane pochodzą wprost z ustawy budżetowej na rok " + yr + " i sumują się co do tysiąca złotych.";
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
    // tiles scale-pop into place from their own centre: 0.85 → 1.04 (expand) → 1.0 (settle).
    // compound transform keeps the tile positioned while scaling about its centre.
    function tf(d, s) {
      var w = d.x1 - d.x0, h = d.y1 - d.y0;
      return "translate(" + (d.x0 + w / 2) + "," + (d.y0 + h / 2) + ") scale(" + s + ") translate(" + (-w / 2) + "," + (-h / 2) + ")";
    }
    var g = svg.selectAll("g.tile").data(root.leaves()).enter()
      .append("g").attr("class", "tile")
      .attr("transform", function (d) { return tf(d, reduce ? 1 : 0.85); })
      .style("opacity", reduce ? 1 : 0);

    if (!reduce) {
      var t1 = g.transition()
        .delay(function (d, i) { return Math.min(i * 22, 480); })
        .duration(230).ease(d3.easeCubicOut)
        .style("opacity", 1)
        .attrTween("transform", function (d) {
          var i = d3.interpolateNumber(0.85, 1.04);
          return function (tt) { return tf(d, i(tt)); };
        });
      t1.transition().duration(150).ease(d3.easeCubicInOut)
        .attrTween("transform", function (d) {
          var i = d3.interpolateNumber(1.04, 1);
          return function (tt) { return tf(d, i(tt)); };
        });
    }

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
      .style("cursor", function (d) { return tileInteractive(d.data) ? "pointer" : "default"; })
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", function (d) {
        return d.data.name + ", " + money(d.data.value) + (tileInteractive(d.data) ? ", kliknij aby wejść w szczegóły" : "");
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
      var drill = tileInteractive(d);
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
  // in działy mode, a tile opens the dział detail view (all years; needs the części axis data)
  function canOpenDetail() { return axis === "dzialy" && !!(DATA && DATA.czesci && DATA.czesci.length); }
  function tileInteractive(d) { return canDrill(d) || canOpenDetail(); }

  function onTileClick(d) {
    if (canOpenDetail()) { openDzial(d.code, true); return; }
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

  // ================= DZIAŁ DETAIL (all years) =================
  // aggregate which części fund a given dział (by code), with their rozdziały
  function aggregatePartsForDzial(code) {
    var rows = [];
    (DATA.czesci || []).forEach(function (cz) {
      var sum = 0, roz = [];
      (cz.dzialy || []).forEach(function (dz) {
        if (dz.code === code) { sum += dz.plan; if (dz.rozdzialy) roz = roz.concat(dz.rozdzialy); }
      });
      if (sum > 0) rows.push({ czescCode: cz.code, czescName: cz.name, sum: sum, rozdzialy: roz });
    });
    rows.sort(function (a, b) { return b.sum - a.sum; });
    return { rows: rows, aggTotal: d3.sum(rows, function (r) { return r.sum; }) };
  }

  function dzialMeta(code) {
    var d = (DATA.dzialy || []).filter(function (x) { return x.code === code; })[0];
    return d || null;
  }
  // Polish plural: 1 część / 2-4 części / 5+ części
  function plural(n, one, few, many) {
    n = Math.abs(n); var d10 = n % 10, d100 = n % 100;
    if (n === 1) return one;
    if (d10 >= 2 && d10 <= 4 && !(d100 >= 12 && d100 <= 14)) return few;
    return many;
  }

  function drawDzialDetail(code) {
    var host = document.getElementById("dzial-detail"); if (!host) return;
    var dz = dzialMeta(code);
    if (!dz) { closeDzial(true); return; }
    var agg = aggregatePartsForDzial(code);
    var share = (dz.plan / DATA.meta.wydatki * 100).toFixed(1).replace(".", ",");
    var maxSum = agg.rows.length ? agg.rows[0].sum : 1;
    var nRoz = d3.sum(agg.rows, function (r) { return r.rozdzialy.length; });
    var col = CMAP[colorKey(dz.name)];

    var parts = agg.rows.map(function (r, i) {
      var w = Math.max(2, r.sum / maxSum * 100);
      var pShare = r.sum / agg.aggTotal * 100;
      var rc = CMAP[colorKey(r.czescName)];
      var rozHtml = r.rozdzialy.slice().sort(function (a, b) { return b.plan - a.plan; }).map(function (rz) {
        var rsh = r.sum ? (rz.plan / r.sum * 100) : 0;
        return '<div class="dd-roz"><span class="dd-roz-name">' + escapeHtml(rz.name) +
          ' <span class="dd-code">' + rz.code + '</span></span>' +
          '<span class="dd-roz-amt">' + money(rz.plan) + ' <span class="dd-roz-pct">' + rsh.toFixed(0) + '%</span></span></div>';
      }).join("");
      return '<details class="dd-part" style="--i:' + i + '">' +
        '<summary>' +
          '<span class="dd-part-head">' +
            '<span class="dd-part-name">' + escapeHtml(r.czescName) + ' <span class="dd-code">cz. ' + r.czescCode + '</span></span>' +
            '<span class="dd-part-amt">' + money(r.sum) + ' <span class="dd-part-pct">' + pShare.toFixed(0) + '%</span></span>' +
          '</span>' +
          '<span class="dd-track"><span class="dd-fill dd-grow" style="width:' + w.toFixed(1) + '%;background:' + rc.fill + ';border:1px solid ' + rc.line + '"></span></span>' +
        '</summary>' +
        '<div class="dd-roz-list">' + (rozHtml || '<p class="dd-empty">Brak rozdziałów w danych.</p>') + '</div>' +
        '</details>';
    }).join("");

    host.innerHTML =
      '<button class="dd-back" id="dd-back"><i class="ti ti-arrow-left" aria-hidden="true"></i> Wszystkie działy</button>' +
      '<header class="dd-header">' +
        '<span class="dd-accent" style="background:' + col.line + '"></span>' +
        '<p class="dd-eyebrow">Dział ' + escapeHtml(code) + ' · plan ' + (DATA.meta.rok || YEAR) + '</p>' +
        '<h2 class="dd-title">' + escapeHtml(dz.name) + '</h2>' +
        '<p class="dd-amount"><span class="dd-amount-num" id="dd-amt"></span><span class="dd-share">' + share + '% budżetu</span></p>' +
        '<p class="dd-meta">' + agg.rows.length + ' ' + plural(agg.rows.length, "część", "części", "części") +
          ' · ' + nRoz + ' ' + plural(nRoz, "rozdział", "rozdziały", "rozdziałów") + '</p>' +
      '</header>' +
      '<h3 class="dd-h">Kto to wydaje</h3>' +
      '<p class="dd-sub">Części (dysponenci) wnoszące wydatki do tego działu, wg udziału. Rozwiń, by zobaczyć rozdziały.</p>' +
      '<div class="dd-parts">' + parts + '</div>' +
      '<p class="hint dd-note"><i class="ti ti-info-circle" aria-hidden="true"></i> Suma rozbicia wg części (' + money(agg.aggTotal) +
        ') może nieznacznie różnić się od kwoty zbiorczej działu (' + money(dz.plan) + ') — to różnice klasyfikacyjne w ustawie, nie błąd.</p>';

    var back = document.getElementById("dd-back");
    if (back) back.addEventListener("click", function () { closeDzial(true); });
    var amtEl = document.getElementById("dd-amt");
    if (amtEl) {
      var f = statMoneyFmt(dz.plan);
      tweenValue(0, dz.plan, 900, function (v) { var rr = f(v); amtEl.innerHTML = rr.num + '<span class="unit"> ' + rr.unit + '</span>'; });
    }
  }

  // focus mode: a body class hides hero / year bar / tabs / treemap (CSS), leaving the detail
  function openDzial(code, push) {
    if (!DATA || !dzialMeta(code)) return;
    dzialDetail = code;
    document.body.classList.add("dzial-open");
    var det = document.getElementById("dzial-detail");
    drawDzialDetail(code);
    det.hidden = false;
    window.scrollTo({ top: 0 });
    var rok = (DATA.meta && DATA.meta.rok) || YEAR;
    if (push) history.pushState({ rok: rok, dzial: code }, "", "?rok=" + rok + "&dzial=" + code);
  }

  function closeDzial(push) {
    if (dzialDetail == null) return;
    dzialDetail = null;
    document.body.classList.remove("dzial-open");
    var det = document.getElementById("dzial-detail"); if (det) det.hidden = true;
    if (view === "tree") drawTree();
    if (push) history.pushState({}, "", location.pathname);
  }

  // URL sync (back/forward + deep link)
  function syncFromUrl() {
    var p = new URLSearchParams(location.search);
    var dz = p.get("dzial"), rok = parseInt(p.get("rok"), 10);
    if (dz && rok === YEAR && view === "tree" && axis === "dzialy" && dzialMeta(dz)) {
      openDzial(dz, false);
    } else if (dzialDetail != null) {
      closeDzial(false);
    }
  }
  function initFromUrl() {
    var p = new URLSearchParams(location.search);
    var dz = p.get("dzial"), rok = parseInt(p.get("rok"), 10);
    if (dz && rok && YEAR_FILES[rok]) {
      setYear(rok, function () {
        if (axis === "dzialy" && view === "tree" && dzialMeta(dz)) openDzial(dz, false);
      });
    }
  }

  // ---------- tooltip ----------
  function showTip(ev, d, total) {
    var share = (d.value / total * 100).toFixed(1).replace(".", ",");
    tooltip.innerHTML = '<strong>' + escapeHtml(d.name) + '</strong><br>' +
      '<span class="tt-val">' + money(d.value) + '</span> · <span class="tt-share">' + share + '% poziomu</span>' +
      (tileInteractive(d) ? '<br><span style="opacity:.7">kliknij, aby wejść głębiej</span>' : '');
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

  // ================= TRENDS DASHBOARD (cross-year) =================
  var TRENDS = null;
  var trendsMode = "zl";              // "zl" | "pct"
  var trendsCat = "Obrona narodowa";
  var trendsWired = false;

  function loadTrends(cb) {
    if (TRENDS) { cb(); return; }
    var st = document.getElementById("trends-state");
    fetch("trends-data.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) {
        TRENDS = json;
        if (st) st.style.display = "none";
        var body = document.getElementById("trends-body");
        if (body) body.hidden = false;
        populateCatPicker();
        populateMoversPickers();
        wireTrends();
        cb();
      })
      .catch(function (err) {
        console.error(err);
        if (st) st.innerHTML = '<i class="ti ti-alert-triangle"></i> Nie udało się wczytać danych historycznych.';
      });
  }

  function trendYears() { return TRENDS.meta.lata; }
  function fmtYearAxis(yr) { return "'" + String(yr).slice(2); }
  function typeShort(n) {
    var map = {
      "Świadczenia na rzecz osób fizycznych": "Świadczenia",
      "Wydatki bieżące jednostek": "Bieżące",
      "Dotacje i subwencje": "Dotacje i subw.",
      "Wydatki majątkowe": "Majątkowe",
      "Obsługa długu Skarbu Państwa": "Obsługa długu",
      "Środki własne UE": "Środki UE",
      "Współfinansowanie projektów UE": "Współfin. UE"
    };
    return map[n] || n;
  }

  // categories present in >=75% of years, sorted by latest-year size
  function trendCategories() {
    var count = {}, latest = TRENDS.lata[TRENDS.lata.length - 1], latestMap = {};
    latest.dzialy.forEach(function (d) { latestMap[d.name] = d.plan; });
    TRENDS.lata.forEach(function (r) { r.dzialy.forEach(function (d) { count[d.name] = (count[d.name] || 0) + 1; }); });
    var n = TRENDS.lata.length;
    return Object.keys(count).filter(function (k) { return count[k] >= Math.ceil(n * 0.75); })
      .sort(function (a, b) { return (latestMap[b] || 0) - (latestMap[a] || 0); });
  }
  function populateCatPicker() {
    var sel = document.getElementById("trend-cat");
    if (!sel) return;
    var cats = trendCategories();
    if (cats.indexOf(trendsCat) < 0) trendsCat = cats[0];
    sel.innerHTML = cats.map(function (c) {
      return '<option value="' + escapeHtml(c) + '"' + (c === trendsCat ? " selected" : "") + '>' + escapeHtml(c) + '</option>';
    }).join("");
  }
  function wireTrends() {
    if (trendsWired) return;
    trendsWired = true;
    var zl = document.getElementById("trend-zl"), pct = document.getElementById("trend-pct");
    if (zl) zl.addEventListener("click", function () { setTrendsMode("zl"); });
    if (pct) pct.addEventListener("click", function () { setTrendsMode("pct"); });
    var sel = document.getElementById("trend-cat");
    if (sel) sel.addEventListener("change", function () { trendsCat = sel.value; drawTrendCategory(); });
    var rc = document.getElementById("trend-real-curr"), rk = document.getElementById("trend-real-const");
    if (rc) rc.addEventListener("click", function () { setTrendsReal(false); });
    if (rk) rk.addEventListener("click", function () { setTrendsReal(true); });
    var mf = document.getElementById("movers-from"), mt = document.getElementById("movers-to");
    if (mf) mf.addEventListener("change", function () { moversFrom = parseInt(mf.value, 10); drawMovers(); });
    if (mt) mt.addEventListener("change", function () { moversTo = parseInt(mt.value, 10); drawMovers(); });
  }
  function setTrendsMode(m) {
    if (trendsMode === m) return;
    trendsMode = m;
    document.getElementById("trend-zl").setAttribute("aria-pressed", m === "zl" ? "true" : "false");
    document.getElementById("trend-pct").setAttribute("aria-pressed", m === "pct" ? "true" : "false");
    drawTrendTypes();
    drawTrendCategory();
  }

  function drawTrends() { if (!TRENDS) return; drawTrendKPIs(); drawTrendCharts(); }
  function drawTrendCharts() { if (!TRENDS) return; drawTrendTotals(); drawTrendTypes(); drawTrendCategory(); drawMovers(); }

  function buildLegendEl(id, items) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items.map(function (it) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + it.color + '"></span>' + escapeHtml(it.label) + '</span>';
    }).join("");
  }

  // ---- KPI cards ----
  function drawTrendKPIs() {
    var L = TRENDS.lata, first = L[0], last = L[L.length - 1];
    var growth = (last.wydatki / first.wydatki - 1) * 100;
    var maxDef = L.reduce(function (a, b) { return b.deficyt > a.deficyt ? b : a; });
    var balanced = L.filter(function (r) { return r.deficyt === 0; }).map(function (r) { return r.rok; });
    var cumDef = d3.sum(L, function (r) { return r.deficyt; });
    var realFirst = deflate(first.wydatki, first.rok);
    var realGrowth = CONTEXT ? (last.wydatki / realFirst - 1) * 100 : null;
    var growthFoot = first.rok + " → " + last.rok + (realGrowth != null ? " · realnie +" + Math.round(realGrowth) + "%" : "");
    var cards = [
      { label: "Wzrost wydatków", to: growth, fmt: statPctFmt(0), foot: growthFoot },
      { label: "Największy deficyt", to: maxDef.deficyt, fmt: statMoneyFmt(maxDef.deficyt), foot: "Rok " + maxDef.rok, danger: true },
      { label: "Budżet zbilansowany", to: balanced.length ? balanced[0] : 0, fmt: function () { return { num: balanced.length ? String(balanced[0]) : "b.d.", unit: "" }; }, foot: balanced.length ? "Deficyt = 0" : "Brak", noAnim: true },
      { label: "Suma deficytów", to: cumDef, fmt: statMoneyFmt(cumDef), foot: first.rok + "–" + last.rok }
    ];
    var host = document.getElementById("trend-kpis");
    host.innerHTML = cards.map(function (c, i) {
      return '<div class="stat anim-in" style="--anim-delay:' + (i * 50) + 'ms">' +
        '<p class="stat-label">' + c.label + '</p>' +
        '<p class="stat-value' + (c.danger ? " is-danger" : "") + '" data-tk="' + i + '"></p>' +
        '<p class="stat-foot">' + c.foot + '</p></div>';
    }).join("");
    cards.forEach(function (c, i) {
      var el = host.querySelector('.stat-value[data-tk="' + i + '"]');
      if (c.noAnim) { var rr = c.fmt(c.to); el.innerHTML = rr.num + (rr.unit ? '<span class="unit">' + rr.unit + '</span>' : ""); return; }
      var key = "__tk" + i, from = prevStatVals[key]; if (from == null) from = 0;
      tweenValue(from, c.to, 900, function (v) {
        var r = c.fmt(v);
        el.innerHTML = r.num + (r.unit ? '<span class="unit">' + r.unit + '</span>' : "");
      });
      prevStatVals[key] = c.to;
    });
  }

  // ---- reusable responsive line chart with touch focus ----
  function trendLineChart(svgId, series, opts) {
    opts = opts || {};
    var svgEl = document.getElementById(svgId);
    if (!svgEl) return;
    var wrap = svgEl.parentNode;
    var W = wrap.clientWidth || 800;
    var narrow = W < 520;
    var H = opts.height || (narrow ? 240 : 300);
    var m = { t: 14, r: narrow ? 12 : 18, b: 26, l: narrow ? 46 : 58 };
    var iw = Math.max(10, W - m.l - m.r), ih = Math.max(10, H - m.t - m.b);
    var years = trendYears();
    var x = d3.scaleLinear().domain([years[0], years[years.length - 1]]).range([0, iw]);
    var allY = [];
    series.forEach(function (s) { s.values.forEach(function (p) { if (p.y != null) allY.push(p.y); }); });
    var ymax = d3.max(allY) || 1;
    var ymin = opts.allowNeg ? Math.min(0, d3.min(allY)) : 0;
    var y = d3.scaleLinear().domain([ymin, ymax * 1.06]).nice().range([ih, 0]);

    var svg = d3.select(svgEl).attr("viewBox", "0 0 " + W + " " + H).attr("width", "100%").attr("height", H);
    svg.selectAll("*").remove();
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    var yticks = y.ticks(narrow ? 4 : 5);
    g.selectAll("line.grid").data(yticks).enter().append("line").attr("class", "grid")
      .attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
    g.selectAll("text.gy").data(yticks).enter().append("text").attr("class", "axis-label gy")
      .attr("x", -8).attr("y", y).attr("dy", "0.32em").attr("text-anchor", "end")
      .text(function (d) { return (opts.yFmt || moneyShort)(d); });

    var step = narrow ? 3 : (W < 760 ? 2 : 1);
    g.selectAll("text.gx").data(years).enter().append("text").attr("class", "axis-label gx")
      .attr("x", function (d) { return x(d); }).attr("y", ih + 18).attr("text-anchor", "middle")
      .text(function (d, i) { return (i % step === 0 || i === years.length - 1) ? (narrow ? fmtYearAxis(d) : d) : ""; });

    if (opts.markerYear != null) {
      g.append("line").attr("class", "year-marker")
        .attr("x1", x(opts.markerYear)).attr("x2", x(opts.markerYear)).attr("y1", 0).attr("y2", ih);
    }

    var reduce = prefersReduced();
    var line = d3.line().defined(function (p) { return p.y != null; })
      .x(function (p) { return x(p.x); }).y(function (p) { return y(p.y); }).curve(d3.curveMonotoneX);

    series.forEach(function (s) {
      var path = g.append("path").datum(s.values).attr("fill", "none")
        .attr("stroke", s.color).attr("stroke-width", narrow ? 2.2 : 2.6)
        .attr("stroke-linejoin", "round").attr("stroke-linecap", "round").attr("d", line);
      if (!reduce) {
        var len = path.node().getTotalLength();
        if (len > 0) path.attr("stroke-dasharray", len + " " + len).attr("stroke-dashoffset", len)
          .transition().duration(700).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
          .on("end", function () { d3.select(this).attr("stroke-dasharray", null); });
      }
      s.values.forEach(function (p) {
        if (p.y == null) return;
        g.append("circle").attr("class", "tdot").attr("r", narrow ? 2.4 : 3)
          .attr("cx", x(p.x)).attr("cy", y(p.y)).attr("fill", s.color);
      });
    });

    // focus interaction (mouse + touch)
    var focusLine = g.append("line").attr("class", "focus-line").attr("y1", 0).attr("y2", ih).style("opacity", 0);
    var ov = g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent");
    var node = ov.node();
    function move(e) {
      var rect = node.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var yr = Math.max(years[0], Math.min(years[years.length - 1], Math.round(x.invert(mx))));
      focusLine.attr("x1", x(yr)).attr("x2", x(yr)).style("opacity", 1);
      var rows = series.map(function (s) {
        var p = s.values.filter(function (pp) { return pp.x === yr; })[0];
        if (!p || p.y == null) return "";
        return '<div class="tt-row"><span class="tt-dot" style="background:' + s.color + '"></span>' +
          escapeHtml(s.name) + ': <strong>' + (opts.yTip || opts.yFmt || money)(p.y) + '</strong></div>';
      }).join("");
      tooltip.innerHTML = '<strong>' + yr + '</strong>' + rows;
      tooltip.style.opacity = "1";
      positionTip(e);
    }
    function leave() { hideTip(); focusLine.style("opacity", 0); }
    node.addEventListener("mousemove", move);
    node.addEventListener("mouseleave", leave);
    node.addEventListener("touchstart", function (e) { move(e.touches[0]); }, { passive: true });
    node.addEventListener("touchmove", function (e) { e.preventDefault(); move(e.touches[0]); }, { passive: false });
    node.addEventListener("touchend", leave);
  }

  // ---- module 2: totals (wydatki / dochody / deficyt) ----
  function drawTrendTotals() {
    var L = TRENDS.lata;
    function vals(f) { return L.map(function (r) { return { x: r.rok, y: realVal(r[f], r.rok) }; }); }
    var series = [
      { name: "Wydatki", color: cssVar("var(--accent)"), values: vals("wydatki") },
      { name: "Dochody", color: cssVar("var(--c-transfer-line)"), values: vals("dochody") },
      { name: "Deficyt", color: cssVar("var(--danger)"), values: vals("deficyt") }
    ];
    buildLegendEl("legend-totals", series.map(function (s) { return { label: s.name, color: s.color }; }));
    trendLineChart("chart-totals", series, { markerYear: YEAR, yFmt: moneyShort, yTip: money });
  }

  // ---- module 4: selected category over time ----
  function drawTrendCategory() {
    if (!TRENDS) return;
    var L = TRENDS.lata, pctMode = trendsMode === "pct";
    var values = L.map(function (r) {
      var d = r.dzialy.filter(function (x) { return x.name === trendsCat; })[0];
      var v = d ? d.plan : null;
      if (pctMode && v != null) v = v / r.wydatki * 100;
      else if (v != null) v = realVal(v, r.rok);
      return { x: r.rok, y: v };
    });
    var color = cssVar(CMAP[colorKey(trendsCat)].line);
    trendLineChart("chart-cat", [{ name: trendsCat, color: color, values: values }], {
      markerYear: YEAR,
      yFmt: pctMode ? function (v) { return v.toFixed(0) + "%"; } : moneyShort,
      yTip: pctMode ? function (v) { return v.toFixed(1).replace(".", ",") + "%"; } : money
    });
  }

  // ---- module 3: expense type composition over time (stacked columns) ----
  function drawTrendTypes() {
    if (!TRENDS) return;
    var svgEl = document.getElementById("chart-types");
    if (!svgEl) return;
    var wrap = svgEl.parentNode;
    var W = wrap.clientWidth || 800;
    var narrow = W < 520;
    var H = narrow ? 270 : 330;
    var m = { t: 14, r: narrow ? 10 : 16, b: 26, l: narrow ? 46 : 58 };
    var iw = Math.max(10, W - m.l - m.r), ih = Math.max(10, H - m.t - m.b);
    var L = TRENDS.lata, years = trendYears(), pctMode = trendsMode === "pct";
    var typeNames = L[L.length - 1].typy.slice().sort(function (a, b) { return b.plan - a.plan; }).map(function (t) { return t.name; });

    var x = d3.scaleBand().domain(years.map(String)).range([0, iw]).padding(narrow ? 0.16 : 0.32);
    var maxTotal = pctMode ? 100 : d3.max(L, function (r) { return d3.sum(r.typy, function (t) { return realVal(t.plan, r.rok); }); });
    var y = d3.scaleLinear().domain([0, maxTotal]).nice().range([ih, 0]);

    var svg = d3.select(svgEl).attr("viewBox", "0 0 " + W + " " + H).attr("width", "100%").attr("height", H);
    svg.selectAll("*").remove();
    var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    var yticks = y.ticks(narrow ? 4 : 5);
    g.selectAll("line.grid").data(yticks).enter().append("line").attr("class", "grid")
      .attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
    g.selectAll("text.gy").data(yticks).enter().append("text").attr("class", "axis-label gy")
      .attr("x", -8).attr("y", y).attr("dy", "0.32em").attr("text-anchor", "end")
      .text(function (d) { return pctMode ? d + "%" : moneyShort(d); });

    var step = narrow ? 3 : (W < 760 ? 2 : 1);
    g.selectAll("text.gx").data(years).enter().append("text").attr("class", "axis-label gx")
      .attr("x", function (d) { return x(String(d)) + x.bandwidth() / 2; }).attr("y", ih + 18).attr("text-anchor", "middle")
      .text(function (d, i) { return (i % step === 0 || i === years.length - 1) ? (narrow ? fmtYearAxis(d) : d) : ""; });

    var reduce = prefersReduced();
    L.forEach(function (r) {
      var total = d3.sum(r.typy, function (t) { return t.plan; });
      var cum = 0, bx = x(String(r.rok)), bw = x.bandwidth();
      var colDelay = Math.min((r.rok - years[0]) * 18, 280);
      typeNames.forEach(function (tn) {
        var t = r.typy.filter(function (z) { return z.name === tn; })[0];
        var val = t ? t.plan : 0;
        var disp = pctMode ? (total ? val / total * 100 : 0) : realVal(val, r.rok);
        var y0 = cum, y1 = cum + disp; cum = y1;
        var ry = y(y1), rh = Math.max(0, y(y0) - y(y1));
        var rect = g.append("rect").attr("class", "tseg")
          .attr("x", bx).attr("width", bw)
          .attr("y", reduce ? ry : ih).attr("height", reduce ? rh : 0)
          .attr("fill", cssVar(CMAP[typeColorKey(tn)].fill))
          .attr("stroke", cssVar(CMAP[typeColorKey(tn)].line)).attr("stroke-width", 0.5);
        rect.append("title").text(tn + " (" + r.rok + "): " + (pctMode ? disp.toFixed(1).replace(".", ",") + "%" : money(val)));
        if (!reduce) rect.transition().delay(colDelay).duration(380).ease(d3.easeCubicOut).attr("y", ry).attr("height", rh);
      });
    });

    // frame the currently-selected year
    if (years.indexOf(YEAR) >= 0) {
      g.append("rect").attr("class", "col-current")
        .attr("x", x(String(YEAR)) - 2).attr("y", 0).attr("width", x.bandwidth() + 4).attr("height", ih);
    }

    buildLegendEl("legend-types", typeNames.map(function (tn) {
      return { label: typeShort(tn), color: cssVar(CMAP[typeColorKey(tn)].fill) };
    }));
  }

  // ================= CONTEXT (CPI + ludność z GUS) =================
  var CONTEXT = null;
  var PRICE = {};               // rok -> poziom cen (baza 2011 = 100)
  var REAL_BASE = 2026;         // ceny stałe wyrażone w cenach tego roku
  var trendsReal = false;       // false = ceny bieżące, true = ceny stałe

  function loadContext(cb) {
    if (CONTEXT) { cb(); return; }
    fetch("context-data.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) { CONTEXT = json; buildPriceLevels(); cb(); })
      .catch(function (err) { console.error(err); cb(); }); // degraduj: funkcje działają nominalnie
  }
  function buildPriceLevels() {
    PRICE = {}; var lvl = 100;
    CONTEXT.lata.forEach(function (r, i) { lvl = (i === 0) ? 100 : lvl * (r.cpi / 100); PRICE[r.rok] = lvl; });
    var base = CONTEXT.lata[CONTEXT.lata.length - 1].rok;
    if (PRICE[REAL_BASE] == null) REAL_BASE = base;
  }
  function popOf(year) { var r = (CONTEXT ? CONTEXT.lata : []).filter(function (x) { return x.rok === year; })[0]; return r ? r.ludnosc : null; }
  function deflate(val, year) {
    if (!CONTEXT || PRICE[year] == null || PRICE[REAL_BASE] == null) return val;
    return val * (PRICE[REAL_BASE] / PRICE[year]);
  }
  function realVal(val, year) { return (trendsReal && val != null) ? deflate(val, year) : val; }
  function zlFull(zl) { return fmtPL.format(Math.round(zl)) + " zł"; }

  // ================= NAJWIĘKSZE ZMIANY =================
  var moversFrom = null, moversTo = null;
  function yearRecT(y) { return TRENDS.lata.filter(function (r) { return r.rok === y; })[0]; }
  function populateMoversPickers() {
    var years = trendYears();
    if (moversFrom == null) moversFrom = years[0];
    if (moversTo == null) moversTo = years[years.length - 1];
    [["movers-from", moversFrom], ["movers-to", moversTo]].forEach(function (p) {
      var sel = document.getElementById(p[0]); if (!sel) return;
      sel.innerHTML = years.map(function (y) { return '<option value="' + y + '"' + (y === p[1] ? " selected" : "") + '>' + y + "</option>"; }).join("");
    });
  }
  function drawMovers() {
    if (!TRENDS) return;
    var host = document.getElementById("movers"); if (!host) return;
    var a = yearRecT(moversFrom), b = yearRecT(moversTo);
    if (!a || !b) { host.innerHTML = ""; return; }
    function mapOf(rec) { var m = {}; rec.dzialy.forEach(function (d) { m[d.name] = realVal(d.plan, rec.rok); }); return m; }
    var ma = mapOf(a), mb = mapOf(b), names = {};
    Object.keys(ma).forEach(function (n) { names[n] = 1; }); Object.keys(mb).forEach(function (n) { names[n] = 1; });
    var rows = Object.keys(names).map(function (n) {
      var va = ma[n] || 0, vb = mb[n] || 0;
      // suppress % when a dział is absent in one year (rename/reclassification, not a real 0→x / x→0 change)
      return { name: n, delta: vb - va, pct: (va > 0 && vb > 0) ? (vb / va - 1) * 100 : null };
    }).filter(function (r) { return Math.abs(r.delta) > 0; });
    var gain = rows.filter(function (r) { return r.delta > 0; }).sort(function (x, y) { return y.delta - x.delta; }).slice(0, 6);
    var loss = rows.filter(function (r) { return r.delta < 0; }).sort(function (x, y) { return x.delta - y.delta; }).slice(0, 6);
    var maxAbs = d3.max(rows, function (r) { return Math.abs(r.delta); }) || 1;
    function listHtml(title, arr, up) {
      return '<div class="movers-col"><h4 class="movers-h ' + (up ? "is-up" : "is-down") + '">' + title + "</h4>" +
        (arr.length ? arr.map(function (r) {
          var w = Math.max(3, Math.abs(r.delta) / maxAbs * 100);
          var sign = r.delta >= 0 ? "+" : "−";
          var pct = r.pct == null ? "" : ' <span class="mv-pct">' + sign + Math.abs(r.pct).toFixed(0) + "%</span>";
          var c = CMAP[colorKey(r.name)];
          return '<div class="mv-row"><span class="mv-name">' + escapeHtml(r.name) + "</span>" +
            '<span class="mv-track"><span class="mv-fill" style="width:' + w.toFixed(1) + "%;background:" + c.fill + ";border:1px solid " + c.line + '"></span></span>' +
            '<span class="mv-amt">' + sign + money(Math.abs(r.delta)) + pct + "</span></div>";
        }).join("") : '<p class="mv-empty">Brak</p>') + "</div>";
    }
    host.innerHTML = listHtml("Najbardziej wzrosły", gain, true) + listHtml("Najbardziej spadły", loss, false);
  }

  function setTrendsReal(real) {
    if (trendsReal === real) return;
    trendsReal = real;
    document.getElementById("trend-real-curr").setAttribute("aria-pressed", real ? "false" : "true");
    document.getElementById("trend-real-const").setAttribute("aria-pressed", real ? "true" : "false");
    drawTrendKPIs(); drawTrendTotals(); drawTrendTypes(); drawTrendCategory(); drawMovers();
  }

  // ================= TWOJE PODATKI =================
  var taxAmount = 5000, taxesWired = false;
  function wireTaxes() {
    if (taxesWired) return; taxesWired = true;
    var inp = document.getElementById("tax-input");
    if (inp) inp.addEventListener("input", function () {
      var v = parseFloat(inp.value); taxAmount = (isFinite(v) && v >= 0) ? v : 0; drawTaxSplit();
    });
  }
  function drawTaxes() {
    if (!DATA) return;
    var st = document.getElementById("taxes-state"), body = document.getElementById("taxes-body");
    if (st) st.style.display = "none";
    if (body) body.hidden = false;
    drawTaxKPIs(); drawTax1000(); drawTaxSplit();
  }
  function drawTaxKPIs() {
    var m = DATA.meta, pop = popOf(YEAR);
    var cards = [
      { label: "Wydatki na obywatela", to: pop ? m.wydatki / pop : 0, fmt: statMoneyFmt(pop ? m.wydatki / pop : 0), foot: "Rok " + (m.rok || YEAR), danger: false, na: !pop },
      { label: "Dochody na obywatela", to: pop ? m.dochody / pop : 0, fmt: statMoneyFmt(pop ? m.dochody / pop : 0), foot: "Wpływy ÷ ludność", danger: false, na: !pop },
      { label: "Deficyt na obywatela", to: pop ? m.deficyt / pop : 0, fmt: statMoneyFmt(pop ? m.deficyt / pop : 0), foot: "Dług na osobę", danger: true, na: !pop },
      { label: "Dziennie na obywatela", to: pop ? m.wydatki / pop / 365 : 0, fmt: statMoneyFmt(pop ? m.wydatki / pop / 365 : 0), foot: "Wydatki ÷ 365", danger: false, na: !pop }
    ];
    var host = document.getElementById("tax-kpis"); if (!host) return;
    host.innerHTML = cards.map(function (c, i) {
      return '<div class="stat anim-in" style="--anim-delay:' + (i * 50) + 'ms"><p class="stat-label">' + c.label + '</p>' +
        '<p class="stat-value' + (c.danger ? " is-danger" : "") + '" data-xk="' + i + '"></p><p class="stat-foot">' + c.foot + "</p></div>";
    }).join("");
    cards.forEach(function (c, i) {
      var el = host.querySelector('.stat-value[data-xk="' + i + '"]');
      if (c.na) { el.textContent = "—"; return; }
      var key = "__xk" + i, from = prevStatVals[key]; if (from == null) from = 0;
      tweenValue(from, c.to, 900, function (v) { var r = c.fmt(v); el.innerHTML = r.num + (r.unit ? '<span class="unit">' + r.unit + "</span>" : ""); });
      prevStatVals[key] = c.to;
    });
  }
  // shared bar list for the two tax modules
  function taxBarList(hostId, perShare, fmtAmt) {
    var host = document.getElementById(hostId); if (!host) return;
    var dz = DATA.dzialy.slice().sort(function (a, b) { return b.plan - a.plan; });
    var total = d3.sum(dz, function (d) { return d.plan; }) || 1;
    var TOPN = 12, top = dz.slice(0, TOPN), restSum = d3.sum(dz.slice(TOPN), function (d) { return d.plan; });
    var rows = top.map(function (d) { return { name: d.name, share: d.plan / total }; });
    if (restSum > 0) rows.push({ name: "Pozostałe działy", share: restSum / total });
    var maxShare = rows.length ? rows[0].share : 1;
    host.innerHTML = rows.map(function (r) {
      var w = Math.max(2, r.share / maxShare * 100);
      var c = CMAP[colorKey(r.name)];
      return '<div class="taxbar"><span class="taxbar-name">' + escapeHtml(r.name) + "</span>" +
        '<span class="taxbar-track"><span class="taxbar-fill grow-in" style="width:' + w.toFixed(1) + "%;background:" + c.fill + ";border:1px solid " + c.line + '"></span></span>' +
        '<span class="taxbar-amt">' + fmtAmt(perShare(r.share)) + "</span></div>";
    }).join("");
  }
  function drawTax1000() { taxBarList("tax-1000", function (s) { return s * 1000; }, function (v) { return Math.round(v) + " zł"; }); }
  function drawTaxSplit() { taxBarList("tax-split", function (s) { return s * taxAmount; }, function (v) { return zlFull(v); }); }

  // ================= PLAN VS WYKONANIE (test — na razie tylko 2025) =================
  var WYK_FILES = { 2025: "wykonanie-2025.json", 2024: "wykonanie-2024.json", 2023: "wykonanie-2023.json", 2022: "wykonanie-2022.json", 2021: "wykonanie-2021.json", 2020: "wykonanie-2020.json", 2019: "wykonanie-2019.json", 2018: "wykonanie-2018.json", 2017: "wykonanie-2017.json", 2016: "wykonanie-2016.json", 2015: "wykonanie-2015.json", 2014: "wykonanie-2014.json", 2013: "wykonanie-2013.json" };
  var WYK_CACHE = {};
  // the "Plan vs wykonanie" tab only exists for years that have execution data
  function updateExecTab() {
    var btn = document.getElementById("tab-exec");
    if (btn) btn.style.display = WYK_FILES[YEAR] ? "" : "none";
  }
  function loadExec(cb) {
    var file = WYK_FILES[YEAR];
    if (!file) { cb(null); return; }
    if (WYK_CACHE[YEAR]) { cb(WYK_CACHE[YEAR]); return; }
    fetch(file).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) { WYK_CACHE[YEAR] = json; cb(json); })
      .catch(function (err) { console.error(err); cb(null); });
  }
  function execPct(wyk, plan) { return plan > 0 ? wyk / plan * 100 : null; }
  function drawExec() {
    var st = document.getElementById("exec-state"), body = document.getElementById("exec-body"), notice = document.getElementById("exec-notice");
    if (st) st.style.display = "none";
    if (!WYK_FILES[YEAR]) { if (body) body.hidden = true; if (notice) notice.hidden = false; return; }
    if (notice) notice.hidden = true;
    loadExec(function (W) {
      if (!W) { if (notice) { notice.hidden = false; notice.textContent = "Nie udało się wczytać danych o wykonaniu."; } if (body) body.hidden = true; return; }
      if (body) body.hidden = false;
      drawExecSummary(W); drawExecKPIs(W); drawExecBars(W); drawExecDochody(W); drawExecList(W); drawExecOdchylenia(W);
    });
  }
  // deviation helpers
  function execDev(plan, wyk) { return { diff: wyk - plan, pct: plan ? (wyk / plan - 1) * 100 : null }; }
  function absPct(p) { return Math.abs(p).toFixed(1).replace(".", ","); }
  function signMoney(diff) { return (diff >= 0 ? "+" : "−") + money(Math.abs(diff)); }
  function drawExecSummary(W) {
    var el = document.getElementById("exec-summary"); if (!el) return;
    var m = DATA.meta, w = W.wykonanie;
    var dd = execDev(m.dochody, w.dochody), dw = execDev(m.wydatki, w.wydatki), df = execDev(m.deficyt, w.deficyt);
    function mw(p) { return p < 0 ? "mniej" : "więcej"; }
    var defClause = (df.pct == null)
      ? "W efekcie pojawił się deficyt " + money(w.deficyt) + ", choć ustawa zakładała budżet zrównoważony (plan 0)."
      : "W efekcie deficyt był o " + money(Math.abs(df.diff)) + " (" + absPct(df.pct) + "%) <strong>" + (df.diff < 0 ? "niższy" : "wyższy") + "</strong> od planu.";
    el.innerHTML = "W " + (m.rok || YEAR) + " r. do budżetu wpłynęło o <strong>" + absPct(dd.pct) + "% " + mw(dd.pct) + "</strong>, niż zaplanowano (" + signMoney(dd.diff) +
      "), a wydano o <strong>" + absPct(dw.pct) + "% " + mw(dw.pct) + "</strong> (" + signMoney(dw.diff) + "). " + defClause;
  }
  function drawExecKPIs(W) {
    var m = DATA.meta;
    var cards = [
      { label: "Wydatki", plan: m.wydatki, wyk: W.wykonanie.wydatki, danger: false },
      { label: "Dochody", plan: m.dochody, wyk: W.wykonanie.dochody, danger: false },
      { label: "Deficyt", plan: m.deficyt, wyk: W.wykonanie.deficyt, danger: true }
    ];
    var host = document.getElementById("exec-kpis"); if (!host) return;
    host.innerHTML = cards.map(function (c, i) {
      var dv = execDev(c.plan, c.wyk);
      // deficyt lower than plan = good news → green; revenue/spend deviations stay neutral
      var dCls = (c.label === "Deficyt") ? (dv.diff < 0 ? " is-good" : " is-bad") : "";
      var delta = signMoney(dv.diff) + " · " + (dv.pct == null ? "—" : (dv.pct >= 0 ? "+" : "−") + absPct(dv.pct) + "%") + " vs plan";
      return '<div class="stat anim-in" style="--anim-delay:' + (i * 50) + 'ms"><p class="stat-label">' + c.label + ' (wykonanie)</p>' +
        '<p class="stat-value' + (c.danger ? " is-danger" : "") + '" data-ek="' + i + '"></p>' +
        '<p class="stat-foot">plan ' + money(c.plan) + '</p>' +
        '<p class="exec-delta' + dCls + '">' + delta + "</p></div>";
    }).join("");
    cards.forEach(function (c, i) {
      var el = host.querySelector('.stat-value[data-ek="' + i + '"]');
      var key = "__ek" + i, from = prevStatVals[key]; if (from == null) from = 0;
      var fmt = statMoneyFmt(c.wyk);
      tweenValue(from, c.wyk, 900, function (v) { var r = fmt(v); el.innerHTML = r.num + (r.unit ? '<span class="unit">' + r.unit + "</span>" : ""); });
      prevStatVals[key] = c.wyk;
    });
  }
  function drawExecList(W) {
    var host = document.getElementById("exec-list"); if (!host) return;
    var dz = DATA.dzialy.slice().filter(function (d) { return W.dzialy[d.code] != null; }).sort(function (a, b) { return b.plan - a.plan; });
    host.innerHTML = dz.map(function (d) {
      var wyk = W.dzialy[d.code], pct = execPct(wyk, d.plan);
      var w = Math.max(2, Math.min(pct == null ? 0 : pct, 100));
      var c = CMAP[colorKey(d.name)];
      var cls = pct == null ? "" : (pct >= 99 ? "is-over" : (pct < 85 ? "is-low" : ""));
      return '<div class="taxbar" title="' + escapeHtml(d.name) + ": plan " + money(d.plan) + " → wykonanie " + money(wyk) + '">' +
        '<span class="taxbar-name">' + escapeHtml(d.name) + "</span>" +
        '<span class="taxbar-track"><span class="taxbar-fill grow-in" style="width:' + w.toFixed(1) + "%;background:" + c.fill + ";border:1px solid " + c.line + '"></span></span>' +
        '<span class="taxbar-amt exec-pct ' + cls + '">' + (pct != null ? pct.toFixed(0) + "%" : "—") + "</span></div>";
    }).join("");
  }
  // module 4 — paired plan vs wykonanie bars for the big three
  function drawExecBars(W) {
    var host = document.getElementById("exec-bars"); if (!host) return;
    var m = DATA.meta, w = W.wykonanie;
    var rows = [
      { label: "Wydatki", plan: m.wydatki, wyk: w.wydatki, col: cssVar("var(--accent)") },
      { label: "Dochody", plan: m.dochody, wyk: w.dochody, col: cssVar("var(--c-transfer-line)") },
      { label: "Deficyt", plan: m.deficyt, wyk: w.deficyt, col: cssVar("var(--danger)") }
    ];
    var max = d3.max(rows, function (r) { return Math.max(r.plan, r.wyk); }) || 1;
    host.innerHTML = rows.map(function (r) {
      function bar(val, cls, lab) {
        var pw = Math.max(1, val / max * 100);
        return '<div class="planbar-row"><span class="planbar-track"><span class="planbar-fill ' + cls + '" style="width:' + pw.toFixed(1) + "%;" + (cls === "is-wyk" ? "background:" + r.col : "") + '"></span></span>' +
          '<span class="planbar-val">' + lab + " " + moneyShort(val) + "</span></div>";
      }
      return '<div class="planbar-group"><div class="planbar-label">' + r.label + "</div>" +
        bar(r.plan, "is-plan", "plan") + bar(r.wyk, "is-wyk", "wyk") + "</div>";
    }).join("");
  }
  // module 2 — dochody by source: plan vs wykonanie
  function drawExecDochody(W) {
    var host = document.getElementById("exec-dochody"); if (!host || !W.dochody) return;
    var inneName = "Inne dochody podatkowe i niepodatkowe";
    var known = W.dochody.VAT + W.dochody.Akcyza + W.dochody.CIT + W.dochody.PIT;
    var wykOf = function (name) { return name === inneName ? (W.wykonanie.dochody - known) : W.dochody[name]; };
    var rows = DATA.dochody.slice().filter(function (d) { return wykOf(d.name) != null; }).sort(function (a, b) { return b.plan - a.plan; });
    host.innerHTML = rows.map(function (d) {
      var wyk = wykOf(d.name), pct = execPct(wyk, d.plan);
      var w = Math.max(2, Math.min(pct == null ? 0 : pct, 100));
      var c = CMAP[colorKey(d.name)];
      var cls = pct == null ? "" : (pct >= 99 ? "is-over" : (pct < 85 ? "is-low" : ""));
      return '<div class="taxbar" title="' + escapeHtml(d.name) + ": plan " + money(d.plan) + " → wykonanie " + money(wyk) + '">' +
        '<span class="taxbar-name">' + escapeHtml(d.name) + "</span>" +
        '<span class="taxbar-track"><span class="taxbar-fill grow-in" style="width:' + w.toFixed(1) + "%;background:" + c.fill + ";border:1px solid " + c.line + '"></span></span>' +
        '<span class="taxbar-amt exec-pct ' + cls + '">' + (pct != null ? pct.toFixed(0) + "%" : "—") + "</span></div>";
    }).join("");
  }
  // module 3 — biggest dział deviations (wykonanie − plan)
  function drawExecOdchylenia(W) {
    var host = document.getElementById("exec-odchylenia"); if (!host) return;
    var rows = DATA.dzialy.filter(function (d) { return W.dzialy[d.code] != null; }).map(function (d) {
      var wyk = W.dzialy[d.code];
      return { name: d.name, diff: wyk - d.plan, pct: d.plan ? wyk / d.plan * 100 : null };
    }).filter(function (r) { return Math.abs(r.diff) > 0; });
    var above = rows.filter(function (r) { return r.diff > 0; }).sort(function (a, b) { return b.diff - a.diff; }).slice(0, 5);
    var below = rows.filter(function (r) { return r.diff < 0; }).sort(function (a, b) { return a.diff - b.diff; }).slice(0, 5);
    var maxAbs = d3.max(rows, function (r) { return Math.abs(r.diff); }) || 1;
    function list(title, arr, up) {
      return '<div class="movers-col"><h4 class="movers-h ' + (up ? "is-up" : "is-down") + '">' + title + "</h4>" +
        arr.map(function (r) {
          var w = Math.max(3, Math.abs(r.diff) / maxAbs * 100);
          var c = CMAP[colorKey(r.name)];
          var pct = r.pct == null ? "" : ' <span class="mv-pct">' + r.pct.toFixed(0) + "% planu</span>";
          return '<div class="mv-row"><span class="mv-name">' + escapeHtml(r.name) + "</span>" +
            '<span class="mv-track"><span class="mv-fill" style="width:' + w.toFixed(1) + "%;background:" + c.fill + ";border:1px solid " + c.line + '"></span></span>' +
            '<span class="mv-amt">' + signMoney(r.diff) + pct + "</span></div>";
        }).join("") + "</div>";
    }
    host.innerHTML = list("Najbardziej powyżej planu", above, true) + list("Najbardziej poniżej planu", below, false);
  }

  // ---------- tabs & axis ----------
  function wireTabs() {
    var tabs = [["tab-tree", "panel-tree", "tree"], ["tab-flow", "panel-flow", "flow"], ["tab-type", "panel-type", "type"], ["tab-trends", "panel-trends", "trends"], ["tab-taxes", "panel-taxes", "taxes"], ["tab-exec", "panel-exec", "exec"]];
    tabs.forEach(function (t) {
      document.getElementById(t[0]).addEventListener("click", function () { switchView(t[2]); });
    });
  }
  function switchView(v) {
    if (v !== "tree" && dzialDetail != null) closeDzial(true); // leaving the map closes the dział detail
    view = v;
    var map = { tree: ["tab-tree", "panel-tree"], flow: ["tab-flow", "panel-flow"], type: ["tab-type", "panel-type"], trends: ["tab-trends", "panel-trends"], taxes: ["tab-taxes", "panel-taxes"], exec: ["tab-exec", "panel-exec"] };
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
    if (v === "trends") loadTrends(function () { loadContext(drawTrends); });
    if (v === "taxes") loadContext(function () { wireTaxes(); drawTaxes(); });
    if (v === "exec") drawExec();
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

  function setYear(yr, onDone) {
    if (yr === YEAR) { if (onDone) onDone(); return; }
    // reflect pressed state
    document.querySelectorAll("#year-seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", parseInt(b.getAttribute("data-year"), 10) === yr ? "true" : "false");
    });
    // show/hide the Plan vs wykonanie tab for the new year; leave it if it vanishes
    var execBtn = document.getElementById("tab-exec");
    if (execBtn) execBtn.style.display = WYK_FILES[yr] ? "" : "none";
    if (view === "exec" && !WYK_FILES[yr]) switchView("tree");
    path = [];
    restExpanded = false;

    function apply(json) {
      DATA = json;
      YEAR = yr;
      renderStats();
      // dział detail stays open across a year change — re-render it for the new year's data,
      // or close it if this dział doesn't exist in the new year's classification
      if (dzialDetail != null) {
        if (dzialMeta(dzialDetail)) {
          drawDzialDetail(dzialDetail);
          history.replaceState({ rok: yr, dzial: dzialDetail }, "", "?rok=" + yr + "&dzial=" + dzialDetail);
          if (onDone) onDone();
          return;
        }
        closeDzial(true);
      }
      // trends dashboard is year-independent — just move the year marker, no crossfade
      if (view === "trends") { if (TRENDS) drawTrendCharts(); if (onDone) onDone(); return; }
      if (view === "taxes") { drawTaxes(); if (onDone) onDone(); return; }
      if (view === "exec") { drawExec(); if (onDone) onDone(); return; }
      // re-render whichever year-specific view is active, with a blurred crossfade
      crossfadeRedraw(function () {
        if (view === "tree") drawTree();
        else if (view === "flow") drawSankey();
        else if (view === "type") drawTypes();
      });
      if (onDone) onDone();
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
    if (dzialDetail != null) closeDzial(true); // switching axis closes the dział detail
    axis = a;
    path = [];
    restExpanded = false;
    document.getElementById("axis-dzialy").setAttribute("aria-pressed", a === "dzialy" ? "true" : "false");
    document.getElementById("axis-czesci").setAttribute("aria-pressed", a === "czesci" ? "true" : "false");
    drawTree();
  }

  function onResize() {
    if (dzialDetail != null) return; // detail is a flowing DOM list — CSS handles reflow
    if (view === "tree") drawTree();
    else if (view === "flow") drawSankey();
    else if (view === "type") drawTypes();
    else if (view === "trends" && TRENDS) drawTrendCharts();
    else if (view === "taxes" && DATA) drawTaxes();
    else if (view === "exec" && DATA) drawExec();
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
