/*
 * Anime Expeditions - per-unit passive & ability models.
 *
 * Loaded after js/calculator.js (browser: window.AECalc, Node: require).
 * Registers steady-state DPS models for every unit passive/ability:
 *
 *   A.registerPassives("<unit name>", {
 *     "<passive display name>": function (T, ctx) {
 *       return {
 *         dmg:  0.10,   // x1.10 damage layer (pre-crit, multiplicative)
 *         spa: -0.15,   // x0.85 SPA (negative = faster)
 *         cc:   5,      // flat Crit Chance added (percentage points)
 *         cd:   10,     // flat Crit Damage added (percentage points)
 *         mult: 1.05,   // extra DPS multiplier (after crit)
 *         extra: 0.08,  // extra damage per second as a fraction of this
 *                       // unit's damage (DoT/explosions/summons: post-crit)
 *         notes: ["..."]
 *       };
 *     }
 *   });
 *   A.registerUnitVars("<unit name>", [ V(key,label,sub,min,max,def,step) ]);
 *   A.registerNoDps("<unit name>", ["<passive display name>", ...]);
 *
 * Methodology (see README):
 *  - direct self buffs        -> dmg/spa/cc/cd layers, exactly as written
 *  - conditional passives     -> multiplied by an uptime variable (default
 *                                30%, adjustable in the Variables panel)
 *  - DoT / explosion / summon -> "extra" (damage per second as a fraction
 *                                of this unit's damage, added post-crit)
 *  - transformations / meters -> averaged over the full cycle (duty cycle
 *                                variable, default from the description)
 *  - active abilities         -> modeled with an estimated cadence (uptime
 *                                or uses-per-minute variable)
 *  - buffs to other units /
 *    pure utility (CC etc.)   -> registerNoDps ("Doesn't affect dps")
 *  - group buffs              -> the emitting unit is assumed to stand in
 *                                its own range (self included) when the
 *                                description does not exclude it; noted in
 *                                the model's notes.
 *
 * Every model reads only T (site tunables): T.passive_state[name] === false
 * turns it off (handled by calculator.js), and any number from the site's
 * Variables panel arrives as T.<key>. All Variables are integers (the UI
 * rounds), so uptimes are 0..100 percents.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./calculator.js"));
  else factory(root.AECalc);
})(typeof self !== "undefined" ? self : this, function (A) {
  "use strict";

  /* ============================== HELPERS ============================== */

  // registered variable (all values integer in the UI)
  function V(key, label, sub, min, max, def, step) {
    return { key: key, label: label, sub: sub, min: min, max: max, def: def, step: step || 1 };
  }

  // number variable with default (Node / unregistered fallback)
  function N(T, key, def) {
    var x = T[key];
    return typeof x === "number" ? x : def;
  }

  // percent variable -> fraction (default in percent)
  function UP(T, key, def) {
    return N(T, key, def) / 100;
  }

  // enemies assumed in range (site default 4)
  function EN(T) {
    return typeof T.enemies_in_range === "number" ? T.enemies_in_range : 4;
  }

  // passive is enabled (its toggle is not OFF in the Variables panel)
  function on(T, name) {
    return !(T.passive_state && T.passive_state[name] === false);
  }

  function note(list, s) { list.push(s); }

  /* ====================== 5th GOD HAND ====================== */
  A.registerPassives("5th God Hand", {
    // Every 3 attacks: Distortion on the target; enemies entering take 50%
    // of this unit's damage (12s per-enemy cooldown). Cadence: 1 distortion
    // per 3 attacks, ~1 enemy walks in per distortion.
    "Eclipse Distortion": function (T, ctx) {
      var hits = N(T, "femto_distortion_hits", 1);
      var extra = 0.50 * hits / (3 * ctx.spa);
      return { extra: extra, notes: ["Eclipse Distortion: 1 distortion / 3 attacks, " +
        hits + " enemy(s) walking in (estimated)"] };
    },
    // +2.5% damage & +1% range per marked enemy in range; marked take +5%.
    // Steady state: every enemy in range carries the mark (it refreshes on
    // distortion damage), so the stack count = enemies in range.
    "Causality": function (T) {
      var n = EN(T);
      return { dmg: 0.025 * n, mult: 1.05,
        notes: ["Causality: " + n + " marked enemies in range (+2.5% each, marked take +5%)"] };
    },
    // At 35 stacks: enemies in range take 100% of this unit's damage per
    // second for 5s, then the meter resets. Single-target counted; duty
    // cycle = 5s burst per meter rebuild cycle (~165s, default 3%).
    "Eclipse": function (T) {
      var u = UP(T, "femto_eclipse_uptime", 2);
      var extra = 1.00 * u;
      return { extra: extra, notes: ["Eclipse burst: 100% dmg/s for 5s, " +
        Math.round(u * 100) + "% duty cycle (meter rebuild, single-target counted)"] };
    }
  });
  A.registerUnitVars("5th God Hand", [
    V("femto_distortion_hits", "Distortion hits", "Enemies walking into each Distortion - default 1 (estimated)", 0, 10, 1),
    V("femto_eclipse_uptime", "Eclipse uptime %", "Duty cycle of the 5s Eclipse burst - default 2% (~5s per 250s)", 0, 100, 2, 1)
  ]);

  /* ====================== 8TH SWORD (BERSERK) ====================== */
  A.registerPassives("8th Sword (Berserk)", {
    // Enemies within 40% of range take 5% of this unit's damage every 1s.
    "Demonic Presence": function (T) {
      var n = N(T, "kenpachi_aura_targets", 1);
      var u = UP(T, "kenpachi_aura_uptime", 60);
      var extra = 0.05 * n * u;
      return { extra: extra, notes: ["Demonic Presence: 5% dmg/s on " + n +
        " enemy(s) inside 40% of range at " + Math.round(u * 100) +
        "% uptime (single-target view)"] };
    },
    // Self-stun cleanse + 100% follow-up: reactive, proc-based.
    "Savage Rebound": function (T) {
      var ppm = N(T, "kenpachi_stun_ppm", 1);
      var extra = 1.00 * ppm / 60;
      return { extra: extra, notes: ["Savage Rebound: " + ppm +
        " stun reflect(s) per minute (estimated)"] };
    },
    // Enemy below 10% HP -> 100% follow-up: execute-window proc.
    "Dismemberer's Rush": function (T) {
      var ppm = N(T, "kenpachi_execute_ppm", 1);
      var extra = 1.00 * ppm / 60;
      return { extra: extra, notes: ["Dismemberer's Rush: " + ppm +
        " execute follow-up(s) per minute (estimated)"] };
    },
    // After 25 takedowns: 15s transformation, +20% dmg / -10% SPA.
    "The Nameless Demon": function (T) {
      var u = UP(T, "kenpachi_transform_uptime", 30);
      return { dmg: 0.20 * u, spa: -0.10 * u,
        notes: ["The Nameless Demon: " + Math.round(u * 100) +
        "% transformation uptime (+20% dmg, -10% SPA)"] };
    }
  });
  A.registerUnitVars("8th Sword (Berserk)", [
    V("kenpachi_aura_targets", "Aura targets", "Enemies inside 40% of range taking Demonic Presence damage - default 1 (single-target view)", 0, 10, 1),
    V("kenpachi_aura_uptime", "Aura uptime %", "Share of time the primary sits inside 40% of range - default 60%", 0, 100, 60, 5),
    V("kenpachi_stun_ppm", "Stun reflects / min", "Savage Rebound procs per minute - default 1 (estimated)", 0, 60, 1),
    V("kenpachi_execute_ppm", "Executes / min", "Dismemberer's Rush procs per minute - default 1 (estimated)", 0, 60, 1),
    V("kenpachi_transform_uptime", "Transformation uptime %", "Share of time in KenpachiTransformation - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== ALCHEMY BROTHERS (TRUTH) ====================== */
  A.registerPassives("Alchemy Brothers (Truth)", {
    // Cycle of 3 attacks: Understand (marks) / Deconstruct (all units in
    // range +5% Magical dmg per mark, cap 50%, 10s) / Reconstruct (120%
    // damage + slow). Self benefits from Deconstruct (emitter stands in
    // its own range, Magical archetype matches). Reconstruct averages
    // +20% damage over the 3-attack cycle.
    "Understand, Deconstruct, Reconstruct": function (T, ctx) {
      var marks = Math.min(N(T, "alchemy_marks", 10), 10);
      var buffUptime = Math.min(1, 10 / (3 * ctx.spa));  // 10s buff / 3-attack cycle
      var dmg = 0.05 * marks * buffUptime * 0.5 + 0.20 / 3;
      return { dmg: dmg, notes: ["Alchemy cycle: Reconstruct +20% on 1 of 3 attacks; " +
        "Deconstruct " + marks + " marks x5% at " + Math.round(buffUptime * 100) +
        "% uptime (self included)"] };
    },
    // Max-marked enemies skip Understand -> the 120% Reconstruct lands on
    // 2 of 3 attacks instead of 1 of 3 (steady state after ramp-up).
    "Already Understood": function (T) {
      return { dmg: 0.20 / 3,
        notes: ["Already Understood: max-marked enemies skip Understand, Reconstruct on 2 of 3 attacks"] };
    },
    // Team-composition dependent (DoT majority / no majority). The no-DoT
    // branch (+3 mark capacity, extra mark) is the self-buff branch we
    // model at the standard conditional uptime.
    "Alchemist’s Judgement": function (T) {
      var u = UP(T, "alchemy_judgement_uptime", 30);
      var dmg = 0.15 * u;   // +3 marks x5% on the capped Deconstruct buff
      return { dmg: dmg, notes: ["Alchemist's Judgement: no-DoT team branch (+3 mark capacity) at " +
        Math.round(u * 100) + "% uptime (team-dependent)"] };
    }
  });
  A.registerUnitVars("Alchemy Brothers (Truth)", [
    V("alchemy_marks", "AlchemyMark stacks", "Marks on the target feeding Deconstruct - default 10 (cap)", 0, 10, 10),
    V("alchemy_judgement_uptime", "Judgement uptime %", "Share of time the +3-capacity team branch is active - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== ATOM (TOTALITY) ====================== */
  A.registerPassives("Atom (Totality)", {
    // +15% dmg vs Basic, +40% crit vs Elite, +10% range/+20% crit dmg vs
    // Boss. Conditional on enemy type -> share of play time per archetype
    // (defaults: basic 68% / elite 25% / boss 7%).
    "Archetype Nuclear": function (T) {
      var ub = UP(T, "atom_basic_uptime", 68);
      var ue = UP(T, "atom_elite_uptime", 22);
      var uboss = UP(T, "atom_boss_uptime", 7);
      return { dmg: 0.15 * ub, cc: 40 * ue, cd: 20 * uboss,
        notes: ["Archetype Nuclear: +15% vs Basic at " + Math.round(ub * 100) +
        "%, +40% crit vs Elite at " + Math.round(ue * 100) + "%, +20% crit dmg vs Boss at " +
        Math.round(uboss * 100) + "% of play time"] };
    },
    // Boss in range: +100% damage dealt to it for 10s, then a 300% nuke
    // on the Boss (60s per-player CD) - single-target counted.
    "Phantom Nuclear": function (T) {
      var u = UP(T, "atom_boss_uptime", 7);
      var dmg = 1.00 * u;
      var extra = 3.00 / 60 * u;
      return { dmg: dmg, extra: extra,
        notes: ["Phantom Nuclear: +100% vs Boss at " + Math.round(u * 100) +
        "% uptime (default 7% = boss share of play time), 300% nuke / 60s"] };
    },
    // Radiation DoT: 10% of damage, 7 ticks / 14s (= 0.5%/s per target),
    // refreshed and +20% factor per basic attack on the same enemy
    // (cap +100%). Steady state assumes the cap on the main target.
    "Rising Nuclear": function (T) {
      var n = N(T, "atom_radiation_targets", 1);
      var extra = 0.10 / 14 * 2 * n;   // 10% over 14s, x2 at +100% factor
      return { extra: extra, notes: ["Radiation: 10% dmg / 14s x2 (max factor) on " +
        n + " enemy(s) (estimated)"] };
    },
    // Ability: charges 8s, hits every enemy on the map for 500% + 10% per
    // removed Radiation stack (cap +500%) -> avg ~750% per cast, single
    // target counted. extra = power / cooldown seconds.
    "Complete Nuclear": function (T) {
      var cd = Math.max(N(T, "atom_ability_cd", 300), 10);
      var extra = 7.50 / cd;
      return { extra: extra, notes: ["Complete Nuclear: ~750% map-wide nuke every ~" +
        cd + "s (estimated cadence, single-target counted)"] };
    }
  });
  A.registerUnitVars("Atom (Totality)", [
    V("atom_basic_uptime", "Basic uptime %", "Share of play time vs Basic enemies (+15% dmg) - default 68%", 0, 100, 68, 5),
    V("atom_elite_uptime", "Elite uptime %", "Share of play time vs Elite enemies (+40% crit) - default 22%", 0, 100, 22, 5),
    V("atom_boss_uptime", "Boss uptime %", "Share of play time vs a Boss (+20% crit dmg, Phantom Nuclear) - default 7%", 0, 100, 7, 5),
    V("atom_radiation_targets", "Radiation targets", "Enemies kept Irradiated - default 1 (estimated)", 0, 10, 1),
    V("atom_ability_cd", "Ability cooldown s", "Seconds between Complete Nuclear casts - default 300 (estimated)", 10, 600, 300, 10)
  ]);

  /* ====================== BIOINSECT (FINAL FORM) ====================== */
  // The game data ships 0 base damage at every level: all of this unit's
  // damage comes from Genetic Code copying a % of the strongest unit in
  // range. The app resolves the source (portrait picker, default = top-DPS
  // unit) and injects source max-upgrade damage x % as ctx.leechDamage;
  // toggling Genetic Code off removes the copied damage (DPS 0 again).
  A.registerNoDps("Bioinsect (Final Form)", ["Passive Absorption"]);
  A.registerPassives("Bioinsect (Final Form)", {
    // Damage layer is handled through ctx.leechDamage (see calculator.js):
    // this model only documents the assumption in the notes.
    "Genetic Code": function (T) {
      var pct = N(T, "bioinsect_leech", 50);
      return { notes: ["Genetic Code: copies " + pct + "% of the strongest " +
        "unit's base damage (source picked in Variables; this unit's own " +
        "damage is 0 in the game data). Turn the passive off to drop it."] };
    }
  });
  A.registerUnitVars("Bioinsect (Final Form)", [
    V("bioinsect_leech", "Leech %", "Share of the source unit's base damage copied by Genetic Code - default 50", 0, 100, 50, 5)
  ]);

  /* ====================== BLACK HEART (REVIVED) ====================== */
  A.registerNoDps("Black Heart (Revived)", ["Accustomed View", "Rise From The Ash"]);
  A.registerPassives("Black Heart (Revived)", {
    // On attack: extra Skill3 hit at 50% damage (5s CD); Oppression makes
    // enemies take +10% damage (applied when hitting out of range - the
    // steady-state assumption is that the marked target is in the loop).
    "Way Without Enemies": function (T) {
      var extra = 0.50 / 5;
      var u = UP(T, "ulquiorra_oppression_uptime", 30);
      return { extra: extra, dmg: 0.10 * u,
        notes: ["Way Without Enemies: 50% follow-up every 5s; Oppression +10% at " +
        Math.round(u * 100) + "% uptime"] };
    },
    // Transforms: +65% damage, permanent after activation (no timer given).
    "Second Stage": function (T) {
      var u = UP(T, "ulquiorra_ability_uptime", 100);
      return { dmg: 0.65 * u,
        notes: ["Second Stage transformation: +65% damage at " + Math.round(u * 100) + "% uptime"] };
    }
  });
  A.registerUnitVars("Black Heart (Revived)", [
    V("ulquiorra_oppression_uptime", "Oppression uptime %", "Share of time attacking Oppressed enemies - default 30%", 0, 100, 30, 5),
    V("ulquiorra_ability_uptime", "Transformation uptime %", "Time in UlquiorraTransformation - default 100% (no timer in description)", 0, 100, 100, 5)
  ]);

  /* ====================== CARROT (UNLEASHED) ====================== */
  A.registerPassives("Carrot (Unleashed)", {
    // Every 3 non-crits -> next attack guaranteed crit: over a cycle of 4
    // attacks (3 normal + 1 forced) the expected crit count is 1 + the
    // natural crits on the first 3. With base cc this is modeled as a
    // flat cc increase to reach ~25%+ effective crits.
    "Battle Instinct": function (T, ctx) {
      var forced = 0.25;   // 1 guaranteed crit per 4 attacks
      var eff = Math.max(0, forced * 100 - ctx.cc);
      return { cc: eff, notes: ["Battle Instinct: 1 forced crit / 4 attacks (effective ~25%)"] };
    },
    // Meter: +10 per crit, +20 when debuffed; at 30 -> transformation
    // (+15% dmg, +20% crit dmg), meter drains 1/2s while transformed.
    // Cycle average via duty-cycle variable.
    "Limitless Warrior": function (T) {
      var u = UP(T, "goku_transform_uptime", 30);
      return { dmg: 0.15 * u, cd: 20 * u,
        notes: ["Limitless Warrior: transformation at " + Math.round(u * 100) +
        "% duty cycle (+15% dmg, +20% crit dmg)"] };
    },
    // Relocate: 75% follow-up; to a position: +50% damage for 15s.
    "Instant Relocation": function (T) {
      var u = UP(T, "goku_ability_uptime", 30);
      var extra = 0.75 * N(T, "goku_ability_ppm", 2) / 60;
      return { dmg: 0.50 * u, extra: extra,
        notes: ["Instant Relocation: +50% dmg / 15s at " + Math.round(u * 100) +
        "% uptime, 75% follow-up " + N(T, "goku_ability_ppm", 2) + "/min (estimated)"] };
    }
  });
  A.registerUnitVars("Carrot (Unleashed)", [
    V("goku_transform_uptime", "Transformation uptime %", "Duty cycle of GokuTransformation - default 30%", 0, 100, 30, 5),
    V("goku_ability_uptime", "Relocate buff uptime %", "Share of time with the +50% damage relocate buff - default 30%", 0, 100, 30, 5),
    V("goku_ability_ppm", "Relocations / min", "Instant Relocation activations per minute - default 2 (estimated)", 0, 30, 2)
  ]);

  /* ====================== CRIMSON (BROTHER) ====================== */
  A.registerPassives("Crimson (Brother)", {
    // On attack: mark explodes after 5s for 15% of this unit's damage.
    // Single target: the attacked enemy carries the mark.
    "Crimson Explosion": function (T, ctx) {
      var extra = 0.15 / 5;
      return { extra: extra, notes: ["Crimson Explosion: 15% on the " +
        "attacked enemy / 5s (single target)"] };
    },
    // Each explosion leaves a pool (cap 3) burning enemies for 10% / 2s.
    "Crimson Pool": function (T) {
      var n = N(T, "choso_pool_targets", 1);
      var extra = 0.10 * n / 2;
      return { extra: extra, notes: ["Crimson Pool: 10% / 2s on " + n +
        " enemy standing in a pool (cap 3, estimated)"] };
    },
    // Ability: 10s field, 75% damage per 1s; this unit does not attack
    // while active (duty cycle variable, attacks replaced by the field).
    "Piercing Crimson": function (T, ctx) {
      var u = UP(T, "choso_ability_uptime", 10);
      var extra = 0.75 * u;
      return { extra: extra, spa: 1 / Math.max(0.01, 1 - u),   // attacks lost while channeling
        notes: ["Piercing Crimson: 75% dmg/s field at " + Math.round(u * 100) +
        "% uptime (~10s field per ~100s, estimated), attacks paused while active"] };
    }
  });
  A.registerUnitVars("Crimson (Brother)", [
    V("choso_pool_targets", "Pool targets", "Enemy standing in Crimson Pools - default 1 (estimated)", 0, 10, 1),
    V("choso_ability_uptime", "Ability uptime %", "Share of time channeling Piercing Crimson - default 10% (estimated ~10s per 100s)", 0, 100, 10, 5)
  ]);

  /* ====================== FORBIDDEN TEACHER ====================== */
  A.registerPassives("Forbidden Teacher", {
    // +5% damage buff to all Magical units in range per level. This unit
    // is Magical and stands in its own range (self included). 6 levels
    // (deploy + 5 upgrades) -> +30%.
    "Teacher Blessing": function () {
      return { dmg: 0.30, notes: ["Teacher Blessing: +5% x 6 levels to Magical units in range (self included)"] };
    }
  });

  /* ====================== GREED ====================== */
  A.registerPassives("Greed", {
    // +20% damage vs Boss: conditional -> uptime variable.
    "Fox Hunt": function (T) {
      var u = UP(T, "ban_boss_uptime", 7);
      return { dmg: 0.20 * u, notes: ["Fox Hunt: +20% vs Boss at " + Math.round(u * 100) + "% uptime"] };
    }
  });
  A.registerUnitVars("Greed", [
    V("ban_boss_uptime", "Boss uptime %", "Share of time fighting a Boss - default 7%", 0, 100, 7, 5)
  ]);

  /* ====================== ICE QUEEN ====================== */
  A.registerPassives("Ice Queen", {
    // +20% damage to enemies below 20% health: execute window -> uptime.
    "Soul Rend": function (T) {
      var u = UP(T, "rukia_execute_uptime", 30);
      return { dmg: 0.20 * u, notes: ["Soul Rend: +20% vs enemies below 20% HP at " +
        Math.round(u * 100) + "% uptime"] };
    }
  });
  A.registerUnitVars("Ice Queen", [
    V("rukia_execute_uptime", "Execute uptime %", "Share of time enemies are below 20% HP - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== SCISSOR ====================== */
  A.registerPassives("Scissor", {
    // +5% per consecutive attack on the same enemy, cap +20%: steady
    // state assumes the cap on the primary target.
    "Stacking Cuts": function () {
      return { dmg: 0.20, notes: ["Stacking Cuts: steady state at the +20% cap"] };
    }
  });

  /* ====================== SALMON SORCERER (GRADE 1) ====================== */
  A.registerNoDps("Salmon Sorcerer (Grade 1)", ["Crumble Away", "Plummet"]);

  /* ====================== WATER PRINCESS ====================== */
  A.registerNoDps("Water Princess", ["Sea Dragon Shield"]);

  /* ====================== CRIMSON CAPTAIN (MOON) ====================== */
  A.registerPassives("Crimson Captain (Moon)", {
    // +10% dmg from FireElement units vs Scorched enemies (this unit is
    // Flame) + up to +25% per FireElement unit / unique FireDoT stack.
    "Scorched Earth": function (T) {
      var u = UP(T, "rei_scorched_uptime", 25);
      var stacks = Math.min(N(T, "rei_fire_sources", 2), 5);
      return { dmg: 0.10 * u + 0.05 * stacks,
        notes: ["Scorched Earth: +10% vs Scorched at " + Math.round(u * 100) +
        "% uptime; " + stacks + "/5 Fire sources (+25% cap)"] };
    },
    // Per max-Scorched enemy in range: +5% crit damage (cap 50%).
    "Absolute Flames": function (T) {
      var n = Math.min(N(T, "rei_max_scorched", 5), 10);
      return { cd: 5 * n, notes: ["Absolute Flames: " + n +
        " enemy(s) at max Scorched stacks (+5% crit dmg each, cap 50%)"] };
    },
    // Banner every 10s (cap 5, permanent): each deals 15% dmg / SPA 5 and
    // applies its own FireDoT; after 5, base summons deal 20% on pass-by.
    // Single-target: banners mostly strike other enemies -> 1 banner and
    // 1 FireDoT on the primary at the standard uptime share.
    "Fiery Banner": function (T) {
      var banners = Math.min(N(T, "rei_banners", 1), 5);
      var dots = N(T, "rei_banner_dot_targets", 1);
      var dotU = UP(T, "rei_banner_dot_uptime", 15);
      var pass = N(T, "rei_summon_pass", 0);
      // Banner attacks strike a random enemy in its (75%) range: 50%
      // primary share, single-target convention.
      var extra = banners * 0.15 / 5 * 0.5 + dots * 0.5 / 4 * dotU + pass * 0.20 / 6;
      return { extra: extra, notes: ["Fiery Banner: " + banners +
        " banner x15%/5s on the primary, FireDoT on " + dots + " enemy at " +
        Math.round(dotU * 100) + "% uptime, base summons " +
        pass + " pass-through hits/min (estimated)"] };
    },
    // Ability: 250% nuke to the target + Fire (100% total) on it.
    "Seventh Form, Wheel of the Sun": function (T) {
      var cd = Math.max(N(T, "rei_ability_cd", 150), 10);
      var extra = (2.50 + 1.00) / cd;
      return { extra: extra, notes: ["Seventh Form: 250% + Fire100%, " +
        "every ~" + cd + "s (estimated cadence, single target)"] };
    }
  });
  A.registerUnitVars("Crimson Captain (Moon)", [
    V("rei_scorched_uptime", "Scorched uptime %", "Share of time enemies are Scorched - default 25%", 0, 100, 25, 5),
    V("rei_fire_sources", "Fire sources", "FireElement units / unique FireDoTs in range (cap 5) - default 2", 0, 5, 2),
    V("rei_max_scorched", "Max-Scorched enemies", "Enemies at 10 stacks in range (+5% crit dmg each) - default 2", 0, 10, 2),
    V("rei_banners", "Banners on primary", "FireBanners striking the primary target (cap 5) - default 1 (estimated)", 0, 5, 1),
    V("rei_banner_dot_targets", "Banner FireDoT targets", "Enemies burning from banner Fire - default 1 (estimated)", 0, 10, 1),
    V("rei_banner_dot_uptime", "Banner Fire uptime %", "Share of time the primary burns from banner Fire - default 15%", 0, 100, 15, 5),
    V("rei_summon_pass", "Summon passes / min", "Base FireBanner summons passing enemies - default 0 (estimated)", 0, 30, 0),
    V("rei_ability_cd", "Ability cooldown s", "Seconds between Seventh Form casts - default 150 (estimated)", 10, 600, 150, 10)
  ]);

  /* ====================== CROW (BLACK FIRE) ====================== */
  A.registerNoDps("Crow (Black Fire)", ["Crow's Illusion"]);
  A.registerPassives("Crow (Black Fire)", {
    // Stored damage on an illusioned enemy is released at 25% on expiry
    // (12s cycle): 25% x (damage dealt to it over 12s) / 12s. Single
    // target: only the illusion on the attacked enemy counts.
    "Broken Mind": function (T, ctx) {
      var extra = 0.25 / ctx.spa;
      return { extra: extra, notes: ["Broken Mind: 25% of stored damage " +
        "released per cycle on the attacked enemy (single target)"] };
    },
    // BlackFire DoT (status data: 2x damage total over 12s per stack),
    // applied by this unit's attacks - uptime variable (refresh window
    // vs attack cadence, default 30% per site convention).
    "Searing Flames": function (T) {
      var u = UP(T, "itachi_blackfire_uptime", 30);
      var extra = 2.0 / 12 * u;
      return { extra: extra, notes: ["BlackFire: 2x damage / 12s at " +
        Math.round(u * 100) + "% uptime on the attacked enemy (status data)"] };
    }
  });
  A.registerUnitVars("Crow (Black Fire)", [
    V("itachi_blackfire_uptime", "BlackFire uptime %", "Share of time the attacked enemy burns - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== CUBERT ====================== */
  A.registerNoDps("Cubert", ["Cube Summon"]);
  A.registerPassives("Cubert", {
    // KhunCubes (cap 2) deal 35% of this unit's damage per attack; charge
    // gained every 10s (capacity 2) gates cube strikes, so across both
    // cubes that is one 35% strike per charge cycle.
    "Cubes": function (T) {
      var cubes = Math.min(N(T, "khun_cubes", 2), 2);
      var extra = cubes * 0.35 / 20 * UP(T, "khun_cube_uptime", 100);
      return { extra: extra, notes: ["Cubes: " + cubes +
        " KhunCube(s), 35% strike each ~20s (1 charge / 10s shared)"] };
    },
    // Attached cubes: +5% damage / +2.5% range each (assumed to buff this
    // unit; description is ambiguous about the target).
    "Cube Link": function (T) {
      var n = Math.min(N(T, "khun_attached", 2), 2);
      return { dmg: 0.05 * n, notes: ["Cube Link: " + n +
        " attached cube(s) x+5% damage (assumed self-included)"] };
    },
    // Every 3 of this unit's attacks: cube explodes for 15% + stun.
    "Cube Overload": function (T, ctx) {
      var extra = 0.15 / (3 * ctx.spa);
      return { extra: extra, notes: ["Cube Overload: 15% explosion every 3 attacks"] };
    }
  });
  A.registerUnitVars("Cubert", [
    V("khun_cubes", "KhunCubes active", "Cubes attacking (cap 2) - default 2", 0, 2, 2),
    V("khun_cube_uptime", "Cube uptime %", "Share of time cubes are attacking - default 100%", 0, 100, 100, 5),
    V("khun_attached", "Attached cubes", "Cubes attached to this unit (+5% dmg each) - default 2", 0, 2, 2)
  ]);

  /* ====================== CURSED IMMORTAL (BLACK SUN) ====================== */
  A.registerPassives("Cursed Immortal (Black Sun)", {
    // Walking aura unit: no projectile attack - deals aura tick damage
    // instead. Damage comes from the Reckless Control states; estimated.
    "Wandering Death": function (T, ctx) {
      // baseline = the unit's own attack loop (SPA 2.05) hitting the aura
      var extra = 0;
      return { extra: extra, notes: ["Wandering Death: aura damage modeled " +
        "through Reckless Control states (estimated)"] };
    },
    // Caring state: 50% dmg in 50% range; Cold state: 125% dmg in 25%
    // range. State shares averaged over the walk cycle (estimated).
    "Reckless Control": function (T) {
      var cold = UP(T, "zeref_cold_share", 50);
      var caring = 1 - cold;
      // smaller range in Cold state -> fewer targets hit
      var dmg = caring * 0.50 + cold * 1.25;
      var rangeShare = caring * 0.50 + cold * 0.25;
      var targets = Math.max(1, Math.round(EN(T) * rangeShare));
      return { dmg: dmg - 1,   // multiplicative layer (can be negative)
        notes: ["Reckless Control: " + Math.round(cold * 100) +
        "% Cold (125% dmg, 25% range) / " + Math.round(caring * 100) +
        "% Caring (50% dmg, 50% range), ~" + targets + " target(s) hit (estimated)"] };
    },
    // +5% crit chance per state change (cap 30%) - changes are frequent
    // in sustained combat, modeled at a configurable share of the cap.
    "State of Critical Mass": function (T) {
      var u = UP(T, "zeref_critmass", 60);
      return { cc: 30 * u, notes: ["State of Critical Mass: " +
        Math.round(u * 100) + "% of the +30% crit cap (state changes)"] };
    }
  });
  A.registerUnitVars("Cursed Immortal (Black Sun)", [
    V("zeref_cold_share", "Cold state %", "Share of the walk cycle in Cold state (125% dmg, 25% range) - default 50% (estimated)", 0, 100, 50, 5),
    V("zeref_critmass", "Crit-stacks progress %", "Progress toward the +30% crit cap from state changes - default 60%", 0, 100, 60, 5)
  ]);

  /* ====================== CURSED STUDENT (TRUE LOVE) ====================== */
  A.registerPassives("Cursed Student (True Love)", {
    // Every 3rd attack: follow-up at 100% of this unit's damage + 40% of
    // the closest unit's (increases +20% per "New Attack" - modeled at
    // the base value, stacking capped by a variable).
    "Cursed Mimicry": function (T, ctx) {
      var ally = N(T, "yuuta_ally_dmg", 100) / 100;   // ally dmg as % of own
      var bonus = N(T, "yuuta_mimic_bonus", 40) / 100;
      var extra = (1.00 + ally * bonus) / (3 * ctx.spa);
      return { extra: extra, notes: ["Cursed Mimicry: follow-up every 3 " +
        "attacks (100% own + " + Math.round(bonus * 100) + "% of closest unit at " +
        ally * 100 + "% of own damage)"] };
    },
    // Every 20 Bleed stacks in range -> YutaBatSpirit (cap 3), 15% of this
    // unit's damage per attack, SPA 10, despawns after 3 attacks.
    "Spirit Bats": function (T) {
      var bats = Math.min(N(T, "yuuta_bats", 2), 3);
      var u = UP(T, "yuuta_bat_uptime", 40);
      var extra = bats * 0.15 / 10 * u;
      return { extra: extra, notes: ["Spirit Bats: " + bats +
        " bat(s) x15% / 10s at " + Math.round(u * 100) +
        "% uptime (needs 20 Bleed stacks, estimated)"] };
    }
  });
  A.registerUnitVars("Cursed Student (True Love)", [
    V("yuuta_ally_dmg", "Closest unit damage %", "Closest unit's damage as % of this unit's - default 100", 0, 300, 100, 10),
    V("yuuta_mimic_bonus", "Mimicry bonus %", "Follow-up share of the ally's damage (desc: +20% per new attack) - default 40", 0, 200, 40, 10),
    V("yuuta_bats", "Bat Spirits active", "Bats summoned (cap 3, 1 per 20 Bleed stacks) - default 2", 0, 3, 2),
    V("yuuta_bat_uptime", "Bat uptime %", "Share of time bats are attacking - default 40% (estimated)", 0, 100, 40, 5)
  ]);

  /* ====================== DARK MAGE (SOVEREIGN) ====================== */
  A.registerNoDps("Dark Mage (Sovereign)", ["Magic Cycle"]);
  A.registerPassives("Dark Mage (Sovereign)", {
    // On switching to Lightning (every ~10 attacks): Arc of Lightning on
    // the path; touching enemies take 25% per second while it is up.
    "Lightning Orbs": function (T) {
      var u = UP(T, "darkmage_arc_uptime", 30);
      var n = N(T, "darkmage_arc_targets", 1);
      var extra = 0.25 * n * u;
      return { extra: extra, notes: ["Lightning Orbs: Arc 25% dmg/s on " +
        n + " enemy(s) at " + Math.round(u * 100) + "% uptime (estimated)"] };
    },
    // At 20 JudarMeter stacks: next attack shatters for +10% AoE. Meter
    // fills 1 stack per enemy hit on Ice attacks.
    "Ice Barrage": function (T, ctx) {
      var ppm = N(T, "darkmage_shatter_ppm", 3);
      var extra = 0.10 * ppm / 60;
      return { extra: extra, notes: ["Ice Barrage: +10% shatter AoE, " +
        ppm + "/min (estimated)"] };
    }
  });
  A.registerUnitVars("Dark Mage (Sovereign)", [
    V("darkmage_arc_uptime", "Arc uptime %", "Share of time the Lightning Arc is active - default 30%", 0, 100, 30, 5),
    V("darkmage_arc_targets", "Arc targets", "Enemies touching the Arc - default 1 (estimated)", 0, 10, 1),
    V("darkmage_shatter_ppm", "Shatters / min", "Ice Barrage shatter procs per minute - default 3 (estimated)", 0, 30, 3)
  ]);

  /* ====================== DEAD MELODY (SOLO) ====================== */
  A.registerPassives("Dead Melody (Solo)", {
    // Buff aura: +15% dmg/+5% range to units WITH the Unbound trait in
    // range, +30%/+10% to units WITHOUT it (this unit's own trait decides
    // its share when the emitter is assumed inside its own range).
    // BrookCaptain (+20% cc / +25% cd) is assumed to be another unit by
    // default (toggle in Variables).
    "Seafarer Quintet": function (T, ctx) {
      var selfUnbound = (ctx && ctx.trait === "Unbound");
      var dmg = selfUnbound ? 0.15 : 0.30;
      var cc = 0, cd = 0;
      if (N(T, "brook_captain_self", 0) >= 50) { cc = 20; cd = 25; }
      return { dmg: dmg, cc: cc, cd: cd,
        notes: ["Seafarer Quintet: " + (selfUnbound ? "+15% (Unbound trait)" : "+30%") +
        " to units in range (self included); BrookCaptain " +
        (cc ? "self (assumed)" : "another unit (assumed)")] };
    },
    // Melody choice (variable): Melody1 = self +35% dmg / +100% cc /
    // +15% cd + DeepFreeze (best own DPS, default); Melody2 = stops
    // attacking and only buffs others (own DPS = 0).
    "Ever-Travelling Superstar": function (T) {
      var m = N(T, "brook_melody", 1);
      if (m !== 1) {
        return { dmg: 0, spa: 999, notes: ["Melody2 selected: this unit " +
          "stops attacking (own DPS 0, buffs others only)"] };
      }
      return { dmg: 0.35, cc: 100, cd: 15,
        notes: ["Melody1 selected (best own DPS): +35% dmg, +100% crit " +
        "chance, +15% crit dmg, DeepFreeze on attack"] };
    },
    // On attack: follow-up area (lingers 8s, DeepFreeze). Attacking a
    // DeepFreeze enemy (guaranteed under Melody1) adds a 30% instance.
    "Afterlife Channeling": function (T, ctx) {
      var m = N(T, "brook_melody", 1);
      if (m !== 1) return { mult: 1, notes: ["Afterlife: no attack under Melody2"] };
      return { mult: 1.30, notes: ["Afterlife Channeling: +30% instance " +
        "per attack vs DeepFreeze targets (steady state under Melody1)"] };
    }
  });
  A.registerUnitVars("Dead Melody (Solo)", [
    V("brook_melody", "Melody (1 = self / 2 = team)", "1 = BrookMelody1 self buff (best own DPS, default) / 2 = BrookMelody2 team buff, unit stops attacking", 1, 2, 1),
    V("brook_captain_self", "BrookCaptain is self %", "Whether this unit counts as its own BrookCaptain (+20% cc / +25% cd) - default 0 (assumed another unit)", 0, 100, 0, 10)
  ]);

  /* ====================== DEVIL (HERO) ====================== */
  A.registerPassives("Devil (Hero)", {
    // DemonHead every 20s for 10s: +10% damage to enemies inside and
    // attacks apply EnhancedBurn (75% total over 4s while active).
    "Horned Fire Ball": function (T) {
      var u = UP(T, "shinra_head_uptime", 50);
      var n = N(T, "shinra_head_targets", 1);
      var extra = 0.75 / 4 * n * u;
      return { dmg: 0.10 * u, extra: extra,
        notes: ["Horned Fire Ball: DemonHead " + Math.round(u * 100) +
        "% uptime (+10% dmg, EnhancedBurn 75%/4s on " + n + " enemy)"] };
    },
    // +1% SPA reduction per DemonMeter stack (cap 20) while a head is
    // active -> up to -20% SPA at the cap.
    "Horns Fire Charge": function (T) {
      var u = UP(T, "shinra_meter_uptime", 20);
      return { spa: -0.20 * u, notes: ["Horns Fire Charge: meter at cap " +
        "(-20% SPA) for " + Math.round(u * 100) + "% of the time (estimated)"] };
    },
    // On head expiry: detonate 50% of stored EnhancedBurn; at meter cap:
    // +15% extra hit and reset.
    "Horned Fire Bite": function (T, ctx) {
      var u = UP(T, "shinra_head_uptime", 50);
      var n = N(T, "shinra_head_targets", 1);
      var extra = 0.50 * (0.75 * (10 / ctx.spa)) * n / 20 + 0.15 / 20;
      return { extra: extra, notes: ["Horned Fire Bite: detonation of " +
        "stored burn each head expiry + 15% hit per meter cap (estimated)"] };
    }
  });
  A.registerUnitVars("Devil (Hero)", [
    V("shinra_head_uptime", "DemonHead uptime %", "Share of time DemonHead is active (10s / 20s) - default 50%", 0, 100, 50, 5),
    V("shinra_head_targets", "DemonHead targets", "Enemies inside the DemonHead radius - default 1 (single-target view)", 0, 10, 1),
    V("shinra_meter_uptime", "Meter-cap uptime %", "Share of time DemonMeter is at 20 (-20% SPA) - default 20% (estimated)", 0, 100, 20, 5)
  ]);

  /* ====================== ECLIPSE HUNTER (SAVIOR) ====================== */
  A.registerNoDps("Eclipse Hunter (Savior)", ["Sacrificial Brand Denier", "The King"]);
  A.registerPassives("Eclipse Hunter (Savior)", {
    // If the selected unit is weaker -> this unit +15% dmg; otherwise the
    // selected unit is buffed (no effect here). Conditional -> uptime var.
    "Savior": function (T) {
      var u = UP(T, "eclipse_savior_self", 30);
      return { dmg: 0.15 * u, notes: ["Savior: self-buff branch (+15%) at " +
        Math.round(u * 100) + "% of placements (else the ally is buffed)"] };
    }
  });
  A.registerUnitVars("Eclipse Hunter (Savior)", [
    V("eclipse_savior_self", "Self-buff branch %", "Share of placements where the selected unit is weaker (this unit gets +15%) - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== ELF MAGE (UNLEASHED) ====================== */
  A.registerNoDps("Elf Mage (Unleashed)", ["Arcane Magic"]);
  A.registerPassives("Elf Mage (Unleashed)", {
    // On each charge reset: +5% damage on the spell casts (cap 5 = +25%).
    "Overcharge": function (T) {
      var n = Math.min(N(T, "frieren_overcharge", 5), 5);
      return { notes: ["Overcharge: spells +" + (5 * n) +
        "% after " + n + " resets (affects the Arcane Spells casts)"] };
    },
    // At 3 / 5 / 7 charges: follow-up cast at 100% damage (3 casts per
    // 7-attack cycle), +25% from Overcharge at the cap.
    "Arcane Spells": function (T, ctx) {
      var bonus = 1 + 0.05 * Math.min(N(T, "frieren_overcharge", 5), 5);
      var extra = 3 * 1.00 * bonus / (7 * ctx.spa);
      return { extra: extra, notes: ["Arcane Spells: 3 casts / 7 attacks " +
        "x100% x" + bonus.toFixed(2) + " (Voltraak / Vhalzanbel / Jundrathym)"] };
    }
  });
  A.registerUnitVars("Elf Mage (Unleashed)", [
    V("frieren_overcharge", "Overcharge stacks", "Resets banked for +5% per spell cast (cap 5) - default 5", 0, 5, 5)
  ]);

  /* ====================== EMERALD FIST ====================== */
  A.registerPassives("Emerald Fist", {
    // +35% SPA from training weights - active except during Gate 3
    // (which disables this passive).
    "Ankle Weights": function (T) {
      var gate3 = UP(T, "lee_gate3", 30);
      var spa = 0.35 * (1 - gate3);
      return { spa: spa, notes: ["Ankle Weights: +35% SPA outside Gate3 " +
        "(" + Math.round((1 - gate3) * 100) + "% of the time)"] };
    },
    // Gate cycle (every 20s a new limit): Gate1 = 350% nuke + 5s self-stun,
    // Gate2 = +50% dmg / 30s, Gate3+4 = -50% SPA & +150% dmg with attack
    // degradation, then 10s self-stun. Duty shares via variables.
    "Inner Limits": function (T, ctx) {
      var g1 = UP(T, "lee_gate1", 25);
      var g2 = UP(T, "lee_gate2", 25);
      var g3 = UP(T, "lee_gate3", 30);
      // Gate1 nuke: 350% every 20s (5s stun halves uptime -> ~1/min)
      var extra = 3.50 * g1 * 60 / 20 / 60;
      // Gate2 damage layer; Gate3 damage layer (avg of 10 degrading hits:
      // +150% decaying -5%/hit -> avg ~+127%)
      var dmg = g2 * 0.50 + g3 * 1.27;
      // SPA: weights off in Gate3 and Gate3 is -50% vs base
      var spa = 0.35 * (1 - g3) + g3 * (-0.50);
      return { dmg: dmg, spa: spa, extra: extra,
        notes: ["Inner Limits cycle: Gate1 " + Math.round(g1 * 100) +
        "% (350% nuke/20s), Gate2 " + Math.round(g2 * 100) + "% (+50% dmg), " +
        "Gate3 " + Math.round(g3 * 100) + "% (+150% dmg, -50% SPA, attack " +
        "degradation); self-stuns included in shares (estimated)"] };
    }
  });
  A.registerUnitVars("Emerald Fist", [
    V("lee_gate1", "Gate 1 share %", "Share of the cycle in Gate 1 (350% nuke, 5s self-stun) - default 25%", 0, 100, 25, 5),
    V("lee_gate2", "Gate 2 share %", "Share of the cycle in Gate 2 (+50% dmg / 30s) - default 25%", 0, 100, 25, 5),
    V("lee_gate3", "Gate 3 share %", "Share of the cycle in Gate 3+4 (+150% dmg, -50% SPA) - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== FALLEN ANGEL (HOLY) ====================== */
  A.registerPassives("Fallen Angel (Holy)", {
    // TimeStop every 30s for 10s (1/3 uptime): during it this unit's
    // attacks apply Fire (0.5x total over 4s, +20% at full stacks).
    "Frozen Flames": function (T) {
      var u = UP(T, "mari_timestop_uptime", 33);
      var n = N(T, "mari_fire_targets", 1);
      var extra = 0.5 / 4 * 1.2 * n * u;
      return { extra: extra, notes: ["Frozen Flames: TimeStop " +
        Math.round(u * 100) + "% uptime (10s / 30s), Fire 0.5x/4s x1.2 on " +
        n + " enemy (status data)"] };
    },
    // Fire spreads to 3 enemies during TimeStop; when it ends they take
    // 15% of the damage dealt during TimeStop.
    "Flame Bonded": function (T, ctx) {
      var u = UP(T, "mari_timestop_uptime", 33);
      // 15% of the damage dealt during the 10s TimeStop, per 30s cycle
      var extra = 0.15 * 10 / 30 * u;
      return { extra: extra, notes: ["Flame Bonded: 15% of TimeStop " +
        "damage released on spread targets (estimated)"] };
    },
    // Kills during TimeStop -> FlameFeather stacks; next attack applies
    // that many Fire instances (0.5x each over 4s).
    "Idle Flames": function (T) {
      var f = N(T, "mari_feathers", 3);
      var extra = f * 0.5 / 4 * 4 / 30;   // burst every ~30s cycle
      return { extra: extra, notes: ["Idle Flames: " + f +
        " feather burst applying Fire every cycle (estimated)"] };
    }
  });
  A.registerUnitVars("Fallen Angel (Holy)", [
    V("mari_timestop_uptime", "TimeStop uptime %", "Share of time TimeStop is active (10s / 30s) - default 33%", 0, 100, 33, 5),
    V("mari_fire_targets", "Fire targets", "Enemies carrying this unit's Fire - default 1 (estimated)", 0, 10, 1),
    V("mari_feathers", "Feathers per burst", "FlameFeather stacks consumed per next attack - default 3 (estimated)", 0, 10, 3)
  ]);

  /* ====================== FIRST BLADE (STRONGEST) ====================== */
  A.registerPassives("First Blade (Strongest)", {
    // On cleanse: self +25% dmg / 45s (50% if cleansing KenpachiEVO);
    // allies +20% (others only). Local CD 2s - conditional on debuffs
    // being present -> uptime variable.
    "Can't Fear Your Own Sword": function (T) {
      var u = UP(T, "unohana_cleanse_uptime", 30);
      var kenp = N(T, "unohana_kenpachi", 0) >= 50;
      var self = (kenp ? 0.50 : 0.25) * u;
      return { dmg: self, notes: ["Cleanse buff: +" +
        Math.round((kenp ? 50 : 25)) + "% self / 45s at " +
        Math.round(u * 100) + "% uptime (needs debuffed allies; the +20% " +
        "team buff does not affect this unit)"] };
    },
    // With KenpachiEVO in range: switch skill, +10% dmg / +5% range.
    "Killers Not Dead": function (T) {
      var u = UP(T, "unohana_kenpachi_uptime", 20);
      return { dmg: 0.10 * u, notes: ["Killers Not Dead: +10% dmg with " +
        "KenpachiEVO in range at " + Math.round(u * 100) + "% uptime"] };
    },
    // When self is debuffed: next attack +25% and inflicts Liquefy
    // (50% of damage over 2s). Conditional -> uptime variable.
    "Eliminate From Heaven": function (T, ctx) {
      var u = UP(T, "unohana_liquefy_uptime", 20);
      var extra = 0.50 / 2 * u;
      return { dmg: 0.25 * u, extra: extra,
        notes: ["Eliminate From Heaven: +25% next attack and Liquefy " +
        "(50% / 2s) at " + Math.round(u * 100) + "% uptime"] };
    }
  });
  A.registerUnitVars("First Blade (Strongest)", [
    V("unohana_cleanse_uptime", "Cleanse uptime %", "Share of time a cleanse proc is active (45s buff, 2s CD) - default 30%", 0, 100, 30, 5),
    V("unohana_kenpachi", "Kenpachi cleansing %", "Chance the cleanse target is KenpachiEVO (doubles the self buff) - default 0%", 0, 100, 0, 10),
    V("unohana_kenpachi_uptime", "Kenpachi in range %", "Share of time KenpachiEVO is in range - default 20%", 0, 100, 20, 5),
    V("unohana_liquefy_uptime", "Liquefy uptime %", "Share of time the self-debuff branch is active - default 20%", 0, 100, 20, 5)
  ]);

  /* ====================== FLAME EMPEROR (REINCARNATE) ====================== */
  A.registerPassives("Flame Emperor (Reincarnate)", {
    // On applying Fire: spreads to more enemies without Fire. Single
    // target: only the spread instance that re-lands on the primary counts
    // (default 30% uptime share).
    "Wildfire": function (T) {
      var u = UP(T, "sabo_spread_uptime", 30);
      var extra = 0.5 / 4 * u;
      return { extra: extra, notes: ["Wildfire: Fire spread re-hits the " +
        "primary at " + Math.round(u * 100) + "% uptime (0.5x / 4s, status data)"] };
    },
    // Ability: summon SaboSummon on a path for a duration; enemies
    // passing through get Fire. Cadence variable (single target share).
    "Wall of Fire": function (T) {
      var u = UP(T, "sabo_wall_uptime", 30);
      var extra = 0.5 / 4 * u;
      return { extra: extra, notes: ["Wall of Fire: primary passes the " +
        "wall at " + Math.round(u * 100) + "% uptime (0.5x / 4s)"] };
    }
  });
  A.registerUnitVars("Flame Emperor (Reincarnate)", [
    V("sabo_spread_uptime", "Spread uptime %", "Share of time the spread Fire re-hits the primary - default 30%", 0, 100, 30, 5),
    V("sabo_wall_uptime", "Wall uptime %", "Share of time Wall of Fire burns the primary - default 30% (estimated)", 0, 100, 30, 5)
  ]);

  /* ====================== HEAD CAPTAIN (CHAR) ====================== */
  A.registerPassives("Head Captain (Char)", {
    // Fire stacks infinitely; each stack +5% Fire damage (cap +150%) on
    // the primary. Fire = 0.5x total over 4s (status data). Single target
    // with the standard DoT uptime share.
    "West": function (T) {
      var amp = N(T, "yama_fire_amp", 75) / 100;    // +75% by default
      var u = UP(T, "yama_fire_uptime", 20);
      var extra = 0.5 / 4 * (1 + amp) * u;
      return { extra: extra, notes: ["West: Fire 0.5x/4s x" +
        (1 + amp).toFixed(2) + " on the primary at " + Math.round(u * 100) +
        "% uptime (" + Math.round(amp * 100) + "% stacks, cap +150%)"] };
    },
    // Enemies entering range catch Fire (0.5x over 4s).
    "East": function (T) {
      var u = UP(T, "yama_enter_uptime", 15);
      var extra = 0.5 / 4 * u;
      return { extra: extra, notes: ["East: Fire on the primary when " +
        "entering at " + Math.round(u * 100) + "% uptime (estimated)"] };
    },
    // Takedown -> YamamotoSkeleton PathTrap (cap 3): 25% when touched,
    // explodes with Fire, and each skeleton gives +5% damage to this unit.
    "South": function (T) {
      var s = Math.min(N(T, "yama_skeletons", 1), 3);
      var touch = N(T, "yama_skeleton_touches", 1);
      return { dmg: 0.05 * s, extra: touch * 0.25 / 10,
        notes: ["South: " + s + "/3 skeletons (+5% dmg each), " +
        touch + " trap hit(s)/min on the primary (estimated); each hit also applies Fire"] };
    },
    // Ability: 200% to all in range + 100% split among them. Single
    // target: the 200% hit lands, split portion counted on the primary.
    "North": function (T) {
      var cd = Math.max(N(T, "yama_ability_cd", 150), 10);
      var extra = 2.50 / cd;
      return { extra: extra, notes: ["North: 200% + ~50% of the split " +
        "portion on the primary, every ~" + cd + "s (estimated cadence)"] };
    }
  });
  A.registerUnitVars("Head Captain (Char)", [
    V("yama_fire_amp", "Fire stack amp %", "Fire damage bonus from stacks - default +75% (cap +150%)", 0, 150, 75, 5),
    V("yama_fire_uptime", "Fire uptime %", "Share of time the primary burns from this unit's Fire - default 20%", 0, 100, 20, 5),
    V("yama_enter_uptime", "Entry uptime %", "Share of time enemies catch Fire on entry - default 15%", 0, 100, 15, 5),
    V("yama_skeletons", "Skeletons active", "YamamotoSkeletons alive (cap 3, +5% dmg each) - default 1 (needs takedowns)", 0, 3, 1),
    V("yama_skeleton_touches", "Skeleton hits / min", "Enemies touching the PathTraps per minute - default 1 (estimated)", 0, 30, 1),
    V("yama_ability_cd", "Ability cooldown s", "Seconds between North casts - default 150 (estimated)", 10, 600, 150, 10)
  ]);

  /* ====================== HOLLOW (BLAZE) ====================== */
  A.registerPassives("Hollow (Blaze)", {
    // Fire that stops ticking converts into one AustereFlames hit (65%,
    // non-stacking). Fire lasts 4s (status data).
    "Radial Flames": function (T) {
      var n = N(T, "gabimaru_fire_targets", 1);
      var u = UP(T, "gabimaru_austere", 50);
      var extra = 0.65 / 4 * n * u;
      return { extra: extra, notes: ["Radial Flames: 65% per Fire expiry " +
        "on " + n + " enemy at " + Math.round(u * 100) +
        "% share (AustereFlames does not stack - estimated)"] };
    },
    // Attacking an enemy that has Fire converts it into AustereFlames
    // (65%, non-stacking with the expiry trigger).
    "Attack Flames": function () {
      return { notes: ["Attack Flames: folded into the " +
        "AustereFlames share (single non-stacking 65% instance; toggle " +
        "the share variable in Radial Flames)"] };
    }
  });
  A.registerUnitVars("Hollow (Blaze)", [
    V("gabimaru_fire_targets", "Fire targets", "Enemies carrying Fire (AustereFuel) - default 1 (estimated)", 0, 10, 1),
    V("gabimaru_austere", "Austere share %", "Split of the single non-stacking 65% instance between the expiry / attack triggers - default 50%", 0, 100, 50, 5)
  ]);

  /* ====================== IGNITION COMMANDER (BETRAYAL) ====================== */
  A.registerNoDps("Ignition Commander (Betrayal)", ["Immovable"]);
  A.registerPassives("Ignition Commander (Betrayal)", {
    // +3% damage per HeatStack (cap 10 = +30%) on enemies in range; at
    // 10 stacks the enemy also catches Fire (0.5x / 4s).
    "Human Furnace": function (T) {
      var u = UP(T, "burns_heat_uptime", 20);
      var n = N(T, "burns_fire_targets", 1);
      return { dmg: 0.30 * u, extra: 0.5 / 4 * n * u,
        notes: ["Human Furnace: +30% (10 HeatStacks) at " +
        Math.round(u * 100) + "% uptime; Fire on " + n + " enemy(s)"] };
    },
    // Rewind proc: 75% to all in BurnsZone1 (15s CD); enemies at the heat
    // cap take +15% extra damage from this unit.
    "Ignition Release": function (T) {
      var u = UP(T, "burns_heat_uptime", 20);
      var ppm = N(T, "burns_release_ppm", 2);
      var extra = 0.75 * ppm / 60;
      return { dmg: 0.15 * u, extra: extra,
        notes: ["Ignition Release: 75% zone hit " + ppm +
        "/min; +15% vs heat-capped enemies at " + Math.round(u * 100) + "% uptime"] };
    }
  });
  A.registerUnitVars("Ignition Commander (Betrayal)", [
    V("burns_heat_uptime", "Heat uptime %", "Share of time enemies sit at 10 HeatStacks (+30% dmg) - default 20%", 0, 100, 20, 5),
    V("burns_fire_targets", "Fire targets", "Enemies ignited at heat cap - default 1 (estimated)", 0, 10, 1),
    V("burns_release_ppm", "Releases / min", "Ignition Release procs per minute (15s CD) - default 2 (estimated)", 0, 20, 2)
  ]);

  /* ====================== IMPALER (ULTIMATE) ====================== */
  A.registerPassives("Impaler (Ultimate)", {
    // Player-selected mode (variable, default = best own DPS: Piety).
    // Piety: -35% SPA, +50% dmg, Bleed 50%/6s (not Boss).
    // Obliteration: +35% SPA, +100% dmg, +20% range, Bleed 100%/12s
    // (not Basic) and a +50% damage clause vs applicable enemies.
    "Piety & Obliteration": function (T) {
      var mode = N(T, "alucard_mode", 1);
      var bleedU = UP(T, "alucard_bleed_uptime", 50);
      // The Bird of Hermes enhances own-sourced Bleed by +10%
      if (mode === 1) {
        var bleed = 0.50 / 6 * 1.10 * bleedU;
        return { dmg: 0.50, spa: -0.35, extra: bleed,
          notes: ["Piety mode (best DPS default): +50% dmg, -35% SPA, " +
          "Bleed 50%/6s x1.10 (enhanced) at " + Math.round(bleedU * 100) +
          "% uptime (not vs Boss)"] };
      }
      var extra = 1.00 / 12 * 1.10 * bleedU;
      var dmg = 1.00 + 0.50 * bleedU;   // +50% clause vs applicable types
      return { dmg: dmg, spa: 0.35, extra: extra,
        notes: ["Obliteration mode: +100% dmg (+50% vs applicable enemy " +
        "types at " + Math.round(bleedU * 100) + "%), +35% SPA, Bleed " +
        "100%/12s x1.10 (not vs Basic)"] };
    },
    // Bleed source is taken over and enhanced (+10%, folded into the
    // mode model); consuming stacks grants +25% damage (uptime var).
    "The Bird of Hermes": function (T) {
      var u = UP(T, "alucard_consume_uptime", 30);
      return { dmg: 0.25 * u, notes: ["The Bird of Hermes: +25% damage " +
        "after consuming Bleed stacks at " + Math.round(u * 100) +
        "% uptime; Bleed +10% folded into the mode model"] };
    },
    // On kill: AlucardVampire 15% (cap 3); on takedown: AlucardGhoul 5%
    // (cap 6). Estimated SPA ~5s.
    "Humanity's Trump Card": function (T) {
      var u = UP(T, "alucard_summons", 30);
      var extra = (3 * 0.15 + 6 * 0.05) / 5 * u;
      return { extra: extra, notes: ["Humanity's Trump Card: 3 vampires " +
        "15% + 6 ghouls 5% (est. SPA 5) at " + Math.round(u * 100) +
        "% uptime (needs kills)"] };
    },
    // Ability: AlucardEVO_Skill3 for 1000% damage + map-wide Burdened.
    "Total Release: Level Zero": function (T) {
      var ppm = N(T, "alucard_ability_ppm", 1);
      var extra = 10.00 * ppm / 60;
      return { extra: extra, notes: ["Total Release: 1000% nuke, " +
        ppm + "/min (estimated cadence)"] };
    }
  });
  A.registerUnitVars("Impaler (Ultimate)", [
    V("alucard_mode", "Mode (1 = Piety / 2 = Obliteration)", "Attack mode from the Upgrade UI - default 1 = Piety (best own DPS)", 1, 2, 1),
    V("alucard_bleed_uptime", "Bleed uptime %", "Share of attacks landing on Bleed-eligible enemies - default 50%", 0, 100, 50, 5),
    V("alucard_consume_uptime", "Consume uptime %", "Share of time with the +25% consume buff - default 30%", 0, 100, 30, 5),
    V("alucard_summons", "Summon uptime %", "Share of time vampires/ghouls are attacking (needs kills) - default 30%", 0, 100, 30, 5),
    V("alucard_ability_ppm", "Ability uses / min", "Total Release activations per minute - default 1 (estimated)", 0, 10, 1)
  ]);

  /* ====================== IRON WOLF (STRUGGLER) ====================== */
  A.registerPassives("Iron Wolf (Struggler)", {
    // Every hit applies Bleed then instantly deals all remaining Bleed
    // damage as True Damage: net +Bleed factor per hit (status data
    // Bleed = 65% total over 6s; factor adjustable).
    "Sacrificial Brand": function (T, ctx) {
      var f = N(T, "guts_bleed_factor", 65) / 100;
      var extra = f / ctx.spa;
      return { extra: extra, notes: ["Sacrificial Brand: each hit deals " +
        Math.round(f * 100) + "% instantly (Bleed applied then consumed)"] };
    },
    // Bleeding enemy dies -> GutsSpill (cap 2, 6s): 1 Bleed / 5s each
    // (0.65 over 6s per stack, steady ~1.2 stacks alive per spill).
    "Crimson Spill": function (T) {
      var u = UP(T, "guts_spill_uptime", 20);
      var extra = 2 * 0.65 * 1.2 / 6 * u;
      return { extra: extra, notes: ["Crimson Spill: 2 spills x ~1.2 " +
        "Bleed stacks at " + Math.round(u * 100) + "% uptime (needs kills)"] };
    },
    // Spill combining only extends radius / lifetime of Crimson Spill.
    "Feeding Ground": function (T) {
      return { notes: ["Feeding Ground: merges and extends GutsSpill " +
        "lifetime (supports Crimson Spill, no separate damage)"] };
    }
  });
  A.registerUnitVars("Iron Wolf (Struggler)", [
    V("guts_bleed_factor", "Bleed factor %", "Instant Bleed damage per hit - default 65 (status data)", 0, 200, 65, 5),
    V("guts_spill_uptime", "Spill uptime %", "Share of time GutsSpills are ticking - default 20%", 0, 100, 20, 5)
  ]);

  /* ====================== JESTER ====================== */
  A.registerNoDps("Jester", ["Jester Roll"]);
  A.registerPassives("Jester", {
    // Scythe window: +25% damage and a travelling cone slash (AoE shape,
    // no extra single-target damage).
    "Scythe": function (T) {
      var u = UP(T, "kite_scythe", 30);
      return { dmg: 0.25 * u, notes: ["Scythe: +25% dmg at " +
        Math.round(u * 100) + "% of the weapon cycle (default share)"] };
    },
    // Rifle window: -25% SPA and Bleed on every attack (0.65 / 6s).
    "Rifle": function (T) {
      var u = UP(T, "kite_rifle", 30);
      return { spa: -0.25 * u, extra: 0.65 / 6 * u,
        notes: ["Rifle: -25% SPA and Bleed 0.65/6s at " +
        Math.round(u * 100) + "% of the weapon cycle (default share)"] };
    },
    // Mace window: spawns a full clone for 15s (clone attacks at this
    // unit's stats) and instantly rerolls.
    "Mace": function (T, ctx) {
      var u = UP(T, "kite_mace", 15);
      var extra = 0.75 * u / ctx.spa;   // clone up 15s of the ~20s window
      return { extra: extra, notes: ["Mace: clone for 15s at " +
        Math.round(u * 100) + "% of the weapon cycle (estimated share)"] };
    },
    // Rolling the same weapon twice: +25% on it for the window.
    "Bored Jester": function (T) {
      var u = UP(T, "kite_bored", 10);
      return { dmg: 0.25 * u, notes: ["Bored Jester: +25% weapon damage " +
        "at " + Math.round(u * 100) + "% uptime (estimated)"] };
    }
  });
  A.registerUnitVars("Jester", [
    V("kite_scythe", "Scythe share %", "Share of the weapon cycle spent on Scythe - default 30%", 0, 100, 30, 5),
    V("kite_rifle", "Rifle share %", "Share of the weapon cycle spent on Rifle - default 30%", 0, 100, 30, 5),
    V("kite_mace", "Mace share %", "Share of the weapon cycle spent on Mace (instant reroll) - default 15%", 0, 100, 15, 5),
    V("kite_bored", "Bored Jester %", "Share of time with the repeat-roll +25% buff - default 10% (estimated)", 0, 100, 10, 5)
  ]);

  /* ====================== KITSUNE ====================== */
  A.registerNoDps("Kitsune", ["Red Herring", "Monodrama"]);
  A.registerPassives("Kitsune", {
    // SkillPoint meter (cap 3): feeds the Dreamdiver buff action and A1.
    // With a SkillPoint this unit buffs instead of attacking (action
    // replaced), so its own attacks are lost while the buff lands on the
    // strongest ally (others only - no self damage gain).
    "Dreamdiver": function (T) {
      var u = UP(T, "sparkle_buff_actions", 50);
      var spa = 1 / Math.max(0.01, 1 - u);   // share of actions = buffs (attacks lost)
      return { spa: spa, notes: ["Dreamdiver: " + Math.round(u * 100) +
        "% of actions are ally buffs instead of attacks (own attacks " +
        "lost; the -15% SPA / +15% speed buff targets other units)"] };
    },
    // Ability: max SkillPoints (3 buff actions), -15% SPA until they are
    // spent, and +35% damage to every unit in range for 30s (others only).
    "The Hero with a Thousand Faces": function (T) {
      var u = UP(T, "sparkle_ability_uptime", 30);
      return { spa: -0.15 * u, notes: ["Thousand Faces: -15% SPA while " +
        "SkillPoints last at " + Math.round(u * 100) +
        "% uptime (the +35% team buff does not affect this unit)"] };
    }
  });
  A.registerUnitVars("Kitsune", [
    V("sparkle_buff_actions", "Buff-action share %", "Share of actions spent buffing allies instead of attacking - default 50%", 0, 90, 50, 5),
    V("sparkle_ability_uptime", "Ability uptime %", "Share of time with the -15% SPA from Thousand Faces - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== LADY GIANT (ENVY) ====================== */
  A.registerNoDps("Lady Giant (Envy)", ["Stone Wall"]);
  A.registerPassives("Lady Giant (Envy)", {
    // Every 4 attacks: follow-up DianeRock at 100% (125% while
    // transformed). Rock Storm is attack-driven, always on.
    "Rock Storm": function (T, ctx) {
      var g = UP(T, "diane_transform", 20);
      var dmg = 1.00 * (1 + 0.25 * g);
      var extra = dmg / (4 * ctx.spa);
      return { extra: extra, notes: ["Rock Storm: 100% follow-up every " +
        "4 attacks (125% at " + Math.round(g * 100) + "% transformation)"] };
    },
    // Ability: DianeTransformation for 25s: +125% damage, +25% SPA
    // (slower), +50% range - averaged over the cycle (duty variable).
    "Size Control: Giant": function (T) {
      var g = UP(T, "diane_transform", 20);
      return { dmg: 1.25 * g, spa: 0.25 * g,
        notes: ["Size Control: +125% dmg / +25% SPA at " +
        Math.round(g * 100) + "% duty cycle (25s per activation)"] };
    }
  });
  A.registerUnitVars("Lady Giant (Envy)", [
    V("diane_transform", "Transformation %", "Duty cycle of DianeTransformation (25s windows) - default 20%", 0, 100, 20, 5)
  ]);

  /* ====================== LIGHTNING GOD (OVERCHARGED) ====================== */
  A.registerNoDps("Lightning God (Overcharged)", ["Stormseeker"]);
  A.registerPassives("Lightning God (Overcharged)", {
    // Electricity (status data): stun 1s on application, chain lightning
    // hits up to 3 enemies for 0.15x damage each. EnelMeter boosts
    // Electricity damage by 5% per point (cap 60 -> +300%); the meter
    // resets at 60 via Tempest Discharge -> cycle average default 30.
    "Storm Charge": function (T, ctx) {
      var meter = N(T, "enel_meter", 25);
      var chain = Math.min(N(T, "enel_chain_hits", 1), 5);
      var extra = 0.15 * chain * (1 + 0.05 * meter) / ctx.spa;
      return { extra: extra, notes: ["Storm Charge: chain lightning " +
        "0.15x x" + chain + " hit(s) on the primary at +" + (5 * meter) +
        "% (meter " + meter + "/60, cycle average; chains to other " +
        "enemies not counted)"] };
    },
    // At 25 meter: EnelCloud every 10s dealing 25% per attack (attack
    // cadence estimated at 2s).
    "Thundercloud": function (T) {
      var u = UP(T, "enel_cloud_uptime", 20);
      var extra = 0.25 / 2 * u;
      return { extra: extra, notes: ["Thundercloud: cloud 25% per ~2s " +
        "attack at " + Math.round(u * 100) + "% uptime (meter >= 25)"] };
    },
    // At 60 meter: LightningStrike for 100% to all in range, resets the
    // meter; the residue keeps Electricity permanently on enemies.
    "Tempest Discharge": function (T) {
      var ppm = N(T, "enel_discharge_ppm", 1);
      var extra = 1.00 * ppm / 60;
      return { extra: extra, notes: ["Tempest Discharge: 100% map strike, " +
        ppm + "/min (meter cycle; residue keeps Electricity rolling)"] };
    },
    // Golden: stuns and makes Electricity chain +2 enemies (folded into
    // the Chain targets variable of Storm Charge) - no separate number.
    "Molten Gold": function (T) {
      return { notes: ["Molten Gold: stun utility; +2 chain targets " +
        "(raise Chain targets to 5 while Golden is up)"] };
    }
  });
  A.registerUnitVars("Lightning God (Overcharged)", [
    V("enel_meter", "EnelMeter average", "Average meter during the 0-60 cycle (resets at 60) - default 25", 0, 60, 25),
    V("enel_chain_hits", "Chain targets", "Electricity hits landing on the primary (3 base, +2 with Golden; chains to other enemies not counted) - default 1", 1, 5, 1),
    V("enel_cloud_uptime", "Cloud uptime %", "Share of time EnelCloud is attacking the primary (needs 25+ meter) - default 20%", 0, 100, 20, 5),
    V("enel_discharge_ppm", "Discharges / min", "Tempest Discharge strikes per minute - default 1 (estimated)", 0, 10, 1)
  ]);

  /* ====================== NOBLE CAPTAIN (VIBRANT) ====================== */
  A.registerPassives("Noble Captain (Vibrant)", {
    // +25% vs enemies with movespeed modifiers; HardCC follow-up for 25%
    // (7s local CD). Both conditional -> uptime / cadence variables.
    "Broken Coda": function (T) {
      var u = UP(T, "byakuya_slowed", 30);
      var ppm = N(T, "byakuya_hardcc_ppm", 4);
      var extra = 0.25 * ppm / 60;
      return { dmg: 0.25 * u, extra: extra,
        notes: ["Broken Coda: +25% vs slowed enemies at " +
        Math.round(u * 100) + "% uptime; HardCC follow-up 25%, " +
        ppm + "/min (estimated)"] };
    },
    // +15% damage while attacking Dismembered enemies (+30% if the
    // Dismember came from a BleachCategory unit).
    "Precipice Flower": function (T) {
      var u = UP(T, "byakuya_dismember", 30);
      var bleach = N(T, "byakuya_bleach_source", 0) >= 50;
      var bonus = bleach ? 0.30 : 0.15;
      return { dmg: bonus * u, notes: ["Precipice Flower: +" +
        Math.round(bonus * 100) + "% vs Dismembered at " +
        Math.round(u * 100) + "% uptime" +
        (bleach ? " (BleachCategory source)" : "")] };
    },
    // Relocate + immediate Skill2 follow-up on the fastest enemy
    // (follow-up damage estimated at 100% of this unit's damage).
    "Flash Blossom": function (T) {
      var ppm = N(T, "byakuya_flash_ppm", 2);
      var extra = 1.00 * ppm / 60;
      return { extra: extra, notes: ["Flash Blossom: Skill2 follow-up " +
        "estimated 100%, " + ppm + "/min (estimated cadence)"] };
    },
    // Transformation switches to Skill3 (Blossoming Slash), gains a hidden
    // passive and changes archetype. Damage/SPA change is not present in
    // the available data -> uptime x damage-ratio variables, default OFF
    // (0% uptime) so the base number is unaffected.
    "Full Release": function (T) {
      var u = UP(T, "byakuya_trans_uptime", 0);
      var ratio = N(T, "byakuya_trans_ratio", 100) / 100;
      return { dmg: (ratio - 1) * u,
        notes: ["Full Release: ByakuyaTransformation at " +
        Math.round(u * 100) + "% uptime, damage ratio x" + ratio.toFixed(2) +
        " (estimated - Skill3 numbers unavailable; default 0% = excluded)"] };
    }
  });
  A.registerUnitVars("Noble Captain (Vibrant)", [
    V("byakuya_slowed", "Slowed-target %", "Share of time targets have movespeed modifiers (+25%) - default 30%", 0, 100, 30, 5),
    V("byakuya_hardcc_ppm", "HardCC follow-ups / min", "Broken Coda follow-ups per minute (7s CD) - default 4 (estimated)", 0, 10, 4),
    V("byakuya_dismember", "Dismember uptime %", "Share of attacks on Dismembered enemies - default 30%", 0, 100, 30, 5),
    V("byakuya_bleach_source", "BleachCategory source %", "Chance Dismember came from a BleachCategory unit (+30% instead of +15%) - default 0%", 0, 100, 0, 10),
    V("byakuya_flash_ppm", "Flash Blossoms / min", "Relocate + follow-up activations per minute - default 2 (estimated)", 0, 10, 2),
    V("byakuya_trans_uptime", "Transformation uptime %", "Share of time in ByakuyaTransformation - default 0% (damage effect unknown)", 0, 100, 0, 5),
    V("byakuya_trans_ratio", "Transformation damage %", "Damage in ByakuyaTransformation vs base - default 100 (no change, estimated)", 0, 400, 100, 5)
  ]);

  /* ====================== PRINCESS (MISERY) ====================== */
  A.registerPassives("Princess (Misery)", {
    // Gloom (CC, from OnePiece allies' attacks) + Possession: enemies
    // killed while possessed revive as friendly summons at 15% of this
    // unit's damage (cap 20, attack cadence estimated like Small Ghost).
    "Mysterious Four's Princess": function (T) {
      var n = Math.min(N(T, "perona_possessed", 2), 20);
      var u = UP(T, "perona_possession_uptime", 40);
      var extra = n * 0.15 / 7.5 * u;
      return { extra: extra, notes: ["Possession: " + n +
        " revived ghost(s) at 15% / ~7.5s, " + Math.round(u * 100) +
        "% uptime (needs Gloom kills; Gloom itself is CC only)"] };
    },
    // Every 30s: SpecialGhost explodes for 100% (+20% per Gloom death
    // this cycle, cap +200%).
    "Ghost Masquerade: Final Act": function (T) {
      var bonus = N(T, "perona_kill_bonus", 20) / 100;
      var extra = (1.00 * (1 + bonus)) / 30;
      return { extra: extra, notes: ["Ghost Masquerade: " +
        Math.round(100 * (1 + bonus)) + "% explosion every 30s (" +
        Math.round(bonus * 100) + "% kill bonus, cap +200%)"] };
    },
    // Small Ghost (30% of this unit's damage, SPA 7.5) placed at a spot;
    // it also counts as this unit for the other passives.
    "Lover of Company": function (T) {
      var n = N(T, "perona_small_ghosts", 1);
      var extra = n * 0.30 / 7.5;
      return { extra: extra, notes: ["Lover of Company: " + n +
        " PeronaSmallGhost(s) at 30% / 7.5s"] };
    }
  });
  A.registerUnitVars("Princess (Misery)", [
    V("perona_possessed", "Possessed summons", "Friendly ghosts from Possession (cap 20) - default 2 (estimated)", 0, 20, 2),
    V("perona_possession_uptime", "Possession uptime %", "Share of time revived ghosts are attacking - default 40% (estimated)", 0, 100, 40, 5),
    V("perona_kill_bonus", "Kill bonus %", "Gloom deaths per ghost cycle (+20% each, cap 200%) - default 20%", 0, 200, 20, 5),
    V("perona_small_ghosts", "Small Ghosts placed", "PeronaSmallGhosts on the map - default 1", 0, 5, 1)
  ]);

  /* ====================== PRODIGY (RAGE) ====================== */
  A.registerPassives("Prodigy (Rage)", {
    // From upgrade 3: every 4 attacks deal 25% to ALL enemies in range
    // (includes the main target); upgrade 5 unlocks Rage Unleashed.
    "Hidden Potential": function (T, ctx) {
      var extra = 0.25 / (4 * ctx.spa);
      return { extra: extra, notes: ["Hidden Potential: 25% AoE every 4 attacks"] };
    },
    // +10% damage per StatusEffect stack on the target (cap +100%);
    // also seizes DoTs (refresh + source steal). Bonus as a variable.
    "Unyielding Spirit": function (T) {
      var u = UP(T, "prodigy_status", 20);
      return { dmg: u, notes: ["Unyielding Spirit: +" +
        Math.round(u * 100) + "% from StatusEffect stacks (cap +100%; " +
        "DoT source steal adds this unit's credit on foreign DoTs)"] };
    },
    // At 100 GohanMeter -> GohanTransformation2: +25% damage and 75% AoE
    // every 3 attacks. Duty-cycle variable (meter fills every 20 attacks).
    "Rage Unleashed": function (T, ctx) {
      var g = UP(T, "prodigy_transform2", 30);
      var extra = 0.75 / (3 * ctx.spa) * g;
      return { dmg: 0.25 * g, extra: extra,
        notes: ["Rage Unleashed: GohanTransformation2 at " +
        Math.round(g * 100) + "% duty cycle (+25% dmg, 75% AoE / 3 attacks)"] };
    },
    // 10s channel: 75% per second inside the area, this unit does not
    // attack while active -> duty cycle, attacks paused.
    "Father and Son Spirit Energy": function (T) {
      var u = UP(T, "prodigy_ability", 15);
      var extra = 0.75 * u;
      return { extra: extra, spa: 1 / Math.max(0.01, 1 - u),
        notes: ["Father and Son: 75% dmg/s field at " + Math.round(u * 100) +
        "% uptime, attacks paused while active"] };
    }
  });
  A.registerUnitVars("Prodigy (Rage)", [
    V("prodigy_status", "Status bonus %", "Unyielding Spirit damage bonus from StatusEffect stacks (cap 100) - default 20", 0, 100, 20, 5),
    V("prodigy_transform2", "Transformation2 %", "Duty cycle of GohanTransformation2 (100 meter = 20 attacks) - default 30%", 0, 100, 30, 5),
    V("prodigy_ability", "Ability uptime %", "Share of time channeling Father and Son - default 15% (estimated cadence)", 0, 100, 15, 5)
  ]);

  /* ====================== PUPPET (TELEKINETIC) ====================== */
  A.registerNoDps("Puppet (Telekinetic)", ["Puppet Creation", "Complete Control"]);
  A.registerPassives("Puppet (Telekinetic)", {
    // Strongest enemy is marked 15s every 15s (near-permanent on a single
    // target): marked enemies take +20% incoming damage - includes this
    // unit's own hits.
    "Marionette\u2019s Gaze": function (T) {
      var u = UP(T, "gowther_mark_uptime", 70);
      return { dmg: 0.20 * u, notes: ["Marionette's Gaze: +20% damage " +
        "taken by the marked target at " + Math.round(u * 100) +
        "% mark uptime (default 70%, reapplied every 15s)"] };
    }
  });
  A.registerUnitVars("Puppet (Telekinetic)", [
    V("gowther_mark_uptime", "Mark uptime %", "Share of time the strongest enemy is GowtherMarked - default 70%", 0, 100, 70, 5)
  ]);

  /* ====================== RAINMAN (FORECAST) ====================== */
  A.registerNoDps("Rainman (Forecast)", ["Heavy Rain"]);
  A.registerPassives("Rainman (Forecast)", {
    // Meter cycle + Frog Storm CC: the conversion of dying enemies into
    // WeatherFrogs feeds Poison Frog (this model carries no number).
    "Frog Storm": function (T) {
      return { notes: ["Frog Storm: CC and frog conversion (feeds " +
        "Poison Frog; no separate damage)"] };
    },
    // Walked-over WeatherFrog explodes for 100% and applies Poison
    // (0.3x over 6s in 3 range).
    "Poison Frog": function (T) {
      var ppm = N(T, "weather_frog_ppm", 3);
      var poisonU = Math.min(1, ppm * 6 / 60);
      var extra = 1.00 * ppm / 60 + poisonU * 0.3 / 6;
      return { extra: extra, notes: ["Poison Frog: " + ppm +
        " detonation(s)/min x100% + Poison 0.3x/6s (est. 1 target)"] };
    },
    // Ability: Rain Cloud field dealing 15% of this unit's damage every
    // 1 second to enemies inside.
    "Rain Cloud": function (T) {
      var u = UP(T, "weather_cloud_uptime", 30);
      var n = N(T, "weather_cloud_targets", 1);
      var extra = 0.15 * n * u;
      return { extra: extra, notes: ["Rain Cloud: 15% dmg/s on " + n +
        " enemy(s) at " + Math.round(u * 100) + "% uptime"] };
    }
  });
  A.registerUnitVars("Rainman (Forecast)", [
    V("weather_frog_ppm", "Frog detonations / min", "WeatherFrogs exploded per minute (needs kills) - default 3 (estimated)", 0, 30, 3),
    V("weather_cloud_uptime", "Cloud uptime %", "Share of time Rain Cloud is down - default 30%", 0, 100, 30, 5),
    V("weather_cloud_targets", "Cloud targets", "Enemies inside the Rain Cloud - default 1 (estimated)", 0, 10, 1)
  ]);

  /* ====================== RAMEN GUY ====================== */
  A.registerNoDps("Ramen Guy", ["Capital Lock", "Donburi"]);

  /* ====================== RAZORJAW (HUNTER) ====================== */
  A.registerNoDps("Razorjaw (Hunter)", ["Endless Slashes"]);
  A.registerPassives("Razorjaw (Hunter)", {
    // Every 10s: Full AoE for 35% + Stagger; +1% crit chance per enemy
    // hit (cap 25%), stacking over roars during a fight.
    "Roar": function (T) {
      var cc = Math.min(N(T, "roronoa_roar_cc", 15), 25);
      var extra = 0.35 / 10;
      return { cc: cc, extra: extra,
        notes: ["Roar: 35% every 10s; +" + cc +
        "% crit chance from hits (cap 25%, grows over the fight)"] };
    }
  });
  A.registerUnitVars("Razorjaw (Hunter)", [
    V("roronoa_roar_cc", "Roar crit stacks", "Accumulated +1%/hit crit chance - default 15 (cap 25)", 0, 25, 15)
  ]);

  /* ====================== REAPER (FRENZIED) ====================== */
  A.registerPassives("Reaper (Frenzied)", {
    // Enemy leaves range: Skill1 for 200% (8s CD) + slow.
    "Crush The World Down": function (T) {
      var ppm = N(T, "ichigo_leaves_ppm", 1);
      var extra = 2.00 * ppm / 60;
      return { extra: extra, notes: ["Crush The World Down: 200% on " +
        "range exits, " + ppm + "/min (8s CD, estimated)"] };
    },
    // Self StatusEffect: cleanse + Skill4 for 150% AoE in range (5s CD).
    "Higher Than The Moon": function (T) {
      var ppm = N(T, "ichigo_cleanse_ppm", 1);
      var extra = 1.50 * ppm / 60;
      return { extra: extra, notes: ["Higher Than The Moon: 150% AoE " +
        "self-cleanse, " + ppm + "/min (needs debuffs, estimated)"] };
    },
    // Boss leaves range: drag along the path - 200% grab (guaranteed
    // crit, not folded into extra) + 150% per enemy hit (global 30s CD).
    "Go For The Heart": function (T) {
      var u = UP(T, "ichigo_boss_uptime", 7);
      var n = N(T, "ichigo_drag_targets", 1);
      var extra = (2.00 + 1.50 * n) / 30 * u;
      return { extra: extra, notes: ["Go For The Heart: (200% grab + " +
        "150% x" + n + " dragged) every 30s at " + Math.round(u * 100) +
        "% boss uptime; grab always crits (not in extra)"] };
    },
    // Ability: Skill2 for 300% to all in range + 8s stun.
    "Annihilation Zero": function (T) {
      var ppm = N(T, "ichigo_ability_ppm", 1);
      var extra = 3.00 * ppm / 60;
      return { extra: extra, notes: ["Annihilation Zero: 300% AoE, " +
        ppm + "/min (estimated cadence)"] };
    }
  });
  A.registerUnitVars("Reaper (Frenzied)", [
    V("ichigo_leaves_ppm", "Range exits / min", "Range exits hitting the primary per minute - default 1 (estimated)", 0, 30, 1),
    V("ichigo_cleanse_ppm", "Self-cleanses / min", "Self-cleanse procs per minute - default 1 (needs debuffs, estimated)", 0, 20, 1),
    V("ichigo_boss_uptime", "Boss uptime %", "Share of time a Boss can be dragged (30s global CD) - default 7% (boss share of play time)", 0, 100, 7, 5),
    V("ichigo_drag_targets", "Dragged enemies", "Enemies hit while dragging the Boss - default 1 (single-target view)", 0, 10, 1),
    V("ichigo_ability_ppm", "Ability uses / min", "Annihilation Zero activations per minute - default 1 (estimated)", 0, 20, 1)
  ]);

  /* ====================== SAND (ALLIGATOR) ====================== */
  A.registerPassives("Sand (Alligator)", {
    // Sandstorm zone: movement-speed reduction (utility) that also marks
    // the zone Golden Hook checks - no damage of its own.
    "Desert Storm": function (T) {
      return { notes: ["Desert Storm: Sandstorm movement-speed zone " +
        "(utility; enables Golden Hook's damage bonus while inside)"] };
    },
    // Poison (status data: 0.3x total over 6s) with Golden Hook amps:
    // +15% flat, +25% per tick while inside the storm (cap +150%), extra
    // stack past 20% zone size. Assumes this unit's attacks apply Poison.
    "Golden Hook": function (T) {
      var amp = Math.min(N(T, "crocodile_poison_amp", 90), 150) / 100;
      var n = N(T, "crocodile_poison_targets", 1);
      var extra = 0.3 / 6 * (1 + amp) * n;
      return { extra: extra, notes: ["Golden Hook: Poison 0.3x/6s x" +
        (1 + amp).toFixed(2) + " on " + n + " enemy (" +
        Math.round(amp * 100) + "% amp: flat +15% + storm bonus, cap 150%; " +
        "Poison-on-attack assumed - estimated)"] };
    },
    // Ability: zone grows twice as fast, this unit stops attacking; a
    // re-trigger before 100% hits 125% (with slow), at 100% hits 200%
    // (with 5s stun). Average nuke per activation estimated at 160%.
    "Ground Eruption": function (T) {
      var ppm = N(T, "crocodile_ability_ppm", 2);
      var extra = 1.60 * ppm / 60;
      return { extra: extra, notes: ["Ground Eruption: 125-200% AoE per " +
        "activation, " + ppm + "/min (estimated; attacks paused during it)"] };
    }
  });
  A.registerUnitVars("Sand (Alligator)", [
    V("crocodile_poison_amp", "Poison amp %", "Golden Hook tick bonus - default 90 (15 flat + 75 inside storm, cap 150)", 0, 150, 90, 5),
    V("crocodile_poison_targets", "Poison targets", "Enemies kept poisoned - default 1 (estimated)", 0, 10, 1),
    V("crocodile_ability_ppm", "Ability uses / min", "Ground Eruption activations per minute - default 2 (estimated)", 0, 10, 2)
  ]);

  /* ====================== SHADOW (DIVINE) ====================== */
  A.registerNoDps("Shadow (Divine)", ["Wolf Spirit"]);
  A.registerPassives("Shadow (Divine)", {
    // WingedSpirit circles at 50% range and hits for 50% of this unit's
    // damage every 8 seconds (from upgrade 3, always on at max level).
    "Winged Spirit": function (T) {
      var extra = 0.50 / 8;
      return { extra: extra, notes: ["Winged Spirit: 50% every 8s " +
        "(permanent from upgrade 3)"] };
    },
    // Ability: 30s map transform; +25% damage to all Magical units in
    // range - this unit is Magical and is included (self). Cadence var.
    "Shadow Realm": function (T) {
      var u = UP(T, "obito_ability_uptime", 30);
      return { dmg: 0.25 * u, notes: ["Shadow Realm: +25% to Magical " +
        "units in range (self included) at " + Math.round(u * 100) +
        "% uptime (30s per activation, estimated cadence)"] };
    },
    // Ability: summons DivineSpirit at 100% of base damage while this
    // unit is stunned for 15s - the spirit REPLACES this unit's attacks
    // (same stats, so net DPS is unchanged: no separate damage).
    "Divine Spirit": function (T) {
      return { notes: ["Divine Spirit: the substitute spirit attacks at " +
        "this unit's stats while it is stunned (replaces its attacks - no " +
        "separate damage counted)"] };
    }
  });
  A.registerUnitVars("Shadow (Divine)", [
    V("obito_ability_uptime", "Shadow Realm %", "Share of time under the 30s ShadowRealm buff - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== SHARKFANG (ABYSSAL) ====================== */
  A.registerPassives("Sharkfang (Abyssal)", {
    // Every 12s: wave travels to spawn dealing 15% per enemy hit
    // (hits estimated at 2 per wave).
    "Waterfall": function (T) {
      var ppm = N(T, "harribel_waves_min", 5);
      var hits = N(T, "harribel_wave_hits", 2);
      var extra = 0.15 * hits * ppm / 60;
      return { extra: extra, notes: ["Waterfall: 15% x" + hits +
        " hits per wave, " + ppm + "/min (estimated)"] };
    },
    // Wave/ability despawn leaves a 5s vapor cloud: 15% per second while
    // inside plus stackable Fire (0.5x / 4s modeled as one stack).
    "Boiling Waters": function (T) {
      var u = UP(T, "harribel_vapor", 30);
      var n = N(T, "harribel_vapor_targets", 1);
      var extra = (0.15 + 0.5 / 4) * n * u;
      return { extra: extra, notes: ["Boiling Waters: cloud 15%/s + Fire " +
        "0.5x/4s on " + n + " enemy at " + Math.round(u * 100) +
        "% uptime (5s per wave despawn, estimated)"] };
    },
    // Ability: 2 waves from range end dealing 50% each (+Rewind).
    "Tidal Wave": function (T) {
      var ppm = N(T, "harribel_ability_ppm", 1);
      var extra = 1.00 * ppm / 60;
      return { extra: extra, notes: ["Tidal Wave: 2 x 50% per activation, " +
        ppm + "/min (estimated, 1 target per wave)"] };
    }
  });
  A.registerUnitVars("Sharkfang (Abyssal)", [
    V("harribel_waves_min", "Waves / min", "Waterfall waves per minute (every 12s = 5) - default 5", 0, 20, 5),
    V("harribel_wave_hits", "Wave hits", "Enemies hit per wave - default 2 (estimated)", 0, 10, 2),
    V("harribel_vapor", "Vapor uptime %", "Share of time the vapor cloud ticks - default 30%", 0, 100, 30, 5),
    V("harribel_vapor_targets", "Vapor targets", "Enemies inside the cloud - default 1 (estimated)", 0, 10, 1),
    V("harribel_ability_ppm", "Ability uses / min", "Tidal Wave activations per minute - default 1 (estimated)", 0, 10, 1)
  ]);

  /* ====================== SILVER FALCON ====================== */
  A.registerPassives("Silver Falcon", {
    // Global damage aura: +10% base (+1%/upgrade) to all units including
    // this one, +5% (+1%/upgrade) to its own archetype (Magical - self
    // included), plus +10% if Magical is the player's most equipped
    // archetype. 9 levels (deploy + 8 upgrades).
    "The Captain": function (T) {
      var base = 0.10 + 0.01 * 8;             // 18%
      var arch = 0.05 + 0.01 * 8;              // 13% (Magical, self)
      var top = UP(T, "griffith_top_archetype", 0);
      return { dmg: base + arch + 0.10 * top,
        notes: ["The Captain: +18% base, +13% Magical (self included), " +
        "+" + Math.round(top * 100) + "% most-equipped archetype (others' " +
        "buffs not counted)"] };
    },
    // Every 20s: allies get +15% range for 10s; each unit buffed by BOTH
    // passives gives this unit +5% cc / +5% cd / +5% range (cap 10).
    "The Falcon's Pawn": function (T) {
      var n = Math.min(N(T, "griffith_double_buffed", 1), 10);
      return { cc: 5 * n, cd: 5 * n,
        notes: ["The Falcon's Pawn: " + n + "/10 doubly-buffed units " +
        "(+5% crit chance and +5% crit dmg each)"] };
    }
  });
  A.registerNoDps("Silver Falcon", ["War Chest"]);
  A.registerUnitVars("Silver Falcon", [
    V("griffith_top_archetype", "Most-equipped archetype %", "Whether the player's most equipped archetype matches this unit (adds +10%) - default 0%", 0, 100, 0, 10),
    V("griffith_double_buffed", "Doubly-buffed units", "Units buffed by both passives at once (cap 10, +5% cc/cd each) - default 1 (estimated)", 0, 10, 1)
  ]);

  /* ====================== SOVEREIGN (DJINN) ====================== */
  A.registerNoDps("Sovereign (Djinn)", ["Djinn Combination"]);
  A.registerPassives("Sovereign (Djinn)", {
    // Lightning Djinn (passive when no Boss / stays on with Boss): every
    // attack creates 5 chains of 25% each. Single target: only the chains
    // that land on the primary count -> default 1 chain.
    "Lightning Djinn": function (T, ctx) {
      var chains = Math.min(N(T, "sinbad_chains", 1), 5);
      var extra = 0.25 * chains / ctx.spa;
      return { extra: extra, notes: ["Lightning Djinn: 5 x 25% chains " +
        "per attack, " + chains + " landing on the primary (single target)"] };
    },
    // Nine Tailed Fox Djinn (Boss in range): +50% damage and Freeze
    // attacks - conditional on a Boss being present (default 7% of play).
    "Nine Tailed Fox Djinn": function (T) {
      var u = UP(T, "sinbad_boss_uptime", 7);
      return { dmg: 0.50 * u, notes: ["Nine Tailed Fox Djinn: +50% dmg " +
        "with a Boss in range at " + Math.round(u * 100) + "% of play time"] };
    },
    // Every 7s: LightningStrike for 75% on the strongest + 3 chains of
    // 20% (chains spread on one target when alone). Single-target: 1 chain.
    "Djinn's Judgment": function (T) {
      var ppm = N(T, "sinbad_judgment_ppm", 4);
      var chains = N(T, "sinbad_judgment_chains", 1);
      var extra = (0.75 + 0.20 * chains) * ppm / 60;
      return { extra: extra, notes: ["Djinn's Judgment: 75% + " + chains +
        " x 20% chain on the primary, " + ppm + "/min (estimated cadence)"] };
    }
  });
  A.registerUnitVars("Sovereign (Djinn)", [
    V("sinbad_chains", "Chains per attack", "Lightning Djinn chains hitting the main target - default 5", 1, 5, 5),
    V("sinbad_boss_uptime", "Boss uptime %", "Share of time a Boss is in range - default 7%", 0, 100, 7, 5),
    V("sinbad_judgment_ppm", "Strikes / min", "Djinn's Judgment strikes per minute (7s CD) - default 8", 0, 10, 8),
    V("sinbad_judgment_chains", "Strike chains", "Chains from Djinn's Judgment hitting the main target - default 3", 0, 5, 3)
  ]);

  /* ====================== STRING DEMON (AWAKENED) ====================== */
  A.registerPassives("String Demon (Awakened)", {
    // Every 6 attacks: cocoon on hit enemies; if broken after 10 hits it
    // deals 100% (otherwise just stalls - CC).
    "Cocoon of Carnage": function (T, ctx) {
      var u = UP(T, "doflamingo_cocoon_break", 50);
      var extra = 1.00 * u / (6 * ctx.spa);
      return { extra: extra, notes: ["Cocoon of Carnage: 100% per broken " +
        "cocoon (every 6 attacks), " + Math.round(u * 100) +
        "% break rate (estimated)"] };
    },
    // Ally attacks attach a string (cap 3); on this unit's next attack
    // all attached units fire a 100% follow-up; reattach lockout 15s per
    // unit -> up to 3 x 100% per 15s.
    "String Sync": function (T) {
      var u = UP(T, "doflamingo_strings", 40);
      var extra = 3 * 1.00 / 15 * u;
      return { extra: extra, notes: ["String Sync: 3 strings x 100% per " +
        "~15s at " + Math.round(u * 100) + "% uptime (needs ally attacks)"] };
    }
  });
  A.registerUnitVars("String Demon (Awakened)", [
    V("doflamingo_cocoon_break", "Cocoon break %", "Share of cocoons broken within 10 hits - default 50% (estimated)", 0, 100, 50, 5),
    V("doflamingo_strings", "String uptime %", "Share of time 3 strings are attached - default 40%", 0, 100, 40, 5)
  ]);

  /* ====================== SUBJECT 8 (MONSTER) ====================== */
  A.registerPassives("Subject 8 (Monster)", {
    // ControlMeter: +15/attack (100 cap). At 25: +30% instance per hit;
    // at 75: -15% SPA. Cycle: fill (~7 attacks) then Unbound burst (20s)
    // then reset -> threshold uptimes as variables.
    "Losing Control": function (T, ctx) {
      var u25 = UP(T, "kafka_meter25", 35);
      var u75 = UP(T, "kafka_meter75", 30);
      var extra = 0.30 * u25 / ctx.spa;
      return { spa: -0.15 * u75, extra: extra,
        notes: ["Losing Control: +30% instance per attack at " +
        Math.round(u25 * 100) + "% uptime (meter >= 25); -15% SPA at " +
        Math.round(u75 * 100) + "% (meter >= 75)"] };
    },
    // Unbound (meter full): 20s burst of +50% damage, -15% SPA and a 100%
    // hit over 5 enemies per strike; resets the meter afterwards.
    "Unbound": function (T) {
      var u = UP(T, "kafka_burst", 15);
      var n = N(T, "kafka_burst_targets", 1);
      var extra = 1.00 * n * u / 20;   // 100% per enemy per 20s window
      return { dmg: 0.50 * u, spa: -0.15 * u, extra: extra,
        notes: ["Unbound: burst at " + Math.round(u * 100) +
        "% duty cycle (+50% dmg, -15% SPA, 100% over " + n +
        " enemy / 20s)"] };
    },
    // Enemy within 50% range: Full AoE for 75% over 5 hits + Dismember
    // (15s CD) + 10% Physical to allies (others only).
    "Colossal Roar": function (T) {
      var ppm = N(T, "kafka_roar_ppm", 2);
      var extra = 0.75 * ppm / 60;
      return { extra: extra, notes: ["Colossal Roar: 75% over 5 hits, " +
        ppm + "/min (15s CD, estimated); team buff not counted"] };
    }
  });
  A.registerUnitVars("Subject 8 (Monster)", [
    V("kafka_meter25", "Meter>=25 uptime %", "Share of attacks with the +30% instance - default 35%", 0, 100, 35, 5),
    V("kafka_meter75", "Meter>=75 uptime %", "Share of time the -15% SPA threshold is active - default 30%", 0, 100, 30, 5),
    V("kafka_burst", "Unbound burst %", "Duty cycle of the 20s Unbound burst - default 15%", 0, 100, 15, 5),
    V("kafka_burst_targets", "Burst targets", "Enemies hit by the Unbound 100% strike - default 1 (single-target view)", 0, 10, 1),
    V("kafka_roar_ppm", "Roars / min", "Colossal Roar procs per minute - default 2 (estimated)", 0, 10, 2)
  ]);

  /* ====================== THE DRINK (JUICEBOX) ====================== */
  A.registerPassives("The Drink (Juicebox)", {
    // Every 6 attacks: 15s mark; the mark raises ALL follow-up damage by
    // 10% (including this unit's own) - folded into Quick Assist.
    "Precision Slash": function (T) {
      return { notes: ["Precision Slash: TrunksMark (every 6 attacks, " +
        "15s) grants +10% follow-up damage - folded into Quick Assist"] };
    },
    // Follow-up happens in range (8s CD): this unit fires a 150%
    // follow-up (x1.10 from the mark; +15% while transformed).
    "Quick Assist": function (T, ctx) {
      var u = UP(T, "trunks_assist", 50);
      var tr = UP(T, "trunks_transform", 30);
      var extra = 1.50 / 8 * u * 1.10 * (1 + 0.15 * tr);
      return { extra: extra, notes: ["Quick Assist: 150% per ~8s x1.10 " +
        "(mark) x" + (1 + 0.15 * tr).toFixed(2) + " (transformation) at " +
        Math.round(u * 100) + "% uptime (estimated)"] };
    },
    // In transformation the follow-ups crit for +15% crit damage - noted,
    // the numeric part rides on Quick Assist's window.
    "Perfected Strikes": function (T) {
      var tr = UP(T, "trunks_transform", 30);
      return { cd: 15 * tr, notes: ["Perfected Strikes: follow-ups crit " +
        "+15% crit dmg during Golden Ascension (" + Math.round(tr * 100) +
        "% duty cycle)"] };
    },
    // Ability: 60s transformation - 10% faster SPA, mark needs one less
    // attack and follow-ups gain +15% (folded into Quick Assist).
    "Golden Ascension": function (T) {
      var tr = UP(T, "trunks_transform", 30);
      return { spa: -0.10 * tr, notes: ["Golden Ascension: -10% SPA at " +
        Math.round(tr * 100) + "% duty cycle (60s windows; mark cadence " +
        "and follow-up bonus folded into the other passives)"] };
    }
  });
  A.registerUnitVars("The Drink (Juicebox)", [
    V("trunks_assist", "Quick Assist %", "Share of time follow-ups trigger the 150% counter (8s CD) - default 50%", 0, 100, 50, 5),
    V("trunks_transform", "Transformation %", "Duty cycle of Golden Ascension (60s windows) - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== THE HERO ====================== */
  A.registerPassives("The Hero", {
    // +5% damage to all Physical units in range per level; this unit is
    // Physical and stands in its own range (self included). 6 levels.
    "Hero Blessing": function () {
      return { dmg: 0.30, notes: ["Hero Blessing: +5% x 6 levels to " +
        "Physical units in range (self included)"] };
    }
  });

  /* ====================== TOY MAKER ====================== */
  A.registerPassives("Toy Maker", {
    // This unit NEVER attacks: it spawns SugarToys on every path instead
    // (spawn cadence = its attack cycle). Toys deal 10% of their max HP
    // as AoE on death (upgrade 4+); max HP = 100% of this unit's damage
    // (mutation at upgrade 6 raises it). Estimated model - contact damage
    // is not documented, only the death burst is counted.
    "Build-a-toy": function (T, ctx) {
      var paths = N(T, "gingy_paths", 2);
      var u = UP(T, "gingy_death_uptime", 80);
      var extra = paths * 0.10 * u / ctx.spa;
      return { extra: extra, notes: ["Build-a-toy (estimated): " + paths +
        " path(s), toy death burst = 10% of max HP (100% of this unit's " +
        "damage) per spawn cycle at " + Math.round(u * 100) +
        "% death uptime; the unit itself never attacks"] };
    }
  });
  A.registerUnitVars("Toy Maker", [
    V("gingy_paths", "Paths in range", "Paths SugarToys spawn on (spawn per cycle each) - default 2", 1, 6, 2),
    V("gingy_death_uptime", "Toy death %", "Share of spawned toys that reach and die on an enemy - default 80% (estimated)", 0, 100, 80, 5)
  ]);

  /* ====================== TRAITOR (ILLUSION) ====================== */
  A.registerNoDps("Traitor (Illusion)", ["Everpresent Deception", "The Ideal World"]);
  A.registerPassives("Traitor (Illusion)", {
    // Reflect on debuff attempts: 70% follow-up; every 15s hypnotizes the
    // 5 strongest (Hypnosis itself is handled by the dedicated Variables:
    // hypnotized targets / enemies in range). This model covers the
    // reflect follow-up only.
    "Collapse, Mirror Flower": function (T) {
      var ppm = N(T, "aizen_reflect_ppm", 3);
      var extra = 0.70 * ppm / 60;
      return { extra: extra, notes: ["Reflect follow-up: 70% per debuff " +
        "reflect, " + ppm + "/min (estimated); the Hypnosis damage bonus " +
        "uses the Hypnosis / enemies-in-range Variables"] };
    }
  });
  A.registerUnitVars("Traitor (Illusion)", [
    V("aizen_reflect_ppm", "Reflects / min", "Debuff reflects per minute - default 3 (estimated)", 0, 20, 3)
  ]);

  /* ====================== TRUE SAINT (HOLY) ====================== */
  A.registerPassives("True Saint (Holy)", {
    // Attacks mark enemies (cap 5); each critical removes all marks and
    // deals 10% of current damage to every marked enemy. Crit chance 10%
    // comes from the unit's own stats (ctx.cc).
    "Predictive Calculation": function (T, ctx) {
      var n = Math.min(N(T, "hinata_marks", 5), 5);
      var crit = (ctx.cc || 0) / 100;
      var extra = 0.10 * n * crit / ctx.spa;
      return { extra: extra, notes: ["Predictive Calculation: " + n +
        " marks x10% popped per crit (" + Math.round(crit * 100) +
        "% crit chance)"] };
    },
    // Ability: for 60s steals 20% of the damage of the 3 strongest units
    // in range (modeled as +60% self damage) - cadence as uptime var.
    "Seize": function (T) {
      var u = UP(T, "hinata_seize", 30);
      return { dmg: 0.60 * u, notes: ["Seize: +60% damage (3 x 20% stolen, " +
        "60s window) at " + Math.round(u * 100) + "% uptime (estimated)"] };
    }
  });
  A.registerUnitVars("True Saint (Holy)", [
    V("hinata_marks", "Marks popped", "Marked enemies taking 10% per crit (cap 5) - default 5", 0, 5, 5),
    V("hinata_seize", "Seize uptime %", "Share of time the 60s Seize buff is active - default 30%", 0, 100, 30, 5)
  ]);

  /* ====================== VEGETABLE (PRINCE) ====================== */
  A.registerPassives("Vegetable (Prince)", {
    // Enemies leaving range take 10% of current damage (proc per exit).
    "Prince's Pursuit": function (T) {
      var ppm = N(T, "vegeta_exits", 2);
      var extra = 0.10 * ppm / 60;
      return { extra: extra, notes: ["Prince's Pursuit: 10% per range " +
        "exit, " + ppm + "/min (estimated)"] };
    },
    // Ally attacks feed +5% dmg (cap 25%), ally crits +5% cc (cap 25%),
    // ally follow-ups +5% cd (cap 15%) - progress toward caps as one
    // variable.
    "Royal Rivalry": function (T) {
      var u = UP(T, "vegeta_royal", 40);
      return { dmg: 0.25 * u, cc: 25 * u, cd: 15 * u,
        notes: ["Royal Rivalry: " + Math.round(u * 100) +
        "% of the caps (+25% dmg / +25% crit / +15% crit dmg) from ally " +
        "attacks in range"] };
    },
    // VegetaMeter starts full (100): takedowns drain it (or an ally
    // transform empties it) -> VegetaTransformation: +15% damage,
    // +35% crit damage, +20% crit chance. Duty-cycle variable.
    "Awakened Pride": function (T) {
      var u = UP(T, "vegeta_transform", 40);
      return { dmg: 0.15 * u, cd: 35 * u, cc: 20 * u,
        notes: ["Awakened Pride: VegetaTransformation (+15% dmg, +35% " +
        "crit dmg, +20% crit) at " + Math.round(u * 100) +
        "% duty cycle (needs ~20 takedowns or an ally transform)"] };
    }
  });
  A.registerUnitVars("Vegetable (Prince)", [
    V("vegeta_exits", "Range exits / min", "Enemies leaving range per minute - default 2 (estimated)", 0, 30, 2),
    V("vegeta_royal", "Royal progress %", "Progress toward the Royal Rivalry caps - default 40%", 0, 100, 40, 5),
    V("vegeta_transform", "Transformation %", "Duty cycle of VegetaTransformation - default 40%", 0, 100, 40, 5)
  ]);

  /* ====================== WATER MAGE (SCHOLAR) ====================== */
  A.registerNoDps("Water Mage (Scholar)", ["Frost Bind", "Wall of Ice"]);
  A.registerPassives("Water Mage (Scholar)", {
    // Hitting a Frozen enemy: 10% around it; a Frozen enemy dying makes
    // the 3 nearest take 25% each; expiry applies a slow (utility).
    "Shatter": function (T, ctx) {
      var u = UP(T, "urahara_frozen", 30);
      var ppm = N(T, "urahara_frozen_deaths", 3);
      var extra = 0.10 * u / ctx.spa + 0.25 * 3 * ppm / 60;
      return { extra: extra, notes: ["Shatter: 10% splash per hit on " +
        "Frozen targets at " + Math.round(u * 100) +
        "% uptime + 25% x3 on frozen deaths (" + ppm + "/min, estimated)"] };
    }
  });
  A.registerUnitVars("Water Mage (Scholar)", [
    V("urahara_frozen", "Frozen uptime %", "Share of attacks landing on Frozen enemies - default 30%", 0, 100, 30, 5),
    V("urahara_frozen_deaths", "Frozen deaths / min", "Enemies dying while Frozen - default 3 (estimated)", 0, 30, 3)
  ]);

  /* ====================== WATER SAGE (FOUNDER) ====================== */
  A.registerNoDps("Water Sage (Founder)", ["Flash Mastery"]);
  A.registerPassives("Water Sage (Founder)", {
    // A MirrorClone every 15s (cap 3); each clone on the map grants this
    // unit +10% damage and +10% range.
    "Creator of Mirror Clones": function (T) {
      var u = UP(T, "ukitake_clones", 70);
      return { dmg: 0.30 * u, notes: ["Mirror Clones: +10% dmg and +10% " +
        "range per clone (cap 3) at " + Math.round(u * 100) +
        "% of the cap (spawn 1/15s)"] };
    },
    // Every attack of this unit and its clones gains a 120% follow-up;
    // clones attack on their own cadence (variable).
    "Thunder God": function (T, ctx) {
      var c = N(T, "ukitake_clone_fups", 2);
      var extra = 1.20 / ctx.spa + 1.20 * c / 60;
      return { extra: extra, notes: ["Thunder God: 120% follow-up on " +
        "every attack + " + c + " clone follow-up(s)/min hitting the " +
        "primary (single-target share; clones mostly strike other enemies)"] };
    },
    // Bomb traps from any follow-up in range (cap 5): 25% per hit and
    // -1% SPA per hit for this unit (cap -5%).
    "Bomb Tags Master": function (T) {
      var u = UP(T, "ukitake_bombs", 70);
      var ppm = N(T, "ukitake_bomb_hits", 5);
      var extra = 0.25 * ppm / 60;
      return { spa: -0.05 * u, extra: extra,
        notes: ["Bomb Tags: 25% per trap hit (" + ppm + "/min, estimated); " +
        "-1% SPA per live trap at " + Math.round(u * 100) + "% (cap -5%)"] };
    }
  });
  A.registerUnitVars("Water Sage (Founder)", [
    V("ukitake_clones", "Clone cap progress %", "Toward 3 clones on the map - default 70%", 0, 100, 70, 5),
    V("ukitake_clone_fups", "Clone follow-ups / min", "MirrorClone follow-ups hitting the primary per minute - default 2 (single-target share)", 0, 30, 2),
    V("ukitake_bombs", "Bomb trap uptime %", "Toward 5 live BombTags (-1% SPA each) - default 70%", 0, 100, 70, 5),
    V("ukitake_bomb_hits", "Bomb hits / min", "BombTag hits on the primary per minute - default 5 (estimated)", 0, 60, 5)
  ]);

  /* ====================== WILD CARD (ACE) ====================== */
  A.registerPassives("Wild Card (Ace)", {
    // Adds +2 ticks to every FireDoT this unit owns (feeds the Royal
    // Suit Fire damage - folded into that model's numbers).
    "Two-Five's Presence": function (T) {
      return { notes: ["Two-Five's Presence: +2 ticks on this unit's " +
        "FireDoT (folded into Royal Suit)"] };
    },
    // Attack rotation Jack / Queen / King / Joker, averaged over the
    // 4-attack cycle: King lands 1 instant 75% hit every 4 attacks; a
    // Fire DoT (modeled as 0.6x over 6s) is refreshed most rotations;
    // Jack's +15% Fire amp rides on the amp variable.
    "Royal Suit": function (T, ctx) {
      var amp = 1 + N(T, "joker_fire_amp", 25) / 100;
      var n = N(T, "joker_fire_targets", 1);
      var dotU = UP(T, "joker_dot_uptime", 50);
      var extra = 0.75 / (4 * ctx.spa) + 0.6 / 6 * n * amp * dotU;
      return { extra: extra, notes: ["Royal Suit (rotation averaged): " +
        "75% King hit / 4 attacks + Fire 0.6x/6s on " + n + " enemy x" +
        amp.toFixed(2) + " at " + Math.round(dotU * 100) + "% DoT uptime"] };
    },
    // Every 5 attacks: double-efficiency proc (does not advance the
    // rotation) and +5% Fire damage per activation (cap +50%) - the amp
    // variable feeds Royal Suit.
    "Fifty-Two Bluff": function (T) {
      return { notes: ["Fifty-Two Bluff: double-efficiency proc every 5 " +
        "attacks; +5% Fire damage per proc (cap 50%) - set the Fire amp " +
        "variable of Royal Suit accordingly"] };
    }
  });
  A.registerUnitVars("Wild Card (Ace)", [
    V("joker_fire_amp", "Fire amp %", "FireDoT damage bonus (Jack procs + Fifty-Two Bluff, cap 50) - default 25", 0, 50, 25, 5),
    V("joker_fire_targets", "Fire targets", "Enemies carrying this unit's FireDoT - default 1 (single-target view)", 0, 10, 1),
    V("joker_dot_uptime", "FireDoT uptime %", "Share of time the primary target carries this unit's FireDoT - default 50%", 0, 100, 50, 5)
  ]);

  /* ====================== WOLF (REVIVED) ====================== */
  A.registerPassives("Wolf (Revived)", {
    // Attacks 1-4 fire StarrkEVO_Skill1 with a cumulative +50% SPA per
    // attack in the cycle; the 5th resets it. Cycle intervals:
    // 1.0 + 1.5 + 2.0 + 2.5 + 3.0 = 10x base for 5 attacks -> average
    // 2x SPA (the penalty variable exposes this arithmetic).
    "Rhythm of the Wolf": function (T) {
      var p = N(T, "starrk_spa_penalty", 100) / 100;
      return { spa: p, notes: ["Rhythm of the Wolf: cycle SPA penalty +" +
        Math.round(p * 100) + "% average (1+1.5+2+2.5+3 over 5 attacks); " +
        "Skill1 multi-hit is not counted - adjust if needed"] };
    },
    // The 5th attack deals +100% (and has infinite range): averaged over
    // the 5-attack cycle that is +20% damage.
    "Howling Tempest": function () {
      return { dmg: 0.20, notes: ["Howling Tempest: 5th attack +100% " +
        "(cycle average +20% damage)"] };
    },
    // Each 5th attack spawns 2 StarrkWolves (cap 3): 15% of this unit's
    // damage per hit (they delete themselves after attacking) + ManaBurn.
    "Soul Pack": function (T, ctx) {
      // Each wolf deals 15% of unit damage and adds ManaBurn for 15% of its
      // own hit (2.25% of unit damage per wolf).
      var extra = (2 * 0.15 + 2 * 0.15 * 0.15) / (10 * ctx.spa);
      return { extra: extra, notes: ["Soul Pack: 2 wolves x15% + ManaBurn " +
        "15% of wolf damage per cycle (~10 x SPA seconds)"] };
    },
    // Ability: 5s pause then 8s of constant fire at 65% damage per
    // second (+100% ManaBurn over 6s, always crits).
    "Zero Machine Gun": function (T, ctx) {
      var ppm = N(T, "starrk_ability_ppm", 1);
      var penalty = N(T, "starrk_spa_penalty", 100) / 100;
      var effSpa = (ctx.spa || 1) * (1 + penalty);
      // The 5s windup + 8s firing replace normal attacks: only the net gain
      // over those attacks is extra damage.
      var replaced = 13 / effSpa * 1.20;
      var ability = 0.65 * 8 + 1.00;
      var extra = Math.max(0, ability - replaced) * ppm / 60;
      return { extra: extra, notes: ["Zero Machine Gun: net " +
        ability.toFixed(2) + "x ability - " + replaced.toFixed(2) +
        "x replaced attacks per 13s window, " + ppm + "/min"] };
    }
  });
  A.registerUnitVars("Wolf (Revived)", [
    V("starrk_spa_penalty", "Cycle SPA penalty %", "Average SPA increase from the 4 skill attacks - default 100 (see model note)", 0, 200, 100, 5),
    V("starrk_ability_ppm", "Ability uses / min", "Zero Machine Gun activations per minute - default 1 (estimated)", 0, 10, 1)
  ]);

  return A;
});
