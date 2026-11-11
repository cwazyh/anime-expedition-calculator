/*
 * Anime Expedition Calculator - site logic.
 *
 * The JSON files are the single source of truth:
 *   - manifest.json lists every unit / equipment / trait name
 *   - Units/<name> Data/<name>_data.json   -> card stats, obtainable, traits, passives...
 *   - Equipments/<name> Data/<name>_data.json -> buffs, passives, unit bounds (hover tooltip)
 *   - Traits/<name> Data/<name>_data.json  -> trait stats (DPS calculator)
 *   - Logos/<element>.png                  -> element icons
 *
 * DPS for units flagged "calculated" is computed live in the browser by
 * js/calculator.js (same formula as dps_calculator.py) - no precomputed
 * values are shipped, so new units / equipment are picked up automatically.
 */
(function () {
  "use strict";

  /* ============================== PATHS ============================== */
  // encode every path segment (folder names contain spaces, ( ), ')
  function seg(p) {
    return p.split("/").map(encodeURIComponent).join("/");
  }
  function unitJson(name) { return seg("Units/" + name + " Data/" + name + "_data.json"); }
  function unitImg(name)  { return seg("Units/" + name + " Data/" + name + "_image.png"); }
  function equipJson(name){ return seg("Equipments/" + name + " Data/" + name + "_data.json"); }
  function equipImg(name) { return seg("Equipments/" + name + " Data/" + name + "_image.png"); }
  function traitJson(name){ return seg("Traits/" + name + " Data/" + name + "_data.json"); }
  function traitImg(name) { return seg("Traits/" + name + " Data/" + name + "_image.png"); }
  function elementImg(el) { return seg("Logos/" + String(el).toLowerCase() + ".png"); }

  // card trait names are generic (Speed / Range / Precision / Strength);
  // they display the rank-2 icon, like the original icon map did
  var TRAIT_ALIAS = {
    "Speed": "Speed 2", "Range": "Range 2",
    "Precision": "Precision 2", "Strength": "Strength 2"
  };
  function traitFile(name) { return TRAIT_ALIAS[name] || name; }

  /* ============================== STATE ============================== */
  var manifest = null;
  var units = [];                 // enriched unit JSONs
  var traitData = {};             // trait name -> JSON
  var equipData = {};             // equipment name -> JSON
  var calcCache = {};             // unit name -> { calc, table, best }
  var cardEls = {};               // unit name -> card element (for live patches)
  var prefetchPromise = null;
  var currentDetail = null;

  /* ============================== HELPERS ============================== */
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // "en-US" formatting (English site).
  // Display rule: what the user sees is always rounded half-up -
  // DPS/TDPS to a whole number, every other value to max 1 decimal
  // (8.3 ok, 8.3271 never). The formulas keep full precision.
  function fmt(n) {
    if (n === null || n === undefined) return "—";
    return (Math.round(Number(n) * 10) / 10).toLocaleString("en-US");
  }
  function fmtDps(n) {
    if (n === null || n === undefined) return "—";
    return Math.round(Number(n)).toLocaleString("en-US");
  }
  function yen(n) {
    return (n === null || n === undefined) ? "—" : "¥" + fmt(n);
  }

  // game tokens like $Aizen_Skill1 -> "Aizen Skill1"
  function cleanText(s) {
    return String(s == null ? "" : s).replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, function (_, n) {
      return n.replace(/_/g, " ");
    });
  }

  function num(v, dec) {
    var n = Number(v);
    var s = n.toFixed(dec || 0);
    if (dec > 0 && s.indexOf(".") !== -1) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  // "Increase Damage by {1}%..." with effect ranges -> "0.5-1%"
  function fillPlaceholders(desc, effects) {
    var out = String(desc == null ? "" : desc);
    (effects || []).forEach(function (e) {
      var token = "{" + e.placeholder + "}";
      var min = num(e.min, e.decimals), max = num(e.max, e.decimals);
      var val = (Number(e.min) === Number(e.max)) ? max : min + "–" + max;
      out = out.split(token).join(val);
    });
    return out;
  }

  var STAT_LABELS = {
    CritChance: "Crit Chance", CritDamage: "Crit Damage",
    Damage: "Damage", SPA: "SPA", Range: "Range",
    DoTDamage: "DoT Damage", ExpIncrease: "Exp Increase",
    Farm: "Farm Income", Cost: "Cost", PlacementLimit: "Placement Limit"
  };
  function prettyStat(k) { return STAT_LABELS[k] || k; }
  function buffRange(b) {
    var min = Number(b.min), max = Number(b.max);
    if (min === max) return fmt(max) + "%";
    var lo = fmt(min), hi = fmt(max);
    // "-1--5%" reads badly: with two negative ends drop the extra minus -> "-1-5%"
    if (lo.charAt(0) === "-" && hi.charAt(0) === "-") hi = hi.slice(1);
    return lo + "-" + hi + "%";
  }

  async function fetchJSON(url) {
    var lastErr = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var r = await fetch(url);
        if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // limited-concurrency loader: keeps the page responsive with many small JSONs
  function loadPool(names, loader, concurrency) {
    concurrency = concurrency || 12;
    return new Promise(function (resolve) {
      var results = new Array(names.length);
      var idx = 0, failures = 0;
      function worker() {
        return new Promise(function (done) {
          (function step() {
            if (idx >= names.length) return done();
            var i = idx++;
            Promise.resolve()
              .then(function () { return loader(names[i]); })
              .then(function (v) { results[i] = v; })
              .catch(function (e) { failures++; console.error("load failed:", names[i], e); })
              .then(step);
          })();
        });
      }
      var workers = [];
      for (var i = 0; i < Math.min(concurrency, names.length); i++) workers.push(worker());
      Promise.all(workers).then(function () { resolve({ results: results, failures: failures }); });
    });
  }

  function scheduleIdle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 50);
  }

  /* ====================== CARD DATA RESOLUTION ======================
   * Calculated units: live calculator output (best trait / best combo / DPS).
   * Everyone else:    static values from the unit JSON.
   */
  function resolveCardData(u) {
    var c = calcCache[u.unit_name];
    if (u.calculated && c) {
      return {
        tdps: c.best.res.dps,
        traits: c.table.slice(0, 2).map(function (r) { return r.trait; }),
        equips: c.calc.info.bound.concat(c.best.combo).map(function (n) { return { name: n }; })
      };
    }
    return {
      tdps: u.tdps,
      traits: u.traits || [],
      equips: (u.equipment || []).map(function (n) { return { name: n }; })
    };
  }

  // deploy/cost: JSON value first; for non-placeholder units derived from upgrades
  function deployOf(u) {
    if (u.deploy !== null && u.deploy !== undefined) return u.deploy;
    if (!u.placeholder && u.upgrades && u.upgrades.length) return u.upgrades[0].cost;
    return null;
  }
  function costOf(u) {
    if (u.cost !== null && u.cost !== undefined) return u.cost;
    if (!u.placeholder && u.upgrades && u.upgrades.length > 1) {
      return u.upgrades.slice(1).reduce(function (s, x) { return s + (x.cost || 0); }, 0);
    }
    return null;
  }

  /* ============================== RENDER ============================== */
  function statsHTML(u, cd) {
    return (
      '<div class="card-stat"><span class="card-stat-value">' + fmtDps(cd.tdps) +
      '</span><span class="card-stat-label">TDPS</span></div>' +
      '<div class="card-stat"><span class="card-stat-value yen">' + yen(deployOf(u)) +
      '</span><span class="card-stat-label">Deploy</span></div>' +
      '<div class="card-stat"><span class="card-stat-value yen">' + yen(costOf(u)) +
      '</span><span class="card-stat-label">Max UPG</span></div>'
    );
  }

  function traitsHTML(cd) {
    return cd.traits.map(function (t, i) {
      return '<span class="trait-wrap" data-trait="' + esc(t) + '"><div class="trait-icon">' +
        '<img src="' + traitImg(traitFile(t)) + '" alt="' + esc(t) +
        '" loading="lazy" decoding="async" onerror="this.style.display=\'none\'">' +
        '</div><span class="trait-rank rank-' + (i + 1) + '">#' + (i + 1) + '</span></span>';
    }).join("");
  }

  function equipsHTML(cd) {
    return cd.equips.map(function (e) {
      return '<div class="equip-slot" data-equip="' + esc(e.name) + '">' +
        '<img src="' + equipImg(e.name) + '" alt="' + esc(e.name) +
        '" loading="lazy" decoding="async" onerror="this.style.display=\'none\'">' +
        '<span class="equip-name">' + esc(e.name) + '</span></div>';
    }).join("");
  }

  function obtainHTML(u) {
    var o = u.obtainable;
    var cls = (o === null || o === undefined) ? "ph" : (o ? "yes" : "no");
    var txt = (o === null || o === undefined) ? "TBD" : (o ? "Obtainable" : "Unobtainable");
    return '<span class="obtain-dot ' + cls + '"></span>' + txt;
  }

  function cardHTML(u) {
    var cd = resolveCardData(u);
    var rarity = String(u.rarity).toLowerCase();
    return (
      '<div class="ebox-gradient c-' + rarity + '">' +
        (u.placeholder ? '<div class="ebox-amount">placeholder</div>' : '') +
        '<div class="ebox-img"><img src="' + unitImg(u.unit_name) + '" alt="' + esc(u.unit_name) +
        '" loading="lazy" decoding="async" onerror="this.style.opacity=0.15"></div>' +
      '</div>' +
      '<div class="ebox-title">' + esc(u.unit_name) + '</div>' +
      '<div class="rarity-chip c-' + rarity + '">' + esc(rarity) + '</div>' +
      '<div class="card-stats">' + statsHTML(u, cd) + '</div>' +
      '<div class="card-traits">' + traitsHTML(cd) + '</div>' +
      '<div class="card-equips">' + equipsHTML(cd) + '</div>' +
      '<div class="obtain-tag">' + obtainHTML(u) + '</div>'
    );
  }

  function renderUnits(list) {
    var grid = $("unitsGrid");
    var empty = $("emptyState");
    // never leave an equipment tooltip pointing at a destroyed slot
    if (tipSlot && grid.contains(tipSlot)) hideTip();
    grid.innerHTML = "";
    cardEls = {};

    if (list.length === 0) {
      empty.classList.add("show");
      return;
    }
    empty.classList.remove("show");

    var frag = document.createDocumentFragment();
    list.forEach(function (u) {
      var card = document.createElement("div");
      card.className = "unit-card";
      card.innerHTML = cardHTML(u);
      card.addEventListener("click", function (ev) {
        if (ev.target.closest(".equip-slot")) return;   // clicks on slots only hover
        openDetail(u);
      });
      cardEls[u.unit_name] = card;
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  // update one card in place after its live calculation becomes available
  function patchCard(u) {
    var card = cardEls[u.unit_name];
    if (!card) return;
    var cd = resolveCardData(u);
    card.querySelector(".card-stats").innerHTML = statsHTML(u, cd);
    card.querySelector(".card-traits").innerHTML = traitsHTML(cd);
    card.querySelector(".card-equips").innerHTML = equipsHTML(cd);
  }

  /* ====================== EQUIPMENT HOVER TOOLTIP ======================
   * Shows the full details: stat ranges (e.g. "Damage 1-15%") and the
   * complete passive descriptions. It appears BELOW the equipment image and
   * flips above it when the viewport would cut it off; it repositions on
   * scroll instead of disappearing.
   */
  var tipSlot = null;
  var tipToken = 0;

  function tipEl() { return $("equipPopup"); }

  function tipTags(eq) {
    if (eq.for_unit) return '<span class="ep-tag bound">Bound to ' + esc(eq.for_unit) + "</span>";
    if (eq.general_use) return '<span class="ep-tag">General</span>';
    return "";
  }

  function passiveHTML(p) {
    var desc = cleanText(fillPlaceholders(p.description, p.effects));
    return '<div class="ep-passive"><div class="ep-pname">' +
      esc(p.display_name || p.name || "") + '</div><div class="ep-pdesc">' +
      esc(desc) + "</div></div>";
  }

  function tipHTML(name, eq) {
    var html = '<div class="ep-head"><img src="' + equipImg(name) +
      '" alt="" onerror="this.style.display=\'none\'"><div><div class="ep-name">' +
      esc(name) + '</div><div class="ep-tags">' + tipTags(eq) + "</div></div></div>";

    var buffs = eq.buffs || {};
    var bkeys = Object.keys(buffs);
    if (bkeys.length) {
      html += '<div class="ep-buffs">' + bkeys.map(function (k) {
        return '<div class="ep-buff"><span>' + esc(prettyStat(k)) + "</span><b>" +
          buffRange(buffs[k]) + "</b></div>";
      }).join("") + "</div>";
    }
    var passives = eq.passives || [];
    if (passives.length) {
      html += '<div class="ep-sec"><div class="ep-sec-title">Passives</div>' +
        passives.map(passiveHTML).join("") + "</div>";
    }
    var abilities = eq.abilities || [];
    if (abilities.length) {
      html += '<div class="ep-sec"><div class="ep-sec-title">Abilities</div>' +
        abilities.map(passiveHTML).join("") + "</div>";
    }
    return html;
  }

  function tipLoadingHTML(name) {
    return '<div class="ep-head"><img src="' + equipImg(name) +
      '" alt="" onerror="this.style.display=\'none\'"><div><div class="ep-name">' +
      esc(name) + '</div></div></div><div class="ep-loading">Loading details...</div>';
  }

  // same tooltip style as equipment, showing only the trait's full
  // description (it already lists every buff in text form)
  function traitTipHTML(name, t) {
    var html = '<div class="ep-head"><img src="' + traitImg(traitFile(name)) +
      '" alt="" onerror="this.style.display=\'none\'"><div><div class="ep-name">' +
      esc(name) + '</div><div class="ep-tags"><span class="ep-tag">Trait</span>' +
      '</div></div></div>';

    if (t.description) {
      html += '<div class="ep-sec"><div class="ep-sec-title">Description</div>' +
        '<div class="ep-pdesc">' + esc(cleanText(t.description)) + "</div></div>";
    }
    return html;
  }

  function traitTipLoadingHTML(name) {
    return '<div class="ep-head"><img src="' + traitImg(traitFile(name)) +
      '" alt="" onerror="this.style.display=\'none\'"><div><div class="ep-name">' +
      esc(name) + '</div></div></div><div class="ep-loading">Loading details...</div>';
  }

  function placeTip(slot, tip) {
    var r = slot.getBoundingClientRect();
    if (r.bottom < -4 || r.top > window.innerHeight + 4) { hideTip(); return; }
    var w = tip.offsetWidth, h = tip.offsetHeight;

    // prefer below the equipment image...
    var top = r.bottom + 8;
    // ...flip above when the viewport would cut it off
    if (top + h > window.innerHeight - 8) {
      var above = r.top - h - 8;
      top = (above >= 8) ? above : Math.max(8, Math.min(top, window.innerHeight - h - 8));
    }
    var left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));

    tip.style.top = top + "px";
    tip.style.left = left + "px";
  }

  function showTip(slot) {
    var eqName = slot.getAttribute("data-equip");
    var trName = slot.getAttribute("data-trait");
    var name = eqName || trName;
    if (!name) return;
    var tip = tipEl();
    tipSlot = slot;
    var token = ++tipToken;

    function ready() {
      if (eqName) return equipData[name] ? tipHTML(name, equipData[name]) : null;
      var key = traitFile(name);
      return traitData[key] ? traitTipHTML(name, traitData[key]) : null;
    }
    function loading() {
      return eqName ? tipLoadingHTML(name) : traitTipLoadingHTML(name);
    }
    function load() {
      return eqName ? loadEquip(name) : loadTrait(traitFile(name));
    }

    var html = ready();
    tip.innerHTML = html || loading();
    tip.classList.add("show");
    placeTip(slot, tip);

    if (!html) {
      load().then(function () {
        if (token !== tipToken || tipSlot !== slot) return;
        tip.innerHTML = ready() || loading();
        placeTip(slot, tip);
      }).catch(function (e) {
        console.error("tooltip load failed:", name, e);
        if (token !== tipToken || tipSlot !== slot) return;
        var l = tip.querySelector(".ep-loading");
        if (l) l.textContent = "Details unavailable.";
      });
    }
  }

  function hideTip() {
    tipToken++;
    tipSlot = null;
    var tip = tipEl();
    tip.classList.remove("show");
  }

  function repositionTip() {
    if (!tipSlot) return;
    placeTip(tipSlot, tipEl());
  }

  function tipTrigger(el) {
    return el.closest && (el.closest(".equip-slot") || el.closest(".trait-wrap"));
  }

  function bindTooltip() {
    document.addEventListener("mouseover", function (ev) {
      var slot = tipTrigger(ev.target);
      if (!slot || slot === tipSlot) return;
      showTip(slot);
    });
    document.addEventListener("mouseout", function (ev) {
      var slot = tipTrigger(ev.target);
      if (!slot) return;
      if (ev.relatedTarget && slot.contains(ev.relatedTarget)) return;
      hideTip();
    });
    // keep the tooltip attached while the page scrolls (do not hide it)
    window.addEventListener("scroll", repositionTip, { passive: true });
    window.addEventListener("resize", repositionTip);
    $("detailOverlay").addEventListener("scroll", repositionTip, { passive: true });
  }

  function loadEquip(name) {
    if (equipData[name]) return Promise.resolve(equipData[name]);
    return fetchJSON(equipJson(name)).then(function (j) {
      equipData[name] = j;
      return j;
    });
  }

  function loadTrait(name) {
    if (traitData[name]) return Promise.resolve(traitData[name]);
    return fetchJSON(traitJson(name)).then(function (j) {
      traitData[name] = j;
      return j;
    });
  }

  /* ====================== LIVE DPS CALCULATION ====================== */
  function dataReady() {
    if (!prefetchPromise) {
      prefetchPromise = Promise.all([
        loadPool(manifest.equipments, function (n) {
          return fetchJSON(equipJson(n)).then(function (j) { equipData[n] = j; });
        }),
        loadPool(manifest.traits, function (n) {
          return fetchJSON(traitJson(n)).then(function (j) { traitData[n] = j; });
        })
      ]).then(function () {
        computeCalculated();
        buildTraitOptions();   // refresh filter list with computed traits
        // re-sort the grid now that live TDPS is known (Traitor (Illusion)
        // first renders with no TDPS, then must take its place by DPS)
        applyAndRender();
        return true;
      });
    }
    return prefetchPromise;
  }

  function ensureCalc(u) {
    if (calcCache[u.unit_name]) return Promise.resolve(calcCache[u.unit_name]);
    return dataReady().then(function () { return calcCache[u.unit_name]; });
  }

  function computeCalculated() {
    if (!window.AECalc) return;
    units.forEach(function (u) {
      if (!u.calculated || calcCache[u.unit_name]) return;
      try {
        var calc = window.AECalc.createCalculator({
          unit: u, traits: traitData, equipments: equipData
        });
        var table = calc.traitTable();
        if (!table.length) return;
        calcCache[u.unit_name] = { calc: calc, table: table, best: table[0] };
        patchCard(u);
        refreshDetail(u);
      } catch (e) {
        console.error("DPS calculation failed for " + u.unit_name, e);
      }
    });
  }

  /* ============================== DETAIL MODAL ============================== */
  function fillTraits(u) {
    var cd = resolveCardData(u);
    $("detailTraits").innerHTML = cd.traits.length === 0
      ? '<div class="ph-note">Traits TBD</div>'
      : cd.traits.map(function (t, i) {
          return '<div class="detail-trait"><span class="trait-wrap" data-trait="' + esc(t) + '">' +
            '<div class="trait-icon"><img src="' + traitImg(traitFile(t)) + '" alt="' + esc(t) +
            '" onerror="this.style.display=\'none\'"></div>' +
            '<span class="trait-rank rank-' + (i + 1) + '">#' + (i + 1) + '</span></span>' +
            '<span class="tname">' + esc(t) + (i === 0 ? " (Best)" : " (2nd)") + "</span></div>";
        }).join("");
  }

  function fillEquips(u) {
    var cd = resolveCardData(u);
    $("detailEquips").innerHTML = cd.equips.length === 0
      ? '<div class="ph-note">Equipment TBD</div>'
      : equipsHTML(cd);
  }

  function fillPassives(u) {
    var all = (u.passives || []).concat(u.abilities || []);
    $("blkPassives").hidden = all.length === 0;
    $("detailPassives").innerHTML = all.map(function (p) {
      return '<div class="passive-item"><div class="pname">' +
        esc(p.display_name || p.name || "") + '</div><div class="pdesc">' +
        esc(cleanText(fillPlaceholders(p.description, p.effects))) + "</div></div>";
    }).join("");
  }

  function fillSummons(u) {
    var list = u.summons || [];
    $("blkSummons").hidden = list.length === 0;
    $("detailSummons").innerHTML = list.map(function (s) {
      var meta = [s.rarity, s.archetype, s.element].filter(Boolean).join(" · ");
      return '<span class="data-chip" title="' + esc(meta) + '">' +
        esc(s.display_name || s.key) + "</span>";
    }).join("");
  }

  function fillStatus(u) {
    var fx = u.status_effects || {};
    var keys = Object.keys(fx);
    $("blkStatus").hidden = keys.length === 0;
    $("detailStatus").innerHTML = keys.map(function (k) {
      var v = fx[k];
      return '<span class="data-chip" title="' + esc(cleanText(v.description)) + '">' +
        esc(v.display_name || k) + "</span>";
    }).join("");
  }

  function fillDps(u) {
    var box = $("detailDps");
    if (!u.calculated) { $("blkDps").hidden = true; return; }
    $("blkDps").hidden = false;

    var c = calcCache[u.unit_name];
    if (!c) {
      box.innerHTML = '<div class="dps-pending">Calculating live DPS from the loaded data...</div>';
      ensureCalc(u).then(function () {
        if (currentDetail === u.unit_name) refreshDetail(u);
      });
      return;
    }

    var T = c.calc.T;
    var bound = c.calc.info.bound;
    var rows = c.table.map(function (r, i) {
      var combo = bound.concat(r.combo).join(" + ");
      return '<tr class="' + (i === 0 ? "top" : "") + '">' +
        "<td>" + esc(r.trait) + "</td>" +
        '<td class="eq-names">' + esc(combo) + "</td>" +
        '<td class="num">' + fmt(r.res.dmg) + "</td>" +
        '<td class="num">' + fmt(r.res.spa) + "</td>" +
        '<td class="num">' + fmtDps(r.res.dps) + "</td></tr>";
    }).join("");

    box.innerHTML =
      '<div class="dps-note">Calculated live by <b>js/calculator.js</b> from the unit, trait and ' +
      "equipment JSONs: Level " + T.level + " &middot; Ascension " + T.ascension +
      " &middot; Potential Z &middot; equipment rolls MAX (incl. passives) &middot; expected crit &middot; " +
      "hypnosis share 100% &middot; Shinigami Sword 15/15. Combo includes the unit-bound equipment.</div>" +
      '<table class="dps-table"><thead><tr><th>Trait</th><th>Best equipment</th>' +
      "<th>D</th><th>SPA</th><th>DPS</th></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  function refreshDetail(u) {
    if (currentDetail !== u.unit_name) return;
    var cd = resolveCardData(u);
    $("dTdps").textContent = fmtDps(cd.tdps);
    fillTraits(u);
    fillEquips(u);
    fillDps(u);
  }

  function openDetail(u) {
    hideTip();
    currentDetail = u.unit_name;
    var rarity = String(u.rarity).toLowerCase();
    var cd = resolveCardData(u);

    $("detailEbox").innerHTML =
      '<div class="ebox-gradient c-' + rarity + '" style="width:100%">' +
        (u.placeholder ? '<div class="ebox-amount">placeholder</div>' : '') +
        '<div class="ebox-img"><img src="' + unitImg(u.unit_name) + '" alt="' + esc(u.unit_name) + '"></div>' +
      "</div>";

    $("detailRarity").innerHTML = esc(rarity) +
      '<span class="element-chip"><img src="' + elementImg(u.element) + '" alt="" ' +
      'onerror="this.remove()">' + esc(u.element) + "</span>";
    $("detailName").textContent = u.unit_name;
    $("detailDesc").textContent = u.desc || "No description available.";
    $("dTdps").textContent = fmtDps(cd.tdps);
    $("dDeploy").textContent = yen(deployOf(u));
    $("dCost").textContent = yen(costOf(u));

    fillTraits(u);
    fillEquips(u);
    fillPassives(u);
    fillSummons(u);
    fillStatus(u);
    fillDps(u);

    $("detailOverlay").classList.add("open");
  }

  /* ============================== FILTERS ============================== */
  var currentFilters = { trait: "all", rarity: "all", obtain: "all", sort: "tdps", search: "" };

  function buildTraitOptions() {
    var sel = $("fTrait");
    var prev = sel.value;
    var set = {};
    units.forEach(function (u) {
      resolveCardData(u).traits.forEach(function (t) { set[t] = true; });
    });
    var opts = Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
    sel.innerHTML = '<option value="all">All Traits</option>' +
      opts.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + "</option>";
      }).join("");
    if (prev && (prev === "all" || set[prev])) sel.value = prev;
  }

  function applyAndRender() {
    var list = units.filter(function (u) {
      var f = currentFilters;
      var matchTrait = f.trait === "all" || resolveCardData(u).traits.indexOf(f.trait) !== -1;
      var matchRarity = f.rarity === "all" || String(u.rarity).toLowerCase() === f.rarity;
      var matchObtain = f.obtain === "all" ||
        (f.obtain === "obtainable" && u.obtainable === true) ||
        (f.obtain === "unobtainable" && u.obtainable === false);
      var matchSearch = !f.search ||
        u.unit_name.toLowerCase().indexOf(f.search.toLowerCase()) !== -1;
      return matchTrait && matchRarity && matchObtain && matchSearch;
    });

    var s = currentFilters.sort;
    // placeholder units always sort last
    var ph = function (u) { return u.placeholder ? 1 : 0; };
    var tdpsOf = function (u) { var v = resolveCardData(u).tdps; return v == null ? -1 : v; };
    var deployS = function (u) { var v = deployOf(u); return v == null ? Infinity : v; };
    var costS = function (u) { var v = costOf(u); return v == null ? Infinity : v; };

    list.sort(function (a, b) {
      if (ph(a) !== ph(b)) return ph(a) - ph(b);
      if (s === "tdps") return tdpsOf(b) - tdpsOf(a);
      if (s === "deploy") return deployS(a) - deployS(b);
      if (s === "cost") return costS(a) - costS(b);
      if (s === "name") return a.unit_name.localeCompare(b.unit_name);
      return 0;
    });

    renderUnits(list);
    $("unitCount").textContent = list.length + " units shown";
  }

  function bindFilters() {
    var overlay = $("filterOverlay");
    $("openFilter").addEventListener("click", function () {
      hideTip();
      overlay.classList.add("open");
      $("openFilter").classList.add("active");
    });
    function close() {
      overlay.classList.remove("open");
      $("openFilter").classList.remove("active");
    }
    $("closeFilter").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });

    $("applyFilter").addEventListener("click", function () {
      currentFilters.trait = $("fTrait").value;
      currentFilters.rarity = $("fRarity").value;
      currentFilters.obtain = $("fObtain").value;
      currentFilters.sort = $("fSort").value;
      close();
      applyAndRender();
      showToast("Filters applied");
    });

    $("resetFilter").addEventListener("click", function () {
      $("fTrait").value = "all";
      $("fRarity").value = "all";
      $("fObtain").value = "all";
      $("fSort").value = "tdps";
      currentFilters = { trait: "all", rarity: "all", obtain: "all", sort: "tdps", search: currentFilters.search };
      applyAndRender();
      showToast("Filters reset");
    });

    // search (debounced for fluidity)
    var searchTimer = null;
    $("searchInput").addEventListener("input", function (e) {
      var val = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        currentFilters.search = val;
        applyAndRender();
      }, 120);
    });
  }

  /* ============================== TOAST ============================== */
  function showToast(msg) {
    var c = $("toastContainer");
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () {
      t.style.transition = "opacity 0.4s";
      t.style.opacity = "0";
      setTimeout(function () { t.remove(); }, 450);
    }, 2600);
  }

  /* ============================== INIT ============================== */
  async function boot() {
    try {
      manifest = await fetchJSON("manifest.json");
      var loaded = await loadPool(manifest.units, function (n) { return fetchJSON(unitJson(n)); });
      units = loaded.results.filter(Boolean);
      if (!units.length) throw new Error("no unit data loaded");

      buildTraitOptions();
      applyAndRender();
      $("loadingState").classList.add("hide");
      setTimeout(function () { showToast("Database loaded: " + units.length + " units"); }, 500);

      // background: equipment + trait JSONs (tooltips, calculator), then live DPS
      scheduleIdle(dataReady);
    } catch (e) {
      console.error(e);
      $("loadingState").textContent =
        "Failed to load the database. This page must be served over HTTP " +
        "(GitHub Pages or a local server), not opened as a file.";
    }
  }

  function init() {
    bindTooltip();
    bindFilters();

    $("detailClose").addEventListener("click", function () {
      $("detailOverlay").classList.remove("open");
      currentDetail = null;
      hideTip();
    });
    $("detailOverlay").addEventListener("click", function (e) {
      if (e.target.id === "detailOverlay") {
        e.currentTarget.classList.remove("open");
        currentDetail = null;
        hideTip();
      }
    });

    boot();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
