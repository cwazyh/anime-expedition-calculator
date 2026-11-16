/*
 * Anime Expeditions - DPS calculator (JavaScript port of dps_calculator.py).
 *
 * Core formula (verified against the live game):
 *   D    = round1(base_DMG * level_mult * (1+asc_dmg) * (1+pot_dmg) * (1+trait_dmg) * (1+equip_dmg))
 *   SPA  = round1(base_SPA * (1+trait_spa) * (1+pot_spa) * (1+equip_spa))
 *   DPS  = round2(D / SPA * crit_mult * passive_mult)
 *
 * Validation anchor (live game, Traitor Unbound, no equipment/potential/passives):
 *   D=81470 SPA=6.2 DPS=13140.32
 *
 * Works in the browser (window.AECalc) and in Node (require(...)).
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AECalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ============================== TUNABLES ==============================
   * Same settings as dps_calculator.py:
   *   Level 50, Ascension 3, Potential Z (dmg +20% / spa -15% / rng +15%),
   *   competitive OFF, equipment rolls MAX (Value=1), expected crit,
   *   equipment passives MAX (Shinigami at 15/15), hypnotized enemies = 0
   *   by default (Hypnosis buff OFF until raised from the site's Variables
   *   panel), enemies in range = 4 (denominator of the hypnosis share).
   */
  var DEFAULT_T = {
    // stat amplifier settings
    level: 50,
    level_damage_mult: 1.82,          // live-game verified at Lv50
    ascension: 3,
    asc_damage: 0.15,                 // tiers: +5% / +5% range / +10% cumulative
    asc_range: 0.05,
    ascension_eligible_rarities: ["Mythic"],
    competitive_mode: false,          // off: would zero cc<=25 and -50 cd
    stat_potential: { damage: 20, spa: -15, range: 15 },  // grade Z MAX roll
    // layers
    equip_stack_mode: "multiplicative",
    type_buff_mode: "separate",       // Physical/Magical layer, only if archetype matches
    crit_mode: "bonus",               // 1 + cc/100 * cd/100 (cd includes base 100)
    // equipment rules
    allow_duplicate_equipment: false,
    use_max_rolls: true,              // Value=1 -> buffs.max
    expected_crit: true,
    // passives / conditionals (steady-state)
    enemies_in_range: 4,              // hypnosis share / in-range conditionals
    shinigami_enemies: 15,            // ALL equipment settings at MAX incl. passives
    shinigami_per_enemy: 1.0,         // passive roll 0.5..1 % per enemy -> max 1.0
    shinigami_capacity: 15,
    hypnosis_uptime: 10 / 15,         // Aizen: 10s every 15s on 5 strongest
    hypnosis_damage_bonus: 0.25,      // +25% damage taken
    hypnosis_target_share: 0,         // default 0: Variables panel raises it (0..1)
    aizen_is_bleach_category: true,
    reflect_procs_per_min: 0,
    reapers_glove_procs_per_min: 0
  };

  /* ============================== HELPERS ============================== */
  function r1(x) { return Math.floor(x * 10 + 0.5) / 10; }
  function r2(x) { return Math.floor(x * 100 + 0.5) / 100; }

  function cloneT(overrides) {
    var t = {};
    var k;
    for (k in DEFAULT_T) if (Object.prototype.hasOwnProperty.call(DEFAULT_T, k)) t[k] = DEFAULT_T[k];
    t.stat_potential = {
      damage: DEFAULT_T.stat_potential.damage,
      spa: DEFAULT_T.stat_potential.spa,
      range: DEFAULT_T.stat_potential.range
    };
    if (overrides) {
      for (k in overrides) {
        if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
        if (k === "stat_potential") {
          var sp = overrides.stat_potential || {};
          t.stat_potential = {
            damage: sp.damage !== undefined ? sp.damage : t.stat_potential.damage,
            spa: sp.spa !== undefined ? sp.spa : t.stat_potential.spa,
            range: sp.range !== undefined ? sp.range : t.stat_potential.range
          };
        } else {
          t[k] = overrides[k];
        }
      }
    }
    return t;
  }

  // all k-combinations of arr (items kept in arr order, like itertools.combinations)
  function combinations(arr, k) {
    var res = [];
    var n = arr.length;
    if (k > n) return res;
    var idx = [];
    (function rec(start, cur) {
      if (cur.length === k) {
        var out = [];
        for (var i = 0; i < cur.length; i++) out.push(arr[cur[i]]);
        res.push(out);
        return;
      }
      for (var i = start; i < n; i++) {
        cur.push(i);
        rec(i + 1, cur);
        cur.pop();
      }
    })(0, idx);
    return res;
  }

  var ZERO_PASSIVES = [
    "Sacrificial Mark", "Cursed Finger", "Critter", "Warrior Pole",
    "Reaper's Glove", "Bamboo Bottle", "Economists Coin"
  ];

  /* =================== PER-UNIT PASSIVE MODELS ===================
   * Steady-state models for unit passives that affect DPS, built on the
   * same philosophy as Traitor (Illusion)'s Hypnosis model: assume the
   * fight lasts long enough for the effect to reach a steady state
   * (stacks, uptimes, follow-up attacks) and expose every assumption as
   * a Variable on the site.
   *
   * registerPassives("<unit name>", {
   *   "<passive display name>": function (T) {
   *     return {
   *       dmg:  0.10,   // x1.10 damage layer (applied before rounding)
   *       spa: -0.15,   // x0.85 SPA (negative = faster attacks)
   *       cc:   5,      // flat Crit Chance added (final units)
   *       cd:   10,     // flat Crit Damage added (final units)
   *       mult: 1.05,   // extra DPS multiplier (after crit)
   *       notes: ["..."]
   *     };
   *   }
   * });
   * All fields are optional. The model reads only T (the site's
   * tunables): T.passive_state[name] === false turns it off, and any
   * number shown in the Variables panel arrives as T.<key>.
   */
  var PASSIVE_MODELS = {};   // unit name -> { display name -> fn(T) }
  var UNIT_VARS = {};        // unit name -> [{ key, label, sub, min, max, step, def }]

  function registerPassives(unitName, models) {
    PASSIVE_MODELS[unitName] = models;
  }
  function registerUnitVars(unitName, vars) {
    UNIT_VARS[unitName] = vars;
  }
  function hasPassiveModel(unitName, passiveName) {
    var m = PASSIVE_MODELS[unitName];
    return !!(m && Object.prototype.hasOwnProperty.call(m, passiveName));
  }
  function hasAnyModel(unitName) {
    var m = PASSIVE_MODELS[unitName];
    if (!m) return false;
    for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) return true;
    return false;
  }
  function unitVars(unitName) { return UNIT_VARS[unitName] || []; }
  function passiveModelNames(unitName) {
    var m = PASSIVE_MODELS[unitName], out = [];
    if (m) for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out.push(k);
    return out;
  }

  /* Which Variables does each passive model read? The site renders every
   * input inside the passive description card that consumes it, so it needs
   * the passive -> keys mapping. Each model is executed with a recording
   * Proxy over T (default / max / min values, both trait branches, all
   * passives on and off) to catch conditional reads; results are cached
   * per unit. "enemies_in_range" is kept as a marker key (the site shows
   * the shared "Enemies in range" row in the first card that reads it). */
  var PASSIVE_VAR_CACHE = {};   // unit name -> { passive name -> [key, ...] }

  function passiveVarKeys(unitName) {
    if (PASSIVE_VAR_CACHE[unitName]) return PASSIVE_VAR_CACHE[unitName];
    var models = PASSIVE_MODELS[unitName];
    var defs = UNIT_VARS[unitName] || [];
    var out = {};
    if (models) {
      var known = { enemies_in_range: true };
      for (var i = 0; i < defs.length; i++) known[defs[i].key] = true;
      var passes = [
        { trait: "Unbound", val: function (d) { return d.def; }, off: false },
        { trait: "Unbound", val: function (d) { return d.max; }, off: false },
        { trait: "Primordial", val: function (d) { return d.min; }, off: false },
        { trait: "Unbound", val: function (d) { return d.def; }, off: true }
      ];
      for (var name in models) {
        if (!Object.prototype.hasOwnProperty.call(models, name)) continue;
        var reads = {};
        var modelFn = models[name];
        for (var p = 0; p < passes.length; p++) {
          var base = { passive_state: {}, enemies_in_range: 4 };
          if (passes[p].off) {
            var mn = passiveModelNames(unitName);
            for (var q = 0; q < mn.length; q++) base.passive_state[mn[q]] = false;
          }
          for (var j = 0; j < defs.length; j++) base[defs[j].key] = passes[p].val(defs[j]);
          var proxy = new Proxy(base, {
            get: function (t, k) {
              if (typeof k === "string") reads[k] = true;
              return t[k];
            }
          });
          try {
            modelFn(proxy, { dmg: 1, spa: 1, cc: 10, cd: 100, mult: 1,
                             trait: passes[p].trait });
          } catch (e) { /* introspection only: keep the reads collected so far */ }
        }
        var list = [];
        for (var k in reads) {
          if (Object.prototype.hasOwnProperty.call(reads, k) && known[k]) list.push(k);
        }
        out[name] = list;
      }
    }
    PASSIVE_VAR_CACHE[unitName] = out;
    return out;
  }

  // Passives that only buff other units (or the team) never change this
  // unit's own DPS: they are listed with a "Doesn't affect dps" tag and
  // their toggle is informational only.
  var NO_DPS = {};          // unit name -> { display name -> true }

  function registerNoDps(unitName, names) {
    var m = NO_DPS[unitName] || (NO_DPS[unitName] = {});
    for (var i = 0; i < names.length; i++) m[names[i]] = true;
  }
  function hasNoDps(unitName, name) {
    var m = NO_DPS[unitName];
    return !!(m && m[name]);
  }

  var PM_ZERO = { dmg: 1, spa: 1, cc: 0, cd: 0, mult: 1, extra: 0 };

  // ctx = { dmg, spa } of the current level (pre-passive layers): models for
  // damage-over-time passives convert "X% of damage every N seconds" into an
  // equivalent mult (extra_dps / base_dps = X/100 * spa / N * targets).
  // r.extra = extra damage per second as a fraction of this unit's damage
  // (not a percentage layer: 0.1 = 0.1 * dmg damage every second, added
  // after the crit/passive multiplication because such instances are not
  // part of the regular attack).
  function applyPassiveModels(unitName, T, notes, ctx) {
    var models = PASSIVE_MODELS[unitName];
    if (!models) return PM_ZERO;
    var out = { dmg: 1, spa: 1, cc: 0, cd: 0, mult: 1, extra: 0 };
    for (var name in models) {
      if (!Object.prototype.hasOwnProperty.call(models, name)) continue;
      if (T.passive_state && T.passive_state[name] === false) {
        notes.push(name + ": OFF (Variables)");
        continue;
      }
      var r = models[name](T, ctx) || {};
      out.dmg *= (1 + (r.dmg || 0));
      out.spa *= (1 + (r.spa || 0));
      out.cc += r.cc || 0;
      out.cd += r.cd || 0;
      out.mult *= r.mult || 1;
      out.extra += r.extra || 0;
      if (r.notes) for (var i = 0; i < r.notes.length; i++) notes.push(r.notes[i]);
    }
    return out;
  }

  /* ============================== FACTORY ==============================
   * ctx = {
   *   unit:       parsed unit JSON (Units/<name> Data/<name>_data.json),
   *   traits:     { "<trait name>": trait JSON },
   *   equipments: { "<equipment name>": equipment JSON },
   *   T:          optional tunable overrides
   * }
   */
  function createCalculator(ctx) {
    var unit = ctx.unit;
    var traits = ctx.traits || {};
    var equipments = ctx.equipments || {};
    var T = cloneT(ctx.T);

    var upg = unit.upgrades[unit.upgrades.length - 1];
    var BASE_DMG = upg.damage, BASE_SPA = upg.spa, BASE_RNG = upg.range;
    var BASE_CC = upg.crit_chance, BASE_CD = upg.crit_damage;
    // Leech units (Bioinsect "Genetic Code": copy a % of the strongest
    // unit's base damage) ship with 0 base damage in the game data, so the
    // caller passes the copied damage here. It is applied only while the
    // leech passive is enabled (toggling it off zeroes the unit again).
    if (ctx.leechDamage != null &&
        (!T.passive_state || T.passive_state["Genetic Code"] !== false)) {
      BASE_DMG = ctx.leechDamage;
    }
    var ARCHETYPE = unit.archetype;
    var RARITY = unit.rarity;
    var UNIT_NAME = unit.unit_name;

    var names = Object.keys(equipments).sort();
    var BOUND = [], POOL = [];
    for (var i = 0; i < names.length; i++) {
      var n = names[i], d = equipments[n];
      if (d.for_unit === UNIT_NAME) BOUND.push(n);
      if (d.general_use) POOL.push(n);
    }
    var SLOTS = (RARITY === "Epic" || RARITY === "Rare") ? 1 : 2;

    function maxBuffs(eq) {
      // max roll (Value=1) -> buffs.max, in percent units
      var out = {}, b = eq.buffs || {}, ks = Object.keys(b);
      for (var i = 0; i < ks.length; i++) out[ks[i]] = b[ks[i]].max;
      return out;
    }

    function equipStats(combo, useMax) {
      var stats = {};
      for (var i = 0; i < combo.length; i++) {
        var src = maxBuffs(equipments[combo[i]]);
        for (var k in src) {
          if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
          stats[k] = (stats[k] || 0) + src[k];
        }
      }
      return stats;
    }

    // Passives of equipped general equipment (bound passives are handled
    // by the unit-specific model below, exactly like the Python version).
    function evalPassives(combo, mult, notes, withEquipment) {
      if (!withEquipment || !combo || !combo.length) return mult;
      for (var i = 0; i < combo.length; i++) {
        var n = combo[i];
        if (BOUND.indexOf(n) !== -1) continue;
        var eq = equipments[n] || {};
        var ps = eq.passives || [];
        for (var j = 0; j < ps.length; j++) {
          var nm = ps[j].display_name || "";
          if (nm === "Shinigami Sword") {
            var gain = Math.min(T.shinigami_enemies * T.shinigami_per_enemy,
                                T.shinigami_capacity) / 100;
            mult *= (1 + gain);
            notes.push("ShinigamiSword +" + (gain * 100).toFixed(1) + "% (" +
                       T.shinigami_enemies + " enemies)");
          } else if (ZERO_PASSIVES.indexOf(nm) !== -1) {
            notes.push(nm + ": 0 (unit does not meet condition)");
          } else {
            notes.push(nm + ": UNHANDLED -> 0");
          }
        }
      }
      return mult;
    }

    function ascMultipliers() {
      if (T.ascension_eligible_rarities.indexOf(RARITY) === -1) return [1.0, 1.0];
      if (T.ascension >= 3) return [1 + T.asc_damage, 1 + T.asc_range];
      if (T.ascension >= 2) return [1.05, 1.05];   // tier2: +5% dmg, +5% range
      if (T.ascension >= 1) return [1.05, 1.0];
      return [1.0, 1.0];
    }

    function calc(traitName, combo, opts) {
      opts = opts || {};
      var withEquipment = opts.withEquipment !== false;
      var withPassives = opts.withPassives !== false;
      var potential = opts.potential !== false;

      var t = traits[traitName] || {};
      var t_dmg = t.Damage || 0, t_spa = t.SPA || 0;
      var t_cc = t.CritChance || 0, t_cd = t.CritDamage || 0;

      var e_dmg = 0, e_spa = 0, e_cc = 0, e_cd = 0, e_rng = 0;
      var type_mult = 1.0;
      if (withEquipment && combo && combo.length) {
        var s = equipStats(combo, T.use_max_rolls);
        e_dmg = s.Damage || 0; e_spa = s.SPA || 0;
        e_cc = s.CritChance || 0; e_cd = s.CritDamage || 0; e_rng = s.Range || 0;
        var tb = s[ARCHETYPE] || 0;
        if (tb) {
          if (T.type_buff_mode === "separate") type_mult = 1 + tb / 100;
          else e_dmg += tb;
        }
      }

      var pot_dmg = potential ? (1 + T.stat_potential.damage / 100) : 1.0;
      var pot_spa = potential ? (1 + T.stat_potential.spa / 100) : 1.0;
      var pot_rng = potential ? (1 + T.stat_potential.range / 100) : 1.0;
      var asc = ascMultipliers();
      var asc_d = asc[0], asc_r = asc[1];

      var dmg, spa;
      if (T.equip_stack_mode === "multiplicative") {
        dmg = BASE_DMG * T.level_damage_mult * asc_d * pot_dmg *
              (1 + t_dmg) * (1 + e_dmg / 100);
        spa = BASE_SPA * (1 + t_spa) * pot_spa * (1 + e_spa / 100);
      } else {
        dmg = BASE_DMG * T.level_damage_mult * asc_d * pot_dmg *
              (1 + t_dmg + e_dmg / 100);
        spa = BASE_SPA * (1 + t_spa + e_spa / 100);
      }

      // per-unit passive models (dmg/spa/crit layers + extra-damage mult)
      // ctx carries the pre-passive values so models can reason on them
      // (e.g. guaranteed-crit passives recompute from the base crit chance)
      var notes = [];
      var pm = withPassives
        ? applyPassiveModels(UNIT_NAME, T, notes, {
            dmg: dmg, spa: spa,
            cc: BASE_CC + 100 * t_cc + e_cc,
            cd: BASE_CD + 100 * t_cd + e_cd,
            trait: traitName
          })
        : PM_ZERO;

      dmg = r1(dmg * type_mult * pm.dmg);
      spa = Math.max(r1(spa * pm.spa), 0.1);

      // crit (bonus semantics: cd includes base 100 = +100% on crit)
      var cc = BASE_CC + 100 * t_cc + e_cc + pm.cc;
      var cd = BASE_CD + 100 * t_cd + e_cd + pm.cd;
      if (T.competitive_mode) {
        if (cc <= 25) cc = 0;
        cd -= 50;
      }
      var crit_mult;
      if (!T.expected_crit) crit_mult = 1.0;
      else if (T.crit_mode === "bonus") crit_mult = 1 + (cc / 100) * (cd / 100);
      else crit_mult = 1 + (cc / 100) * ((cd - 100) / 100);   // legacy/total

      // passives
      var passive_mult = 1.0;
      if (withPassives) {
        if (UNIT_NAME === "Traitor (Illusion)" && T.aizen_is_bleach_category) {
          var hyp = 1 + T.hypnosis_uptime * T.hypnosis_target_share *
                    T.hypnosis_damage_bonus;
          passive_mult *= hyp;
          if (T.hypnosis_target_share > 0) {
            notes.push("Hypnosis x" + hyp.toFixed(4) + " (uptime " +
                       Math.round(T.hypnosis_uptime * 100) + "%, share " +
                       Math.round(T.hypnosis_target_share * 100) + "%)");
          } else {
            notes.push("Hypnosis: OFF (0 hypnotized enemies)");
          }
        }
        passive_mult = evalPassives(combo, passive_mult, notes, withEquipment);
        passive_mult *= pm.mult;
      }

      // extra damage instances (DoT/explosions/summons): r.extra is damage
      // per second as a fraction of this unit's damage, so extra_dps = extra * dmg
      var dps = r2(dmg / spa * crit_mult * passive_mult + pm.extra * dmg);
      var rng = r1(BASE_RNG * asc_r * pot_rng * (1 + (t.Range || 0)) *
                   (1 + (withEquipment && combo && combo.length ? e_rng / 100 : 0)));
      return {
        dmg: dmg, spa: spa, rng: rng, base_dps: dmg / spa,
        cc: cc, cd: cd, crit_mult: crit_mult, passive_mult: passive_mult,
        dps: dps, notes: notes
      };
    }

    // ================= bound equipment rounds =================
    // Game data (UnitEquipmentSlots: Exclusive/Mythic/Secret = 1) allows
    // exactly ONE unit-bound equipment at a time, so each trait is
    // evaluated once per bound candidate (one "round" each) and the best
    // round wins. Units without a bound equipment get a single round with
    // no bound slot.
    function boundChoices() { return BOUND.length ? BOUND.slice() : [null]; }

    // best general-equipment combo for one trait with one fixed bound slot
    function bestWithBound(traitName, bound, opts) {
      var base = bound ? [bound] : [];
      var best = null;
      var maxK = Math.min(SLOTS, POOL.length);
      for (var k = 0; k <= maxK; k++) {
        var cs = combinations(POOL, k);
        for (var i = 0; i < cs.length; i++) {
          var res = calc(traitName, base.concat(cs[i]), opts);
          if (!best || res.dps > best.res.dps) best = { res: res, combo: cs[i] };
        }
      }
      return { bound: bound, combo: best.combo, res: best.res };
    }

    // best distinct-equipment combo for one trait (best round wins)
    function bestCombo(traitName, opts) {
      var choices = boundChoices(), best = null;
      for (var i = 0; i < choices.length; i++) {
        var r = bestWithBound(traitName, choices[i], opts);
        if (!best || r.res.dps > best.res.dps) best = r;
      }
      return best;
    }

    // full per-trait table, sorted by DPS descending. Every row carries
    // its bound rounds (one per unit-equipment candidate, best first) so
    // the UI can show each configuration exactly once.
    function traitTable(opts) {
      var rows = [];
      var tns = Object.keys(traits).sort();
      var choices = boundChoices();
      for (var i = 0; i < tns.length; i++) {
        var rounds = [];
        for (var j = 0; j < choices.length; j++) rounds.push(bestWithBound(tns[i], choices[j], opts));
        rounds.sort(function (a, b) { return b.res.dps - a.res.dps; });
        rows.push({ trait: tns[i], rounds: rounds,
          bound: rounds[0].bound, combo: rounds[0].combo, res: rounds[0].res });
      }
      rows.sort(function (a, b) {
        if (b.res.dps !== a.res.dps) return b.res.dps - a.res.dps;
        return a.trait < b.trait ? -1 : (a.trait > b.trait ? 1 : 0);
      });
      return rows;
    }

    return {
      T: T,
      calc: calc,
      bestCombo: bestCombo,
      traitTable: traitTable,
      info: {
        unitName: UNIT_NAME,
        rarity: RARITY,
        archetype: ARCHETYPE,
        bound: BOUND,
        pool: POOL,
        slots: SLOTS,
        base: { dmg: BASE_DMG, spa: BASE_SPA, rng: BASE_RNG, cc: BASE_CC, cd: BASE_CD }
      }
    };
  }

  return {
    DEFAULT_T: DEFAULT_T,
    createCalculator: createCalculator,
    r1: r1,
    r2: r2,
    registerPassives: registerPassives,
    registerUnitVars: registerUnitVars,
    registerNoDps: registerNoDps,
    hasNoDps: hasNoDps,
    hasPassiveModel: hasPassiveModel,
    hasAnyModel: hasAnyModel,
    unitVars: unitVars,
    passiveModelNames: passiveModelNames,
    passiveVarKeys: passiveVarKeys
  };
});
