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
      dmg = r1(dmg * type_mult);
      spa = Math.max(r1(spa), 0.1);

      // crit (bonus semantics: cd includes base 100 = +100% on crit)
      var cc = BASE_CC + 100 * t_cc + e_cc;
      var cd = BASE_CD + 100 * t_cd + e_cd;
      if (T.competitive_mode) {
        if (cc <= 25) cc = 0;
        cd -= 50;
      }
      var crit_mult;
      if (!T.expected_crit) crit_mult = 1.0;
      else if (T.crit_mode === "bonus") crit_mult = 1 + (cc / 100) * (cd / 100);
      else crit_mult = 1 + (cc / 100) * ((cd - 100) / 100);   // legacy/total

      // passives
      var passive_mult = 1.0, notes = [];
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
      }

      var dps = r2(dmg / spa * crit_mult * passive_mult);
      var rng = r1(BASE_RNG * asc_r * pot_rng * (1 + (t.Range || 0)) *
                   (1 + (withEquipment && combo && combo.length ? e_rng / 100 : 0)));
      return {
        dmg: dmg, spa: spa, rng: rng, base_dps: dmg / spa,
        cc: cc, cd: cd, crit_mult: crit_mult, passive_mult: passive_mult,
        dps: dps, notes: notes
      };
    }

    // best distinct-equipment combo for one trait
    // (0..SLOTS general slots plus the unit-bound equipment, like the Python version)
    function bestCombo(traitName, opts) {
      var best = null;
      var maxK = Math.min(SLOTS, POOL.length);
      for (var k = 0; k <= maxK; k++) {
        var cs = combinations(POOL, k);
        for (var i = 0; i < cs.length; i++) {
          var c = cs[i];
          var res = calc(traitName, BOUND.concat(c), opts);
          if (!best || res.dps > best.res.dps) best = { res: res, combo: c };
        }
      }
      return best;
    }

    // full per-trait table, sorted by DPS descending
    function traitTable(opts) {
      var rows = [];
      var tns = Object.keys(traits).sort();
      for (var i = 0; i < tns.length; i++) {
        var b = bestCombo(tns[i], opts);
        rows.push({ trait: tns[i], combo: b.combo, res: b.res });
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
    r2: r2
  };
});
