/* Budżet Polski 2026 — Terra Cracovianum
   Vanilla JS + D3 v7. No build step. */

(function () {
  "use strict";

  var DATA = null;
  var axis = "dzialy";        // "dzialy" | "czesci"
  var view = "tree";          // "tree" | "flow" | "type"
  var path = [];              // drill-down stack of node objects

  var fmtPL = new Intl.NumberFormat("pl-PL");
  var tooltip = document.getElementById("tooltip");

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
      renderStats();
      buildLegend();
      drawTree();
      wireTabs();
      wireAxis();
      window.addEventListener("resize", debounce(onResize, 150));
    })
    .catch(function (err) {
      var s = document.getElementById("tree-state");
      if (s) s.innerHTML = '<i class="ti ti-alert-triangle"></i> Nie udało się wczytać danych budżetu. Odśwież stronę lub spróbuj ponownie później.';
      console.error(err);
    });

  // ---------- stats band ----------
  function renderStats() {
    var m = DATA.meta;
    var cards = [
      { label: "Wydatki", value: money(m.wydatki), foot: "Plan na 2026 r.", danger: false },
      { label: "Dochody", value: money(m.dochody), foot: "Wpływy podatkowe i niepodatkowe", danger: false },
      { label: "Deficyt", value: money(m.deficyt), foot: "Wydatki minus dochody", danger: true },
      { label: "Dług / PKB", value: m.dlug_pkb_proc.toLocaleString("pl-PL", { minimumFractionDigits: 1 }) + "%", foot: "Próg ostrożnościowy: 55%", danger: false }
    ];
    var html = cards.map(function (c) {
      var parts = c.value.split(" ");
      var num = parts.shift();
      var unit = parts.join(" ");
      return '<div class="stat">' +
        '<p class="stat-label">' + c.label + '</p>' +
        '<p class="stat-value' + (c.danger ? " is-danger" : "") + '">' + num +
        (unit ? '<span class="unit">' + unit + '</span>' : '') + '</p>' +
        '<p class="stat-foot">' + c.foot + '</p></div>';
    }).join("");
    document.getElementById("stats").innerHTML = html;
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

  // ---------- treemap ----------
  function drawTree() {
    var state = document.getElementById("tree-state");
    if (state) state.style.display = "none";

    renderCrumbs();

    var nodes = currentNodes().filter(function (n) { return n.value > 0; });
    nodes.sort(function (a, b) { return b.value - a.value; });

    var wrap = document.getElementById("treemap-wrap");
    var W = wrap.clientWidth || 1000;
    var H = Math.max(440, Math.min(620, W * 0.62));

    var root = d3.hierarchy({ children: nodes }).sum(function (d) { return d.value; });
    d3.treemap().size([W, H]).paddingInner(4).round(true)(root);

    var svg = d3.select("#treemap").attr("viewBox", "0 0 " + W + " " + H).attr("width", "100%").attr("height", H);
    svg.selectAll("*").remove();

    var total = d3.sum(nodes, function (d) { return d.value; });

    var g = svg.selectAll("g.tile").data(root.leaves()).enter()
      .append("g").attr("class", "tile")
      .attr("transform", function (d) { return "translate(" + d.x0 + "," + d.y0 + ")"; })
      .style("opacity", 0);

    g.transition().duration(prefersReduced() ? 0 : 350).style("opacity", 1);

    g.append("rect")
      .attr("width", function (d) { return Math.max(0, d.x1 - d.x0); })
      .attr("height", function (d) { return Math.max(0, d.y1 - d.y0); })
      .attr("rx", 6)
      .attr("fill", function (d) { return cssVar(CMAP[colorKey(d.data.name)].fill); })
      .attr("stroke", function (d) { return cssVar(CMAP[colorKey(d.data.name)].line); })
      .attr("stroke-width", 1);

    // labels (only if box big enough)
    g.each(function (d) {
      var w = d.x1 - d.x0, h = d.y1 - d.y0;
      var sel = d3.select(this);
      var ink = cssVar(CMAP[colorKey(d.data.name)].ink);
      if (w < 54 || h < 30) return;
      var pad = 9;
      var name = d.data.name;
      var maxChars = Math.floor((w - pad * 2) / 7);
      var lines = wrapText(name, maxChars, h > 78 ? 3 : (h > 52 ? 2 : 1));
      var ty = pad + 13;
      lines.forEach(function (ln) {
        sel.append("text").attr("class", "tile-label").attr("x", pad).attr("y", ty)
          .attr("fill", ink).text(ln);
        ty += 15;
      });
      if (h > 46) {
        sel.append("text").attr("class", "tile-value").attr("x", pad).attr("y", h - 10)
          .attr("fill", ink).text(moneyShort(d.data.value));
        if (w > 96 && h > 64) {
          sel.append("text").attr("class", "tile-sub").attr("x", pad).attr("y", h - 26)
            .attr("fill", ink).attr("opacity", 0.7)
            .text((d.data.value / total * 100).toFixed(1).replace(".", ",") + "%");
        }
      }
    });

    // interactions
    g.on("mousemove", function (ev, d) { showTip(ev, d.data, total); })
      .on("mouseleave", hideTip)
      .on("click", function (ev, d) { onTileClick(d.data); })
      .style("cursor", function (d) { return canDrill(d.data) ? "pointer" : "default"; })
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", function (d) {
        return d.data.name + ", " + money(d.data.value) + (canDrill(d.data) ? ", kliknij aby wejść w szczegóły" : "");
      })
      .on("keydown", function (ev, d) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onTileClick(d.data); }
      });
  }

  function canDrill(d) {
    // drilling available only on części axis (część -> dział -> rozdział)
    return axis === "czesci" && d.hasChildren;
  }

  function onTileClick(d) {
    if (!canDrill(d)) return;
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

  // ---------- sankey ----------
  function drawSankey() {
    var wrap = document.getElementById("sankey-wrap");
    var W = wrap.clientWidth || 1000;
    var H = Math.max(460, Math.min(640, W * 0.6));
    var svg = d3.select("#sankey").attr("viewBox", "0 0 " + W + " " + H).attr("width", "100%").attr("height", H);
    svg.selectAll("*").remove();

    // Build nodes: revenue sources -> "Budżet" hub -> top expenditure działy (+ deficit)
    var topN = 9;
    var dz = DATA.dzialy.slice().sort(function (a, b) { return b.plan - a.plan; });
    var top = dz.slice(0, topN);
    var rest = dz.slice(topN);
    var restSum = d3.sum(rest, function (d) { return d.plan; });

    var nodes = [];
    var nodeIndex = {};
    function addNode(name, kind) {
      if (nodeIndex[name] != null) return nodeIndex[name];
      nodeIndex[name] = nodes.length;
      nodes.push({ name: name, kind: kind });
      return nodeIndex[name];
    }

    var HUB = "Budżet państwa";
    addNode(HUB, "hub");
    DATA.dochody.forEach(function (r) { addNode(r.name, "rev"); });
    addNode("Deficyt (dług)", "rev");
    top.forEach(function (d) { addNode(d.name, "exp"); });
    if (restSum > 0) addNode("Pozostałe działy", "exp");

    var links = [];
    DATA.dochody.forEach(function (r) { links.push({ source: nodeIndex[r.name], target: nodeIndex[HUB], value: r.plan }); });
    links.push({ source: nodeIndex["Deficyt (dług)"], target: nodeIndex[HUB], value: DATA.meta.deficyt });
    top.forEach(function (d) { links.push({ source: nodeIndex[HUB], target: nodeIndex[d.name], value: d.plan }); });
    if (restSum > 0) links.push({ source: nodeIndex[HUB], target: nodeIndex["Pozostałe działy"], value: restSum });

    var sankey = d3.sankey()
      .nodeWidth(14).nodePadding(13)
      .extent([[4, 10], [W - 4, H - 10]]);
    var graph = sankey({
      nodes: nodes.map(function (d) { return Object.assign({}, d); }),
      links: links.map(function (d) { return Object.assign({}, d); })
    });

    function nodeColor(n) {
      if (n.kind === "hub") return cssVar("var(--accent)");
      if (n.name === "Deficyt (dług)") return cssVar("var(--danger)");
      if (n.kind === "rev") return cssVar("var(--c-transfer-line)");
      return cssVar(CMAP[colorKey(n.name)].line);
    }

    // links
    svg.append("g").attr("fill", "none")
      .selectAll("path").data(graph.links).enter().append("path")
      .attr("class", "slink")
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke", function (d) {
        return d.source.name === "Deficyt (dług)" ? cssVar("var(--danger)") : nodeColor(d.target.kind === "exp" ? d.target : d.source);
      })
      .attr("stroke-opacity", 0.3)
      .attr("stroke-width", function (d) { return Math.max(1, d.width); })
      .append("title").text(function (d) { return d.source.name + " → " + d.target.name + "\n" + money(d.value); });

    // nodes
    var node = svg.append("g").selectAll("g").data(graph.nodes).enter().append("g").attr("class", "snode");
    node.append("rect")
      .attr("x", function (d) { return d.x0; }).attr("y", function (d) { return d.y0; })
      .attr("width", function (d) { return d.x1 - d.x0; })
      .attr("height", function (d) { return Math.max(1, d.y1 - d.y0); })
      .attr("fill", nodeColor).attr("rx", 2)
      .append("title").text(function (d) { return d.name + "\n" + money(d.value); });

    node.append("text")
      .attr("class", "slabel")
      .attr("x", function (d) { return d.x0 < W / 2 ? d.x1 + 7 : d.x0 - 7; })
      .attr("y", function (d) { return (d.y0 + d.y1) / 2; })
      .attr("dy", "0.32em")
      .attr("text-anchor", function (d) { return d.x0 < W / 2 ? "start" : "end"; })
      .attr("fill", cssVar("var(--ink)"))
      .text(function (d) { return d.name; })
      .each(function (d) {
        // append value on a second line
        var t = d3.select(this);
        t.append("tspan").attr("class", "svalue")
          .attr("x", d.x0 < W / 2 ? d.x1 + 7 : d.x0 - 7)
          .attr("dy", "1.25em")
          .attr("text-anchor", d.x0 < W / 2 ? "start" : "end")
          .attr("fill", cssVar("var(--ink-faint)"))
          .text(moneyShort(d.value));
      });
  }

  // ---------- type breakdown ----------
  // Type composition from the law's columns. Aggregated to national shares.
  function drawTypes() {
    // National type split (tys. zł) — from annex 2 "Ogółem" row:
    var types = [
      { name: "Świadczenia dla osób fizycznych", key: "social", value: 162486885 },
      { name: "Wydatki bieżące jednostek", key: "admin", value: 185554371 },
      { name: "Dotacje i subwencje", key: "transfer", value: 351210029 },
      { name: "Wydatki majątkowe (inwestycje)", key: "infra", value: 73027267 },
      { name: "Obsługa długu Skarbu Państwa", key: "debt", value: 90000000 },
      { name: "Środki własne UE", key: "edu", value: 41585044 },
      { name: "Współfinansowanie projektów UE", key: "health", value: 15076404 }
    ];
    var total = d3.sum(types, function (t) { return t.value; });
    var max = d3.max(types, function (t) { return t.value; });
    types.sort(function (a, b) { return b.value - a.value; });

    var el = document.getElementById("types");
    el.innerHTML = types.map(function (t) {
      var pct = (t.value / total * 100);
      var w = (t.value / max * 100);
      var c = CMAP[t.key];
      return '<div class="type-row">' +
        '<div class="type-name">' + t.name + '</div>' +
        '<div class="type-bar-track"><div class="type-bar-fill" style="width:' + w.toFixed(1) + '%;background:' + c.fill + ';border:1px solid ' + c.line + '"></div></div>' +
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
      if (isSel) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
    });
    // axis toggle only meaningful for treemap
    document.getElementById("axis-toggle").style.visibility = (v === "tree") ? "visible" : "hidden";
    if (v === "tree") drawTree();
    if (v === "flow") drawSankey();
    if (v === "type") drawTypes();
  }

  function wireAxis() {
    document.getElementById("axis-dzialy").addEventListener("click", function () { setAxis("dzialy"); });
    document.getElementById("axis-czesci").addEventListener("click", function () { setAxis("czesci"); });
  }
  function setAxis(a) {
    if (axis === a) return;
    axis = a;
    path = [];
    document.getElementById("axis-dzialy").setAttribute("aria-pressed", a === "dzialy" ? "true" : "false");
    document.getElementById("axis-czesci").setAttribute("aria-pressed", a === "czesci" ? "true" : "false");
    drawTree();
  }

  function onResize() {
    if (view === "tree") drawTree();
    else if (view === "flow") drawSankey();
  }

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
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); var a = arguments, c = this; t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

})();
