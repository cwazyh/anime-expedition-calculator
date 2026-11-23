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

  /* ====================== RARITY / AURA COLORS ======================
   * "rarity" comes from the game data shipped in each equipment/trait JSON
   * (Shared.Information.Equipment / Traits). The aura accents are the traits
   * that own an in-game aura (ReplicatedStorage.Assets.TraitAuras).
   */
  function eqRarity(name) {
    var e = equipData[name];
    return e && e.rarity ? String(e.rarity).toLowerCase() : "";
  }
  function eqSlotCls(name) {
    var r = eqRarity(name);
    return r ? " eq-" + r : "";
  }
  function traitRarity(name) {
    var t = traitData[traitFile(name)];
    return t && t.rarity ? String(t.rarity).toLowerCase() : "";
  }
  var TRAIT_AURAS = {
    "Primordial": "primordial", "Forsaken": "forsaken", "Unbound": "unbound",
    "Limit Breaker": "limitbreaker", "Draconic": "draconic", "Optics": "optics",
    "Investor": "investor", "Bolt": "bolt"
  };
  function traitAura(name) { return TRAIT_AURAS[traitFile(name)] || ""; }

  function traitIconCls(name) {
    var r = traitRarity(name), a = traitAura(name);
    return "trait-icon" + (r ? " tr-" + r : "") + (a ? " tr-aura-" + a : "");
  }

  // accent color of a trait's name (aura color first, then rarity tier)
  var TRAIT_AURA_HEX = {
    primordial: "#76cbe0", forsaken: "#ad60e0", unbound: "#a1caff",
    limitbreaker: "#b0393b", draconic: "#ce7d31", optics: "#5d90ff",
    investor: "#dac471", bolt: "#46adfd"
  };
  var TRAIT_RARITY_HEX = { mythic: "#cf9bff", legendary: "#e8c46a", rare: "#9fa4ee" };
  function traitColorHex(name) {
    var a = traitAura(name);
    if (a) return TRAIT_AURA_HEX[a];
    return TRAIT_RARITY_HEX[traitRarity(name)] || "";
  }

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

  /* ------------------------- FARM UNITS -------------------------
   * Ramen Guy and Stone Alchemist (Element = "Farm") generate Yen every
   * wave instead of dealing damage. Their per-level income lives in the
   * upgrade's "farm" field (game data: UpgradeInfo[n].Farm), so the card
   * shows the final Yen/wave and the total cost instead of TDPS, with
   * Economist's Coin as the best equipment (Yen refund per wave).
   */
  function isFarm(u) { return u.element === "Farm"; }

  function farmIncome(u) {
    var ups = u.upgrades || [], best = null;
    for (var i = 0; i < ups.length; i++) {
      if (ups[i].farm !== null && ups[i].farm !== undefined) best = ups[i].farm;
    }
    return best;
  }
  function farmTotalCost(u) {
    var ups = u.upgrades || [], s = 0;
    for (var i = 0; i < ups.length; i++) s += ups[i].cost || 0;
    return s;
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
    if (isFarm(u)) {
      return {
        tdps: farmIncome(u),
        traits: [],
        equips: [{ name: "Economist's Coin" }]
      };
    }
    var c = calcCache[u.unit_name];
    if (u.calculated && c) {
      // the card shows the winning configuration only: ONE unit-bound
      // equipment (the round's bound slot) + its general combo
      var b = c.best.bound ? [c.best.bound] : [];
      return {
        tdps: c.best.res.dps,
        traits: c.table.slice(0, 2).map(function (r) { return r.trait; }),
        equips: b.concat(c.best.combo).map(function (n) { return { name: n }; })
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
    var farm = isFarm(u);
    return (
      '<div class="card-stat"><span class="card-stat-value">' +
      (farm ? yen(cd.tdps) : fmtDps(cd.tdps)) +
      '</span><span class="card-stat-label">' + (farm ? "Yen / wave" : "TDPS") + '</span></div>' +
      '<div class="card-stat"><span class="card-stat-value yen">' + yen(deployOf(u)) +
      '</span><span class="card-stat-label">Deploy</span></div>' +
      '<div class="card-stat"><span class="card-stat-value yen">' +
      (farm ? yen(farmTotalCost(u)) : yen(costOf(u))) +
      '</span><span class="card-stat-label">' + (farm ? "Total Cost" : "Max UPG") + '</span></div>'
    );
  }

  /* Best-trait container: framed icon with its rank badge at the top-right,
   * the trait name below, and the trait selector (a chevron button right
   * next to the name) when the full trait table is known. Same box as an
   * equipment slot, so all containers share one row. Class-based (no ids):
   * the grid renders one container per card, the modal one more. */
  function traitBoxHTML(name, rank, table, selTrait) {
    if (!name) return "";
    var accent = traitColorHex(name);
    var box = '<div class="build-trait"' +
      (accent ? ' style="--tr-c:' + accent + '"' : "") + ">" +
      '<span class="trait-wrap" data-trait="' + esc(name) + '">' +
      '<div class="' + traitIconCls(name) + '"><img src="' + traitImg(traitFile(name)) +
      '" alt="' + esc(name) + '" loading="lazy" decoding="async" onerror="this.style.display=\'none\'">' +
      '</div><span class="trait-rank rank-' + (rank === 1 ? 1 : 2) + '">#' + rank +
      "</span></span>";

    if (!table || !table.length) {
      return box + '<span class="tr-name">' + esc(name) + "</span></div>";
    }

    box += '<div class="tr-pick">' +
      '<span class="tr-name">' + esc(name) + "</span>" +
      '<button type="button" class="tr-dd-btn" aria-haspopup="listbox" ' +
      'aria-expanded="false" aria-label="Change trait">' +
      '<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">' +
      '<path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';

    box += '<div class="tr-dd-menu" role="listbox" hidden>' +
      table.map(function (r, ti) {
        return '<button type="button" class="tr-dd-opt' +
          (r.trait === selTrait ? " sel" : "") + '" data-trait="' + esc(r.trait) +
          '" role="option">#' + (ti + 1) + " " + esc(r.trait) + "</button>";
      }).join("") + "</div>";

    return box + "</div>";
  }

  /* The row a card (or the modal) shows for a unit: the selected trait
   * (st.dpsTrait, snapping to the best row) + that row's winning combo.
   * Static JSON data for farms / not-yet-calculated units. */
  function cardBuild(u) {
    var cd = resolveCardData(u);
    var c = calcCache[u.unit_name];
    if (!isFarm(u) && c && c.table && c.table.length) {
      var st = unitSetting(u.unit_name);
      var row = null, idx = 0;
      for (var i = 0; i < c.table.length; i++) {
        if (c.table[i].trait === st.dpsTrait) { row = c.table[i]; idx = i; break; }
      }
      if (!row) { row = c.table[0]; idx = 0; st.dpsTrait = row.trait; }
      var b = row.bound ? [row.bound] : [];
      return {
        trait: row.trait, rank: idx + 1, table: c.table, sel: row.trait,
        equips: b.concat(row.combo).map(function (n) { return { name: n }; })
      };
    }
    return {
      trait: cd.traits[0] || null, rank: 1, table: null, sel: null,
      equips: cd.equips
    };
  }

  function buildRowHTML(u) {
    var b = cardBuild(u);
    return traitBoxHTML(b.trait, b.rank, b.table, b.sel) + equipsHTML({ equips: b.equips });
  }

  /* trait dropdown: exactly one menu open at a time, anywhere on the page.
   * The host (.unit-card / .detail-modal) gets .tr-open while its menu is
   * up: the card must stack above its siblings (its dropdown overflows the
   * card box) and the modal must stop clipping it at the rounded corner. */
  function setHostOpen(menu, open) {
    var host = menu.closest(".unit-card") || menu.closest(".detail-modal");
    if (host) host.classList.toggle("tr-open", open);
  }
  function closeTraitMenus(except) {
    var ms = document.querySelectorAll(".tr-dd-menu");
    for (var i = 0; i < ms.length; i++) {
      if (ms[i] === except || ms[i].hidden) continue;
      ms[i].hidden = true;
      setHostOpen(ms[i], false);
      var box = ms[i].closest(".build-trait");
      var btn = box && box.querySelector(".tr-dd-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
  }
  function toggleTraitMenu(root) {
    var box = root && root.closest ? root.closest(".build-trait") : null;
    var menu = box && box.querySelector(".tr-dd-menu");
    if (!menu) return;
    var willOpen = menu.hidden;
    closeTraitMenus(willOpen ? menu : null);
    menu.hidden = !willOpen;
    setHostOpen(menu, willOpen);
    var btn = box.querySelector(".tr-dd-btn");
    if (btn) btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }
  // a re-render replaces the menu node, so the host flag must be dropped too
  function clearTraitHosts() {
    var hosts = document.querySelectorAll(".unit-card.tr-open, .detail-modal.tr-open");
    for (var i = 0; i < hosts.length; i++) {
      var m = hosts[i].querySelector(".tr-dd-menu");
      if (!m || m.hidden) hosts[i].classList.remove("tr-open");
    }
  }

  function equipsHTML(cd) {
    return cd.equips.map(function (e) {
      return '<div class="equip-slot' + eqSlotCls(e.name) + '" data-equip="' + esc(e.name) + '">' +
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
      '<div class="card-build">' + buildRowHTML(u) + '</div>' +
      '<div class="obtain-tag">' + obtainHTML(u) + '</div>'
    );
  }

  /* Rarity background effects run only for on-screen cards: the observer
   * toggles .aura-live (CSS keeps the animation paused without it), so a
   * long grid never pays for off-screen animations.
   */
  var auraObserver = null;
  function observeAuras(root) {
    if (!root || !("IntersectionObserver" in window)) return;
    if (!auraObserver) {
      auraObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          entries[i].target.classList.toggle("aura-live", entries[i].isIntersecting);
        }
      }, { rootMargin: "80px" });
    }
    var nodes = root.querySelectorAll(".ebox-gradient");
    for (var i = 0; i < nodes.length; i++) auraObserver.observe(nodes[i]);
  }

  function renderUnits(list) {
    var grid = $("unitsGrid");
    var empty = $("emptyState");
    // never leave an equipment tooltip pointing at a destroyed slot
    if (tipSlot && grid.contains(tipSlot)) hideTip();
    if (auraObserver) auraObserver.disconnect();   // drop refs to removed cards
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
        // trait dropdown inside the card: toggle / pick without opening the modal
        var pick = ev.target.closest ? ev.target.closest(".tr-pick") : null;
        if (pick) { toggleTraitMenu(pick); return; }
        var opt = ev.target.closest ? ev.target.closest(".tr-dd-opt") : null;
        if (opt) {
          unitSetting(u.unit_name).dpsTrait = opt.getAttribute("data-trait");
          patchCard(u);
          if (currentDetail === u.unit_name) refreshDetail(u);
          return;
        }
        if (ev.target.closest(".tr-dd-menu")) return;
        openDetail(u);
      });
      cardEls[u.unit_name] = card;
      frag.appendChild(card);
    });
    grid.appendChild(frag);
    observeAuras(grid);
  }

  // update one card in place after its live calculation becomes available
  function patchCard(u) {
    var card = cardEls[u.unit_name];
    if (!card) return;
    var cd = resolveCardData(u);
    card.querySelector(".card-stats").innerHTML = statsHTML(u, cd);
    card.querySelector(".card-build").innerHTML = buildRowHTML(u);
    clearTraitHosts();
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
    var out = "";
    if (eq.rarity) {
      out += '<span class="ep-tag r-' + String(eq.rarity).toLowerCase() + '">' +
        esc(eq.rarity) + "</span>";
    }
    if (eq.for_unit) out += '<span class="ep-tag bound">Bound to ' + esc(eq.for_unit) + "</span>";
    else if (eq.general_use) out += '<span class="ep-tag">General</span>';
    return out;
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
    var r = t.rarity ? String(t.rarity).toLowerCase() : "";
    var html = '<div class="ep-head"><img src="' + traitImg(traitFile(name)) +
      '" alt="" onerror="this.style.display=\'none\'"><div><div class="ep-name">' +
      esc(name) + '</div><div class="ep-tags">' +
      (r ? '<span class="ep-tag r-' + r + '">' + esc(t.rarity) + "</span>" : "") +
      '<span class="ep-tag">Trait</span></div></div></div>';

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
        // an already open detail modal gains its rarity colors here too
        if (currentDetail) {
          var cu = currentUnit();
          if (cu) { fillPassives(cu); refreshDetail(cu); }   // vars gain live options
        }
        return true;
      });
    }
    return prefetchPromise;
  }

  function ensureCalc(u) {
    if (calcCache[u.unit_name]) return Promise.resolve(calcCache[u.unit_name]);
    return dataReady().then(function () { return calcCache[u.unit_name]; });
  }

  /* ====================== UNIT SETTINGS (VARIABLES PANEL) ======================
   * Per-unit controls rendered in the detail modal's "Variables" block:
   *   - enable/disable each passive (a disabled passive is left out of the
   *     live DPS calculation)
   *   - Hypnotized enemies: default 0 -> the Hypnosis buff is OFF until the
   *     user raises it (it only affects BleachCategory units, i.e. Aizen)
   *   - Enemies in range: default 4, denominator of the hypnosis share
   * "Theoretic max" turns every variable to its cap (share 100%).
   * Placements are NOT a variable (always max placements) and equipment
   * passives stay at MAX (Shinigami Sword 15/15).
   * Settings are SESSION-ONLY: a reload always restores every default
   * (the stale localStorage key from older builds is removed on boot).
   */
  var SETTINGS_KEY = "aec.unitSettings.v1";
  var HYPNOSIS_PASSIVE = "Collapse, Mirror Flower";
  var LEECH_UNIT = "Bioinsect (Final Form)";
  var unitSettings = {};
  var poolLoaded = false;

  // Enemy HP profiles derived from game scaling entries (Game Data/map_profiles.json).
  // basic1 HP drives the mortality model for normal waves; elite/boss are listed
  // for upcoming enemy-type-specific selection.
  var HP_PROFILES = {
    none:            { label: "None (no HP model)", basic1: null },
    easiest_map:     { label: "Easiest map", basic1: 41 },
    average_map:     { label: "Average map", basic1: 476 },
    event_map:       { label: "Event map", basic1: 840 },
    hardest_map:     { label: "Hardest map", basic1: 15897 },
    weekly_tournament: { label: "Weekly tournament", basic1: 11775 }
  };
  var enemyHpProfile = "none";

  function clearLegacySettings() {
    try { window.localStorage.removeItem(SETTINGS_KEY); }
    catch (e) { /* private mode: nothing to clear */ }
  }
  function unitSetting(name) {
    var s = unitSettings[name];
    if (!s || typeof s !== "object") s = unitSettings[name] = {};
    if (!s.passives || typeof s.passives !== "object") s.passives = {};
    if (!s.vars || typeof s.vars !== "object") s.vars = {};
    if (typeof s.hypnotized !== "number") s.hypnotized = 0;
    if (typeof s.enemiesInRange !== "number") s.enemiesInRange = 4;
    return s;
  }
  function clampInt(v, lo, hi, dflt) {
    var s = String(v == null ? "" : v).trim();
    var n = s === "" ? NaN : Math.round(Number(s));   // empty input -> default
    if (!isFinite(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  // share of in-range enemies affected by Hypnosis (0 = buff off)
  function hypShare(u) {
    var s = unitSetting(u.unit_name);
    if (s.passives[HYPNOSIS_PASSIVE] === false) return 0;
    if (s.hypnotized <= 0) return 0;
    return Math.min(1, s.hypnotized / Math.max(1, s.enemiesInRange));
  }
  function hasHypnosis(u) {
    return (u.passives || []).some(function (p) {
      return (p.display_name || p.name) === HYPNOSIS_PASSIVE;
    });
  }

  /* ====================== LEECH SOURCE (BIOINSECT) ======================
   * Bioinsect ships 0 base damage: "Genetic Code" copies a % of the
   * strongest unit's base damage. The user picks the source (portraits +
   * best-build DPS); default = auto, the top-DPS unit on the roster.
   * Toggling Genetic Code off in the description card zeroes the unit.
   */
  function isLeechUnit(u) { return u.unit_name === LEECH_UNIT; }

  function leechUnits() {
    return units.filter(function (u) { return u.calculated && isLeechUnit(u); });
  }

  // explicit choice first, otherwise the strongest (top-DPS) other unit
  function leechSourceUnit(u) {
    var s = unitSetting(u.unit_name);
    if (s.leechSource) {
      for (var i = 0; i < units.length; i++) {
        if (units[i].unit_name === s.leechSource && !isLeechUnit(units[i]) &&
            !isFarm(units[i])) return units[i];
      }
    }
    var best = null, bestV = -1;
    for (var j = 0; j < units.length; j++) {
      var x = units[j];
      if (isLeechUnit(x) || isFarm(x) || x.placeholder) continue;
      var v = resolveCardData(x).tdps;
      if (v != null && v > bestV) { bestV = v; best = x; }
    }
    return best;
  }

  // copied damage = source max-upgrade base damage x leech %
  function leechDamageFor(u) {
    var src = leechSourceUnit(u);
    if (!src || !src.upgrades || !src.upgrades.length) return 0;
    var s = unitSetting(u.unit_name);
    var defs = window.AECalc ? AECalc.unitVars(u.unit_name) : [];
    var pct = 50;
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].key === "bioinsect_leech") {
        pct = typeof s.vars[defs[i].key] === "number" ? s.vars[defs[i].key] : defs[i].def;
      }
    }
    var upg = src.upgrades[src.upgrades.length - 1];
    return (upg.damage || 0) * pct / 100;
  }

  // calculator overrides built from the unit's Variables
  function unitT(u) {
    var s = unitSetting(u.unit_name);
    var t = {
      hypnosis_target_share: hypShare(u),
      enemies_in_range: s.enemiesInRange,
      enemy_hp: HP_PROFILES[enemyHpProfile] ? HP_PROFILES[enemyHpProfile].basic1 : null,
      passive_state: s.passives
    };
    var defs = window.AECalc ? AECalc.unitVars(u.unit_name) : [];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var v = s.vars[d.key];
      t[d.key] = typeof v === "number" ? v : d.def;
    }
    return t;
  }

  function currentUnit() {
    if (!currentDetail) return null;
    for (var i = 0; i < units.length; i++) {
      if (units[i].unit_name === currentDetail) return units[i];
    }
    return null;
  }

  function computeCalculated() {
    if (!window.AECalc) return;
    var leech = [];
    units.forEach(function (u) {
      if (!u.calculated || calcCache[u.unit_name] || isFarm(u)) return;
      // leech units depend on everyone else's DPS -> build them last
      if (isLeechUnit(u)) { leech.push(u); return; }
      try { buildCalc(u); }
      catch (e) { console.error("DPS calculation failed for " + u.unit_name, e); }
    });
    leech.forEach(function (u) {
      try { buildCalc(u); }
      catch (e) { console.error("DPS calculation failed for " + u.unit_name, e); }
    });
    poolLoaded = true;
  }

  // rebuild the leech unit(s) whenever any other unit's DPS may have moved
  // (its copied damage follows the current top unit / explicit choice)
  function rebuildLeech() {
    leechUnits().forEach(function (u) {
      try { buildCalc(u); }
      catch (e) { console.error("Leech recalculation failed for " + u.unit_name, e); }
    });
  }

  function buildCalc(u) {
    var opts = {
      unit: u, traits: traitData, equipments: equipData, T: unitT(u)
    };
    if (isLeechUnit(u)) opts.leechDamage = leechDamageFor(u);
    var calc = window.AECalc.createCalculator(opts);
    var table = calc.traitTable();
    if (!table.length) return false;
    calcCache[u.unit_name] = { calc: calc, table: table, best: table[0] };
    patchCard(u);
    refreshDetail(u);
    return true;
  }

  // rebuild one unit's calculator after a Variables change and re-sort the
  // grid (its TDPS may move the card up or down the list)
  function recomputeUnit(u) {
    if (!u.calculated || !window.AECalc || isFarm(u)) return;
    if (!poolLoaded) { dataReady().then(function () { recomputeUnit(u); }); return; }
    try {
      if (buildCalc(u)) scheduleIdle(applyAndRender);
      if (!isLeechUnit(u)) rebuildLeech();   // the leech copies this number
    } catch (e) { console.error("DPS recalculation failed for " + u.unit_name, e); }
  }

  /* ============================== DETAIL MODAL ============================== */
  /* "Best build" block: ONE row of equal containers -
   *   [trait box] [equip] [equip] [equip]
   * Same builder as the grid cards (cardBuild), so the selected trait
   * (st.dpsTrait) is shared between the card and the modal. */
  function fillBuild(u) {
    var c = calcCache[u.unit_name];
    var b = cardBuild(u);

    $("detailTraits").innerHTML = b.trait
      ? traitBoxHTML(b.trait, b.rank, b.table, b.sel)
      : '<div class="ph-note">Traits TBD</div>';

    $("detailEquips").innerHTML = (b.equips && b.equips.length)
      ? equipsHTML({ equips: b.equips })
      : '<div class="ph-note">Equipment TBD</div>';
    clearTraitHosts();

    // calculator not built yet (pool still loading): fill once it lands
    // (!poolLoaded guards against retrying forever if the build failed)
    if (u.calculated && !isFarm(u) && !c && !poolLoaded) {
      ensureCalc(u).then(function () {
        if (currentDetail === u.unit_name) refreshDetail(u);
      });
    }
  }

  function fillPassives(u) {
    var all = (u.passives || []).concat(u.abilities || []);
    var A = window.AECalc;
    var farm = isFarm(u);
    var st = unitSetting(u.unit_name);
    var hyp = hasHypnosis(u);
    var leech = isLeechUnit(u);
    var modeled = !!(A && A.hasAnyModel(u.unit_name));
    var defs = A ? A.unitVars(u.unit_name) : [];
    var varMap = (A && A.passiveVarKeys) ? A.passiveVarKeys(u.unit_name) : {};
    var claimed = {};            // variable keys already rendered in a card
    var rangeDone = hyp;         // hypnosis card owns the range row when present
    var share = hypShare(u);

    function defRow(d) {
      var v = typeof st.vars[d.key] === "number" ? st.vars[d.key] : d.def;
      return '<div class="var-row"><span class="var-info">' +
        '<span class="var-label">' + esc(d.label) + "</span>" +
        '<span class="var-sub">' + esc(d.sub || "") + "</span></span>" +
        '<input class="var-input" data-var="' + esc(d.key) + '" type="number" min="' + d.min +
        '" max="' + d.max + '" step="' + (d.step || 1) + '" value="' + v + '"></div>';
    }

    function rangeRow() {
      rangeDone = true;
      return '<div class="var-row"><span class="var-info">' +
        '<span class="var-label">Enemies in range</span>' +
        '<span class="var-sub">' +
        (hyp ? "Denominator of the hypnosis share - default 4"
             : "Enemies assumed in range for stack-based passives - default 4") +
        "</span></span>" +
        '<input class="var-input" id="varRange" type="number" min="1" max="10" step="1" value="' +
        st.enemiesInRange + '"></div>';
    }

    function hypRows() {
      return '<div class="var-row"><span class="var-info">' +
        '<span class="var-label">Hypnotized enemies</span>' +
        '<span class="var-sub">Enemies taking extra damage from Hypnosis - default 0 (buff off)</span>' +
        '</span><input class="var-input" id="varHyp" type="number" min="0" max="10" step="1" value="' +
        st.hypnotized + '"></div>' + rangeRow();
    }

    function defByKey(key) {
      for (var i = 0; i < defs.length; i++) if (defs[i].key === key) return defs[i];
      return null;
    }

    var cards = all.map(function (p) {
      var name = p.display_name || p.name || "";
      var on = st.passives[name] !== false;
      // impact label: anything that does not feed this unit's live number
      var impact = "";
      if (farm) impact = '<div class="pimpact">* Does not affect Yen income</div>';
      else if (A && A.hasNoDps(u.unit_name, name)) {
        impact = '<div class="pimpact">* Does not affect DPS</div>';
      } else if (name === HYPNOSIS_PASSIVE || (A && A.hasPassiveModel(u.unit_name, name))) {
        impact = "";   // feeds the live DPS
      } else if (!u.calculated) {
        impact = '<div class="pimpact">* Applied when this unit is calculated</div>';
      } else {
        impact = '<div class="pimpact">* Does not affect DPS</div>';
      }
      // numeric Variables consumed by THIS model, rendered inside its card
      var rows = [];
      if (hyp && name === HYPNOSIS_PASSIVE) rows.push(hypRows());
      if (leech && name === "Genetic Code") rows.push(leechRow(u, st));
      var keys = varMap[name] || [];
      for (var ki = 0; ki < keys.length; ki++) {
        var k = keys[ki];
        if (k === "enemies_in_range") {
          if (!rangeDone) rows.push(rangeRow());
          continue;
        }
        if (claimed[k]) continue;
        var d = defByKey(k);
        if (!d) continue;
        claimed[k] = true;
        rows.push(defRow(d));
      }
      var pvars = rows.length ? '<div class="pvars">' + rows.join("") + "</div>" : "";
      return '<div class="passive-item">' +
        '<div class="pname">' + esc(name) + "</div>" +
        '<label class="switch passive-toggle"><input type="checkbox" data-pass="' +
        esc(name) + '"' + (on ? " checked" : "") +
        '><span class="slider"></span></label>' +
        '<div class="pdesc">' +
        esc(cleanText(fillPlaceholders(p.description, p.effects))) + "</div>" +
        pvars + impact + "</div>";
    }).join("");

    // variables no model reads (or leftover) get their own trailing card
    var others = [];
    for (var di = 0; di < defs.length; di++) {
      if (!claimed[defs[di].key]) others.push(defRow(defs[di]));
    }
    if (others.length) {
      cards += '<div class="passive-item no-toggle">' +
        '<div class="pname">Other variables</div>' +
        '<div class="pvars">' + others.join("") + "</div></div>";
    }

    // fixed assumptions + Theoretic max / Reset, right under the cards
    var tail = "";
    if (u.calculated && farm) {
      tail = '<div class="var-note">Farm unit: this unit generates <b>Yen every wave</b> ' +
        "instead of dealing damage, so passives never change its income. Best equipment: " +
        "Economist&rsquo;s Coin (returns 10% of the Yen spent during a wave, max roll).</div>";
    } else if (u.calculated && (hyp || modeled || defs.length)) {
      // only the live hypnosis share readout survives here (a variable
      // value, not an explanatory note)
      var hypNote = hyp
        ? (share > 0
            ? "Hypnosis share " + Math.round(share * 100) + "% (" + st.hypnotized +
              " hypnotized / " + st.enemiesInRange + " in range)."
            : "Hypnosis buff OFF (" + st.hypnotized + " hypnotized enemies).")
        : "";
      var hpOpts = "";
      for (var pk in HP_PROFILES) {
        if (!Object.prototype.hasOwnProperty.call(HP_PROFILES, pk)) continue;
        hpOpts += '<option value="' + pk + '"' +
          (pk === enemyHpProfile ? " selected" : "") + ">" +
          esc(HP_PROFILES[pk].label) + "</option>";
      }
      tail = '<div class="var-row"><span class="var-info">' +
        '<span class="var-label">Enemy HP profile</span>' +
        '<span class="var-sub">Enemy HP drives how long targets survive, which ' +
        'sets stack-based passives (e.g. Shinigami Sword). Sandbox excluded.</span>' +
        '</span><select class="var-input" id="hpProfile">' + hpOpts + '</select></div>' +
        '<div class="var-actions">' +
        '<button type="button" class="var-btn primary" id="varMax">Theoretic max buff</button>' +
        '<button type="button" class="var-btn" id="varReset">Reset</button></div>' +
        (hypNote ? '<div class="var-note">' + hypNote + "</div>" : "");
    } else if (!u.calculated) {
      tail = '<div class="var-note">This unit has no live DPS yet: the settings above are ' +
        "saved and applied as soon as its calculation is available.</div>";
    }

    var html = cards + tail;
    $("detailPassives").innerHTML = html;
    $("blkPassives").hidden = html === "";
  }

  // leech source picker: portrait + name + best-build DPS per row
  function leechRow(u, s) {
    var cur = leechSourceUnit(u);
    var auto = !s.leechSource;
    function face(x) {
      return '<img class="leech-face" src="' + unitImg(x.unit_name) + '" alt="" ' +
        'loading="lazy" decoding="async" onerror="this.style.display=\'none\'">';
    }
    function dpsTxt(x) {
      var v = resolveCardData(x).tdps;
      return v == null ? "-" : fmtDps(v);
    }
    var opts = [];
    opts.push('<div class="leech-opt' + (auto ? " sel" : "") + '" data-src="">' +
      '<span class="leech-face leech-auto">TOP</span>' +
      '<span class="leech-name">Auto (strongest unit)</span>' +
      '<span class="leech-dps">' + (cur ? dpsTxt(cur) : "-") + "</span></div>");
    units.forEach(function (x) {
      if (isLeechUnit(x) || isFarm(x) || x.placeholder) return;
      if (resolveCardData(x).tdps == null) return;
      opts.push('<div class="leech-opt' + (!auto && s.leechSource === x.unit_name ? " sel" : "") +
        '" data-src="' + esc(x.unit_name) + '">' + face(x) +
        '<span class="leech-name">' + esc(x.unit_name) + "</span>" +
        '<span class="leech-dps">' + dpsTxt(x) + "</span></div>");
    });
    return '<div class="var-row"><span class="var-info">' +
      '<span class="var-label">Leech source</span>' +
      '<span class="var-sub">Unit whose base damage Genetic Code copies - ' +
      "default Auto (strongest unit)</span></span>" +
      '<div class="leech-dd">' +
      '<button type="button" class="leech-btn" id="leechBtn">' +
      (cur ? face(cur) : '<span class="leech-face leech-auto">TOP</span>') +
      '<span class="leech-name">' + esc(cur ? cur.unit_name : "None") + "</span>" +
      '<span class="leech-dps">' + (cur ? dpsTxt(cur) : "-") + "</span></button>" +
      '<div class="leech-menu" id="leechMenu" hidden>' + opts.join("") + "</div></div></div>";
  }

  /* Only farm units keep a block here: their per-level upgrade economics
   * (Level / Cost / Yen per wave). Normal units show NO DPS table, no
   * "calculated live" paragraph and no model notes anymore - the
   * "Best build" block carries the summary instead. */
  function fillDps(u) {
    var box = $("detailDps");
    if (!u.calculated || !isFarm(u)) { $("blkDps").hidden = true; return; }
    $("blkDps").hidden = false;

    var ups = u.upgrades || [];
    var rows = ups.map(function (x, i) {
      var last = i === ups.length - 1;
      return '<tr class="' + (last ? "top" : "") + '">' +
        "<td>" + (i === 0 ? "Deploy" : "Upgrade " + i) + "</td>" +
        '<td class="num">' + yen(x.cost) + "</td>" +
        '<td class="num">' + yen(x.farm) + "</td></tr>";
    }).join("");
    box.innerHTML =
      '<table class="dps-table"><thead><tr><th>Level</th><th>Cost</th>' +
      "<th>Yen / wave</th></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  function refreshDetail(u) {
    if (currentDetail !== u.unit_name) return;
    var cd = resolveCardData(u);
    $("dTdps").textContent = isFarm(u) ? yen(cd.tdps) : fmtDps(cd.tdps);
    fillBuild(u);
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
    observeAuras($("detailEbox"));

    $("detailRarity").innerHTML = esc(rarity) +
      '<span class="element-chip"><img src="' + elementImg(u.element) + '" alt="" ' +
      'onerror="this.remove()">' + esc(u.element) + "</span>";
    $("detailName").textContent = u.unit_name;
    $("detailDesc").textContent = u.desc || "No description available.";
    $("lTdps").textContent = isFarm(u) ? "Yen / wave" : "TDPS";
    $("lCost").textContent = isFarm(u) ? "Total Cost" : "Max Upgrade";
    $("dTdps").textContent = isFarm(u) ? yen(cd.tdps) : fmtDps(cd.tdps);
    $("dDeploy").textContent = yen(deployOf(u));
    $("dCost").textContent = isFarm(u) ? yen(farmTotalCost(u)) : yen(costOf(u));

    fillBuild(u);
    fillPassives(u);
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
    // placeholder and farm units always sort last (farms show Yen, not DPS)
    var ph = function (u) { return (u.placeholder || isFarm(u)) ? 1 : 0; };
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

  /* ====================== VARIABLES PANEL EVENTS ====================== */
  function applyVars(u) {
    fillPassives(u);
    recomputeUnit(u);
  }

  function bindVars() {
    // variables now live inside the passive description cards
    var box = $("detailPassives");

    // passive toggles live on the description cards (detailPassives)
    $("detailPassives").addEventListener("change", function (e) {
      var u = currentUnit();
      if (!u) return;
      var t = e.target;
      if (t && t.hasAttribute && t.hasAttribute("data-pass")) {
        unitSetting(u.unit_name).passives[t.getAttribute("data-pass")] = !!t.checked;
        applyVars(u);
      }
    });

    // trait selector of the "Best build" block (custom dropdown: the button
    // sits right next to the trait name, options are ".tr-dd-opt" rows)
    $("blkBuild").addEventListener("click", function (e) {
      var u = currentUnit();
      if (!u) return;
      var pick = e.target.closest ? e.target.closest(".tr-pick") : null;
      if (pick) { toggleTraitMenu(pick); return; }
      var opt = e.target.closest ? e.target.closest(".tr-dd-opt") : null;
      if (opt) {
        unitSetting(u.unit_name).dpsTrait = opt.getAttribute("data-trait");
        refreshDetail(u);   // re-renders the row -> menu closes with it
        patchCard(u);       // the grid card shares the same selection
        return;
      }
      closeTraitMenus();    // any other click inside the block closes it
    });
    // ...and a click anywhere outside any trait container closes it too
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".build-trait")) return;
      closeTraitMenus();
    });

    // variable inputs
    box.addEventListener("change", function (e) {
      var u = currentUnit();
      if (!u) return;
      var t = e.target;
      var s = unitSetting(u.unit_name);
      if (t && t.id === "varHyp") {
        s.hypnotized = clampInt(t.value, 0, 10, 0);
      } else if (t && t.id === "varRange") {
        s.enemiesInRange = clampInt(t.value, 1, 10, 4);
      } else if (t && t.id === "hpProfile") {
        enemyHpProfile = t.value;
        units.forEach(function (uu) {
          if (uu.calculated && !isFarm(uu)) recomputeUnit(uu);
        });
        rebuildLeech();
        return;
      } else if (t && t.hasAttribute && t.hasAttribute("data-var")) {
        var key = t.getAttribute("data-var");
        var defs = window.AECalc ? AECalc.unitVars(u.unit_name) : [];
        var def = null;
        for (var i = 0; i < defs.length; i++) if (defs[i].key === key) def = defs[i];
        if (!def) return;
        s.vars[key] = clampInt(t.value, def.min, def.max, def.def);
      } else {
        return;
      }
      applyVars(u);
    });

    // leech source dropdown + Theoretic max buff / Reset
    box.addEventListener("click", function (e) {
      var u = currentUnit();
      if (!u) return;
      var s = unitSetting(u.unit_name);
      var btn = e.target.closest ? e.target.closest("#leechBtn") : null;
      if (btn) {
        var m = $("leechMenu");
        if (m) m.hidden = !m.hidden;
        return;
      }
      var opt = e.target.closest ? e.target.closest(".leech-opt") : null;
      if (opt) {
        s.leechSource = opt.getAttribute("data-src") || null;
        applyVars(u);
        return;
      }
      var mm = $("leechMenu");   // any other click closes the picker
      if (mm && !mm.hidden) mm.hidden = true;
      var id = e.target && e.target.id;
      if (id !== "varMax" && id !== "varReset") return;
      var defs = window.AECalc ? AECalc.unitVars(u.unit_name) : [];
      if (id === "varMax") {
        s.passives = {};                                       // every passive ON
        s.enemiesInRange = clampInt(s.enemiesInRange, 1, 10, 4);
        s.hypnotized = s.enemiesInRange;                       // share = 100%
        for (var i = 0; i < defs.length; i++) s.vars[defs[i].key] = defs[i].max;
      } else {
        s.passives = {};                                       // every passive ON
        s.hypnotized = 0;                                      // hypnosis buff OFF
        s.enemiesInRange = 4;
        s.leechSource = null;                                  // leech: auto (top DPS)
        s.dpsTrait = null;                                     // DPS table: best trait
        for (var j = 0; j < defs.length; j++) s.vars[defs[j].key] = defs[j].def;
      }
      applyVars(u);
      showToast(id === "varMax" ? "Theoretic max buff applied" : "Variables reset");
    });
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
    clearLegacySettings();   // settings are session-only: reload = defaults
    bindTooltip();
    bindFilters();
    bindVars();

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
