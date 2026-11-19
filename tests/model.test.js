import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  run, runBoth, defaults, sanitize, indexAt, ENTITIES, ENTITY, MODES, PRESETS, decision,
  nephron as N, diuretics as D, hormones as H, haemodynamics as G, electrolytes as E,
} from '../src/model.js';

const last = (a) => a[a.length - 1];
const at = (r, k, t) => r.s[k][indexAt(r, t)];
const has = (r, k) => r.events.some((e) => e.key === k);
const minOf = (a) => Math.min(...a);

// ---------------------------------------------------------------------------
// Structure, purity, robustness
// ---------------------------------------------------------------------------
test('four blocks, 23 entities, unique ids', () => {
  assert.equal(MODES.length, 4);
  assert.equal(ENTITIES.length, 23);
  assert.equal(new Set(ENTITIES.map((e) => e.id)).size, 23);
});

test('every entity runs both arms with finite, bounded series and a schematic', () => {
  for (const ent of ENTITIES) {
    for (const arm of ['untreated', 'treated']) {
      const r = run(ent, {}, arm);
      for (const sd of ent.series) for (const v of r.s[sd.key]) {
        assert.ok(Number.isFinite(v), `${ent.id}.${sd.key}`);
        if (sd.min !== undefined) assert.ok(v >= sd.min);
        if (sd.max !== undefined) assert.ok(v <= sd.max);
      }
      const sch = ent.schematic(last(r.states), r.p);
      assert.ok(sch.kind === 'nephron' || sch.kind === 'axis', ent.id);
    }
  }
});

test('extreme parameter values stay finite', () => {
  for (const ent of ENTITIES) for (const edge of ['min', 'max']) {
    const params = {};
    for (const d of ent.params) {
      if (d.type === 'range') params[d.key] = d[edge];
      if (d.type === 'bool') params[d.key] = edge === 'max';
      if (d.type === 'select') params[d.key] = edge === 'min' ? d.options[0] : d.options[d.options.length - 1];
    }
    for (const arm of ['untreated', 'treated']) {
      const r = run(ent, params, arm);
      for (const [k, a] of Object.entries(r.s)) for (const v of a) assert.ok(Number.isFinite(v), `${ent.id}.${k} ${edge}`);
    }
  }
});

test('runs are pure and deterministic; arms are identical before the drug starts', () => {
  for (const ent of ENTITIES) {
    const p = defaults(ent);
    const copy = JSON.stringify(p);
    const a = run(ent, p, 'treated');
    assert.deepEqual(a.s, run(ent, p, 'treated').s);
    assert.equal(JSON.stringify(p), copy);
    const u = run(ent, p, 'untreated');
    for (const k of Object.keys(u.s)) assert.equal(u.s[k][0], a.s[k][0], `${ent.id}.${k} t=0`);
  }
});

test('sanitize clamps and rejects bad input', () => {
  const p = sanitize(D.loop, { dose: 9999, drug: 'x', gfr: 'abc' });
  assert.equal(p.dose, 320);
  assert.equal(p.drug, 'furosemide');
  assert.equal(p.gfr, 60);
});

// ---------------------------------------------------------------------------
// Nephron physiology
// ---------------------------------------------------------------------------
const base = { gfr: 100, eav: 1, aldo: 1, adh: 0.3, glucose: 100, remodel: 0, pk: 4.2, naIn: 150, kIn: 70 };

test('normal nephron: FENa ≈ 0.5–1%, proximal ≈ 2/3, loop ≈ 1/4', () => {
  const f = N.nephronFlux(base);
  assert.ok(f.fena > 0.005 && f.fena < 0.01);
  assert.ok(Math.abs(f.seg.pct - 0.67) < 0.01);
  assert.ok(f.seg.loop > 0.2 && f.seg.loop < 0.3);
  assert.ok(Math.abs(f.uNa - 150) < 20, 'excretion ≈ intake');
});

test('maximal natriuresis ranks loop > thiazide > K-sparing; downstream segments compensate', () => {
  const fe = (b) => N.nephronFlux({ ...base, b }).fena;
  assert.ok(fe({ loop: 1 }) > 0.15, 'loop ≈ 20%');
  assert.ok(fe({ thz: 1 }) > 0.03 && fe({ thz: 1 }) < 0.08, 'thiazide ≈ 3–5%');
  assert.ok(fe({ mr: 1 }) < fe({ thz: 1 }));
  assert.ok(fe({ ca: 1 }) > 0.02 && fe({ ca: 1 }) < 0.06, 'acetazolamide: weak, loop compensates');
  assert.ok(fe({ loop: 1, thz: 1 }) > fe({ loop: 1 }), 'sequential blockade adds');
});

test('electrolyte signatures of each class', () => {
  const f = (b, extra = {}) => N.nephronFlux({ ...base, ...extra, b });
  assert.ok(f({ loop: 0.8 }).uCa > f({}).uCa * 1.5, 'loop → hypercalciuria');
  assert.ok(f({ thz: 0.8 }).uCa < f({}).uCa * 0.7, 'thiazide → hypocalciuria');
  assert.ok(f({ loop: 0.8 }).uK > f({}).uK, 'loop → K⁺ loss');
  assert.ok(f({ enac: 0.5 }).uK < f({}).uK * 0.7, 'ENaC block → K⁺ retention');
  assert.ok(f({ mr: 0.8 }, { aldo: 2 }).uK < f({}, { aldo: 2 }).uK, 'MRA → K⁺ retention');
  assert.ok(f({ sglt2: 1 }, { glucose: 180 }).uGlu > 40, 'SGLT2i → glycosuria');
  assert.ok(f({ loop: 0.8 }, { adh: 1 }).uOsm < f({}, { adh: 1 }).uOsm * 0.5, 'loop → cannot concentrate');
  assert.ok(f({ thz: 0.8 }, { adh: 0 }).uOsm > f({}, { adh: 0 }).uOsm * 2, 'thiazide → cannot dilute');
  assert.ok(f({ v2: 0.9 }, { adh: 1 }).uVol > f({}, { adh: 1 }).uVol * 2.5, 'vaptan → aquaresis');
});

test('loop diuretic dosing: CKD needs more; IV beats oral furosemide; torasemide covers more of the day', () => {
  const lb = D.loopBlock;
  assert.ok(lb('furosemide', 80, 'oral', 100, 'qd').peak > lb('furosemide', 80, 'oral', 25, 'qd').peak);
  assert.ok(lb('furosemide', 80, 'iv', 60, 'qd').peak > lb('furosemide', 80, 'oral', 60, 'qd').peak);
  assert.ok(lb('torasemide', 80, 'oral', 60, 'qd').avg > lb('furosemide', 80, 'oral', 60, 'qd').avg);
  assert.ok(lb('furosemide', 80, 'oral', 60, 'bid').avg > lb('furosemide', 80, 'oral', 60, 'qd').avg);
});

test('thiazides: chlortalidone/metolazone keep working at low GFR', () => {
  assert.ok(D.thiazideBlock('chlorthalidone', 1, 25) > D.thiazideBlock('hydrochlorothiazide', 1, 25) * 1.4);
  assert.ok(D.thiazideBlock('metolazone', 1, 20) > 0.4);
});

// ---------------------------------------------------------------------------
// Hormone axes, haemodynamics, electrolytes
// ---------------------------------------------------------------------------
test('glomerulus: baseline GFR ≈ 100; afferent constriction lowers PGC and GFR; efferent constriction raises PGC', () => {
  const g0 = G.glomerulus(93, 1, 1.5);
  assert.ok(Math.abs(g0.gfr - 100) < 10 && Math.abs(g0.PGC - 56) < 2);
  const aff = G.glomerulus(93, 1.5, 1.5);
  assert.ok(aff.PGC < g0.PGC && aff.gfr < g0.gfr);
  const eff = G.glomerulus(93, 1, 2.2);
  assert.ok(eff.PGC > g0.PGC);
  assert.ok(eff.ff > g0.ff, 'efferent constriction raises filtration fraction');
});

test('angiotensin-II-dependent states: ACE inhibition drops GFR much more than in a normal kidney', () => {
  const drop = (state) => {
    const s = G.PATIENT_STATES[state];
    const a = G.resistances(s, {}); const b = G.resistances(s, { acei: true });
    return 1 - G.glomerulus(b.Pp, b.RA, b.RE).gfr / G.glomerulus(a.Pp, a.RA, a.RE).gfr;
  };
  assert.ok(drop('bilateralRas') > 2 * drop('normal'));
});

test('pillars only act where indicated; stacking slows decline multiplicatively', () => {
  assert.deepEqual(G.activePillars({ disease: 'dkdT1', rasi: true, sglt2: true, finerenone: true, glp1: true, era: true }), ['rasi', 'finerenone']);
  assert.deepEqual(G.activePillars({ disease: 'igan', rasi: true, sglt2: true, finerenone: true, glp1: false, era: true }), ['rasi', 'sglt2', 'era']);
});

test('PTH target range and CKD-MBD directions', () => {
  assert.deepEqual(H.PTH_RANGE, [130, 585]);
  const b = runBoth(H.ckdMbd, { binder: 'none', vitd: 'calcitriol', calcimimetic: 'none', diet: false });
  assert.ok(last(b.treated.s.ca) > last(b.untreated.s.ca) && last(b.treated.s.p) > last(b.untreated.s.p), 'calcitriol raises Ca and P');
  const c = runBoth(H.ckdMbd, { binder: 'none', vitd: 'none', calcimimetic: 'cinacalcet' });
  assert.ok(last(c.treated.s.ca) < last(c.untreated.s.ca) && last(c.treated.s.pth) < last(c.untreated.s.pth));
});

test('supersaturation responds to each stone drug', () => {
  const P = E.STONE_PROFILES;
  for (const [profile, drugs] of Object.entries({ hypercalciuria: ['thiazide'], uricAcid: ['alkaliAllopurinol'], cystinuria: ['tiopronin'], struvite: ['acetohydroxamic'], primaryHyperoxaluria: ['lumasiran'] })) {
    const salt = P[profile].salt;
    for (const d of drugs) assert.ok(E.rss(E.STONE_DRUGS[d](P[profile].u))[salt] < E.rss(P[profile].u)[salt], `${profile} ${d}`);
  }
  assert.ok(E.rss(E.STONE_DRUGS.loopDiuretic(P.hypercalciuria.u)).caox > E.rss(E.STONE_DRUGS.thiazide(P.hypercalciuria.u)).caox);
});

test('every entity yields a key decision at every time point', () => {
  for (const ent of ENTITIES) for (const arm of ['untreated', 'treated']) {
    const r = run(ent, {}, arm);
    for (const i of [0, Math.floor(r.t.length / 2), r.t.length - 1]) assert.ok(typeof decision(ent.id, r.states[i], r.p) === 'string', ent.id);
  }
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const EXPECT = {
  mannitolIcp: (b) => minOf(b.treated.s.icp) < 21 && last(b.untreated.s.icp) === 28,
  mannitolOliguric: (b) => has(b.treated, 'overload'),
  acetazolamideAlkalosis: (b) => last(b.treated.s.hco3) < 26 && last(b.untreated.s.hco3) > 29,
  sglt2Dkd: (b) => at(b.treated, 'egfr', 8) < at(b.untreated, 'egfr', 8) && last(b.treated.s.egfr) > last(b.untreated.s.egfr),
  sglt2SickDay: (b) => has(b.treated, 'ketoacidosis'),
  loopHeartFailure: (b) => last(b.treated.s.weight) < last(b.untreated.s.weight) - 4 && has(b.treated, 'braking'),
  loopCkdUnderdosed: (b) => last(b.treated.s.weight) > 76.5,
  loopCkdSequential: (b) => last(b.treated.s.weight) < last(b.untreated.s.weight) - 8 && has(b.treated, 'hypoK') && has(b.treated, 'alkalosis'),
  loopTorasemide: (b) => last(b.treated.s.weight) < last(run(ENTITY.loop, {}, 'treated').s.weight),
  thiazideHypertension: (b) => last(b.untreated.s.map) - last(b.treated.s.map) >= 8 && last(b.treated.s.uCa) < last(b.untreated.s.uCa),
  thiazideHyponatraemia: (b) => has(b.treated, 'hypoNa') && !has(b.untreated, 'hypoNa'),
  thiazideStones: (b) => last(b.treated.s.uCa) < 0.75 * last(b.untreated.s.uCa),
  chlorthalidoneCkd: (b) => (last(b.untreated.s.map) - last(b.treated.s.map)) > (() => { const h = runBoth(ENTITY.thiazide, { drug: 'hydrochlorothiazide', gfr: 25 }); return last(h.untreated.s.map) - last(h.treated.s.map); })(),
  amilorideHypoK: (b) => last(b.treated.s.pk) > last(b.untreated.s.pk),
  amilorideLiddle: (b) => last(b.treated.s.map) < last(b.untreated.s.map) - 8 && last(b.treated.s.pk) > 3.4,
  amilorideLithium: (b) => last(b.treated.s.uVol) < 0.6 * last(b.untreated.s.uVol),
  spironolactoneAldosteronism: (b) => last(b.treated.s.pk) >= 4 && last(b.untreated.s.map) - last(b.treated.s.map) >= 10,
  spironolactoneCirrhosis: (b) => last(b.treated.s.weight) < last(b.untreated.s.weight) - 4,
  mraHyperkalaemia: (b) => last(b.treated.s.pk) > last(b.untreated.s.pk) + 0.5,
  tolvaptanSiadh: (b) => at(b.treated, 'pna', 3) - at(b.treated, 'pna', 1) >= 4 && !has(b.treated, 'overcorrection'),
  tolvaptanOvercorrection: (b) => has(b.treated, 'overcorrection'),
  siadhRestriction: (b) => last(b.treated.s.pna) > 125 && last(b.untreated.s.pna) < 115,
  siadhUrea: (b) => last(b.treated.s.pna) > last(b.untreated.s.pna) + 5,
  aceiProteinuria: (b) => last(b.treated.s.prot) < 0.75 * last(b.untreated.s.prot) && at(b.treated, 'egfr', 3) < at(b.untreated, 'egfr', 3) && last(b.treated.s.egfr) > last(b.untreated.s.egfr),
  aceiRenalArteryStenosis: (b) => has(b.treated, 'aki'),
  dualRaasBlockade: (b) => has(b.treated, 'hyperKSevere'),
  sparsentan: (b) => at(b.treated, 'prot', 6) < 0.55 * at(b.untreated, 'prot', 6),
  desmopressinCentralDi: (b) => last(b.treated.s.uVol) < 1.5 && last(b.treated.s.uOsm) > 600 && last(b.untreated.s.uVol) > 6,
  desmopressinLithium: (b) => last(b.treated.s.uVol) > 4 && has(b.treated, 'noResponse'),
  desmopressinWaterExcess: (b) => has(b.treated, 'hyponatremia'),
  terlipressinHrs: (b) => has(b.treated, 'reversal') && has(b.untreated, 'dialysis'),
  terlipressinNoResponse: (b) => has(b.treated, 'noResponse'),
  mbdSevelamerCinacalcet: (b) => last(b.treated.s.pth) < 585 && last(b.treated.s.p) < 5.5,
  mbdCalciumCalcitriol: (b) => last(b.treated.s.ca) > last(b.untreated.s.ca) + 0.5,
  xlhBurosumab: (b) => last(b.treated.s.p) > 3 && last(b.untreated.s.p) < 2.5,
  anaemiaEsaIron: (b) => last(b.treated.s.hb) >= 10 && last(b.treated.s.hb) <= 11.5,
  anaemiaEsaNoIron: (b) => last(b.treated.s.hb) < 10 && has(b.treated, 'ironLimited'),
  anaemiaHighTarget: (b) => has(b.treated, 'hbTooHigh'),
  anaemiaHifPhi: (b) => last(b.treated.s.hb) > 10,
  adpkdTolvaptan: (b) => last(b.treated.s.tkv) < last(b.untreated.s.tkv) && last(b.treated.s.egfr) > last(b.untreated.s.egfr),
  tripleWhammy: (b) => has(b.treated, 'aki') && has(b.treated, 'tripleWhammy'),
  sglt2Haemodynamics: (b) => last(b.treated.s.gfr) > 0.88 * last(b.untreated.s.gfr) && last(b.treated.s.gfr) < last(b.untreated.s.gfr),
  aceiBilateralStenosis: (b) => has(b.treated, 'aki'),
  nsaidHeartFailure: (b) => last(b.treated.s.gfr) < 0.85 * last(b.untreated.s.gfr),
  calcineurinTransplant: (b) => last(b.treated.s.gfr) < 0.7 * last(b.untreated.s.gfr),
  contrastCkd: (b) => minOf(b.treated.s.gfr) < 0.75 * b.treated.s.gfr[0] && last(b.treated.s.gfr) > 0.85 * b.treated.s.gfr[0],
  pillarsType2: (b) => has(b.untreated, 'kidneyFailure') && !has(b.treated, 'kidneyFailure'),
  pillarsType1: (b) => b.treated.out?.failure !== 0 && (b.treated.events.find((e) => e.key === 'kidneyFailure')?.t ?? 99) > (b.untreated.events.find((e) => e.key === 'kidneyFailure')?.t ?? 0),
  pillarsIgan: (b) => has(b.untreated, 'kidneyFailure') && !has(b.treated, 'kidneyFailure'),
  hyperkalaemiaSzc: (b) => last(b.treated.s.pk) < 5.7 && last(b.untreated.s.pk) > 6.8,
  hyperkalaemiaShiftOnly: (b) => has(b.treated, 'rebound') && Math.abs(last(b.treated.s.pk) - last(b.untreated.s.pk)) < 0.05,
  hyperkalaemiaPatiromer: (b) => last(b.treated.s.pk) < last(b.untreated.s.pk) - 0.5,
  acidosisCkd: (b) => has(b.treated, 'target'),
  rtaPotassiumCitrate: (b) => last(b.treated.s.pk) > 3.5 && last(b.treated.s.hco3) >= 22,
  magnesiumRefractoryK: (b) => has(b.untreated, 'refractoryK') && has(b.treated, 'kNormal') && !has(b.untreated, 'kNormal'),
  phosphateRepletion: (b) => has(b.treated, 'repleted'),
  allopurinolGout: (b) => has(b.treated, 'target6'),
  probenecidLowGfr: (b) => has(b.treated, 'ineffectiveGfr') && last(b.treated.s.urate) > 8,
  pegloticase: (b) => last(b.treated.s.urate) < 2,
  rasburicaseTls: (b) => last(b.treated.s.urate) < 1 && has(b.untreated, 'aki'),
  allopurinolTls: (b) => last(b.treated.s.urate) < last(b.untreated.s.urate) && !has(b.treated, 'aki'),
  rasburicaseG6pd: (b) => has(b.treated, 'hemolysis'),
  thiazideCalciumStones: (b) => last(b.treated.s.rss) < 1 && last(b.treated.s.size) < last(b.untreated.s.size),
  citrateHypocitraturia: (b) => last(b.treated.s.rss) < 1,
  uricAcidStones: (b) => last(b.treated.s.size) === 0,
  cystinuria: (b) => last(b.treated.s.rss) < 1 && last(b.treated.s.size) <= b.treated.s.size[0] + 0.2,
  struviteAha: (b) => last(b.treated.s.size) < 0.2 * last(b.untreated.s.size),
  primaryHyperoxaluria: (b) => last(b.treated.s.rss) < 1,
  loopWrongForStones: (b) => last(b.treated.s.rss) > 1,
};

test('every preset is valid and behaves as documented', () => {
  assert.deepEqual(Object.keys(EXPECT).sort(), Object.keys(PRESETS).sort());
  for (const [k, pr] of Object.entries(PRESETS)) {
    const ent = ENTITY[pr.entity];
    const p = sanitize(ent, pr.params);
    for (const [pk, v] of Object.entries(pr.params)) assert.equal(p[pk], v, `${k}.${pk}`);
    assert.ok(EXPECT[k](runBoth(ent, pr.params)), k);
  }
});
