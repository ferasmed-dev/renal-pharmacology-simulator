// Diuretics in nephron order. Each entity = a patient (untreated course) + a drug started on day 1.
import { clamp, relax } from './core.js';
import { bodyInit, bodyStep } from './nephron.js';

const DRUG_DAY = 1; // the drug starts on day 1 in the treated arm

/** Schematic description for the nephron diagram. */
export function nephronDesc(st, b = {}, extra = {}) {
  return {
    kind: 'nephron', seg: st.seg, distal: st.distal, fena: st.fena, b, aldo: st.aldo, adh: st.adh,
    gradient: 1 - 0.7 * (b.loop || 0), kSec: clamp((st.uK || 70) / 70, 0.2, 3), uVol: st.uVol, ...extra,
  };
}

/** Factory for entities that run on the shared body/nephron model. */
function nephronEntity(cfg) {
  return {
    mode: 'diur', unit: 'd', dt: 0.05, region: ['nephron'], ...cfg,
    init(p, arm, emit) {
      const pt = cfg.patient(p);
      const st = bodyInit(pt);
      st.on = false; st.peakNa = 0; st.naHist = [];
      // settle the patient's own steady state for a short run-in (no drug) so both arms start identical
      for (let i = 0; i < (cfg.runIn ?? 40); i++) bodyStep(st, pt, cfg.background ? cfg.background(p) : {}, 0.05, cfg.extra ? cfg.extra(p, false, st) : {});
      cfg.reset?.(st, pt, p);
      return st;
    },
    step(st, t, dt, p, arm, emit) {
      const pt = cfg.patient(p);
      const on = arm === 'treated' && t >= DRUG_DAY;
      if (on && !st.on) { st.on = true; st.tOn = t; emit('start', cfg.startVars ? cfg.startVars(p) : {}); }
      const b = { ...(cfg.background ? cfg.background(p) : {}), ...(on ? cfg.blocks(p, st, t) : {}) };
      st.b = b;
      bodyStep(st, pt, b, dt, cfg.extra ? cfg.extra(p, on, st, t) : {});
      st.naHist.push(st.pna);
      if (st.naHist.length > Math.round(1 / dt) + 1) st.naHist.shift();
      st.rate24 = st.pna - st.naHist[0];
      cfg.events?.(st, t, p, arm, emit, on);
      return st;
    },
    schematic(st, p) { return nephronDesc(st, st.b || {}, cfg.schemExtra ? cfg.schemExtra(st, p) : {}); },
  };
}

// ---------------------------------------------------------------------------
// Patient profiles (Model values chosen to reproduce typical clinical pictures)
// ---------------------------------------------------------------------------
export const PATIENTS = {
  heartFailure: (gfr = 60, naIn = 100) => ({ tbw: 47, ecf: 19, gfr, eav: 0.85, aldo: 1.6, naIn, kIn: 60, water: 1.5, map: 85, saltSens: 0.5, urate: 7 }),
  hypertension: (gfr = 85) => ({ tbw: 42.5, ecf: 14.5, gfr, eav: 1, aldo: 1, naIn: 150, kIn: 70, water: 2.2, map: 112, saltSens: 4, urate: 6.2 }),
  elderlyLowSolute: (gfr = 60) => ({ tbw: 33, ecf: 11, gfr, eav: 1, aldo: 1, naIn: 70, kIn: 50, water: 2.6, urea: 200, map: 108, saltSens: 4, urate: 6 }),
  cirrhosis: (gfr = 70) => ({ tbw: 50, ecf: 22, gfr, eav: 0.75, aldo: 3, naIn: 80, kIn: 60, water: 1.5, map: 78, saltSens: 0.3, urate: 6 }),
  primaryAldo: (gfr = 90) => ({ tbw: 43, ecf: 15, gfr, eav: 1.05, aldoFixed: 3, naIn: 150, kIn: 70, water: 2.2, map: 115, saltSens: 3, pk: 3.1, hco3: 30, urate: 6 }),
  postDiureticAlkalosis: (gfr = 55) => ({ tbw: 45, ecf: 17, gfr, eav: 0.85, aldo: 1.8, naIn: 100, kIn: 60, water: 1.6, map: 90, saltSens: 0.5, pk: 3.4, hco3: 33, hco3Offset: 5, urate: 7.5 }),
  siadh: (gfr = 90, water = 1.8) => ({ tbw: 49, ecf: 14, pna: 120, gfr, eav: 1.05, aldo: 0.8, adhFixed: 0.95, naIn: 120, kIn: 60, water, map: 95, saltSens: 1, urate: 3.5 }),
};

// ---------------------------------------------------------------------------
// 1. Osmotic diuretics — mannitol (own model: hours, intracranial pressure)
// ---------------------------------------------------------------------------
export const osmotic = {
  id: 'osmotic', mode: 'diur', unit: 'h', tMax: 24, dt: 0.05, region: ['nephron'],
  params: [
    { key: 'dose', type: 'range', min: 0.25, max: 1.5, step: 0.25, def: 1, unit: 'g/kg' },
    { key: 'repeat', type: 'bool', def: false },
    { key: 'oliguric', type: 'bool', def: false },
  ],
  series: [
    { key: 'icp', unit: 'mmHg', min: 0 },
    { key: 'posm', unit: 'mOsm/kg' },
    { key: 'urine', unit: 'mL/h', min: 0 },
  ],
  init() { return { M: 0, icp: 28, posm: 288, urine: 60, pna: 140, shift: 0, waterLost: 0, given: 0, ecfGain: 0 }; },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    const doses = p.repeat ? [1, 7, 13, 19] : [1];
    for (const td of doses) if (treated && t >= td && st.given < doses.indexOf(td) + 1) { st.given += 1; st.M += p.dose * 70; emit('bolus', { g: Math.round(p.dose * 70) }, false); }
    // Mannitol (MW 182) stays extracellular and is excreted by filtration (t½ ≈ 2 h; much longer if oliguric).
    const kElim = p.oliguric ? 0.03 : 0.35;
    const excreted = kElim * st.M * dt;
    st.M = Math.max(0, st.M - excreted);
    const mOsm = (st.M / 0.182) / 14; // mOsm/L in a 14 L extracellular space
    st.posm = 288 + 0.75 * mOsm + 0.02 * st.waterLost / 100;
    const gap = st.posm - 288;
    // Brain water moves out along the gradient: ICP falls within ~30 min and drifts back as mannitol is cleared.
    st.icp = relax(st.icp, Math.max(8, 28 - 0.55 * gap), dt, 0.4);
    // Osmotic diuresis: each mOsm of mannitol carries water; oliguria prevents it.
    const osmFlow = (excreted / dt / 0.182) * 2.2; // mL/h
    st.urine = relax(st.urine, (p.oliguric ? 15 : 60) + (p.oliguric ? 0 : osmFlow), dt, 0.3);
    st.waterLost += Math.max(0, st.urine - 60) * dt;
    st.ecfGain = p.oliguric ? Math.min(3, st.ecfGain + 0.04 * gap * dt) : relax(st.ecfGain, 0, dt, 2);
    // Water drawn from cells first dilutes Na⁺ (translocational hyponatraemia); later free-water loss raises it.
    st.pna = 140 - 0.35 * gap + st.waterLost / 1000 * 3.3;
    if (treated && st.icp < 20) emit('icpControlled');
    if (gap > 20) emit('osmGap');
    if (st.pna > 148) emit('hypernatremia');
    if (st.ecfGain > 1.5) emit('overload');
    return st;
  },
  steps(st, p, arm) {
    const k = ['raisedIcp'];
    if (st.M > 1) k.push('filtered', 'gradient', 'brain');
    if (st.urine > 120) k.push('diuresis');
    if (st.pna > 145) k.push('freeWater');
    if (st.ecfGain > 1) k.push('overload');
    return k;
  },
  gauges(st) { return [{ key: 'pna', value: st.pna, unit: 'mmol/L', lo: 135, hi: 145 }, { key: 'gap', value: Math.max(0, st.posm - 288), unit: 'mOsm/kg', lo: 0, hi: 20 }]; },
  schematic(st) {
    const on = st.M > 1;
    return { kind: 'nephron', seg: { pct: on ? 0.6 : 0.67, loop: 0.25, dct: 0.045, cd: 0.03 }, distal: 0.05, b: { osm: on ? Math.min(1, st.M / 70) : 0 }, aldo: 1, adh: 0.4, gradient: on ? 0.6 : 1, kSec: 1, uVol: st.urine * 24 / 1000 };
  },
};

// ---------------------------------------------------------------------------
// 2. Carbonic anhydrase inhibitors — acetazolamide (metabolic alkalosis after diuresis)
// ---------------------------------------------------------------------------
export const carbonicAnhydrase = nephronEntity({
  id: 'carbonicAnhydrase', tMax: 7,
  params: [
    { key: 'dose', type: 'select', options: ['mg250', 'mg500'], def: 'mg500' },
    { key: 'kSupplement', type: 'bool', def: false },
    { key: 'gfr', type: 'range', min: 20, max: 100, step: 5, def: 55, unit: 'mL/min' },
  ],
  series: [
    { key: 'hco3', unit: 'mmol/L' },
    { key: 'pk', unit: 'mmol/L' },
    { key: 'uPH', unit: '' },
  ],
  patient: (p) => ({ ...PATIENTS.postDiureticAlkalosis(p.gfr), kIn: p.kSupplement ? 120 : 60 }),
  blocks: (p) => ({ ca: p.dose === 'mg500' ? 0.85 : 0.65 }),
  events(st, t, p, arm, emit, on) {
    if (on && st.hco3 < 29) emit('hco3Down');
    if (st.pk < 3.2) emit('hypoK');
    if (on && st.uPH > 7) emit('alkalineUrine');
  },
  steps(st, p, arm) {
    const k = ['alkalosis'];
    if (st.on) k.push('blockCA', 'bicarbonaturia');
    if (st.on && st.distal > 0.045) k.push('kLoss');
    if (st.on && st.uPH > 7) k.push('stoneRisk');
    return k;
  },
  gauges(st) { return [{ key: 'natriuresis', value: st.uNa, unit: 'mmol/d', lo: 0, hi: 1000, band: false }, { key: 'fena', value: st.fena * 100, unit: '%', lo: 0.3, hi: 1.5 }]; },
});

// ---------------------------------------------------------------------------
// 3. SGLT2 inhibitors (own model: weeks; tubuloglomerular feedback and the eGFR "dip")
// ---------------------------------------------------------------------------
export const SGLT2_DRUGS = ['empagliflozin', 'dapagliflozin', 'canagliflozin', 'ertugliflozin', 'sotagliflozin'];
export const sglt2 = {
  id: 'sglt2', mode: 'diur', unit: 'w', tMax: 156, dt: 0.25, region: ['nephron'],
  params: [
    { key: 'drug', type: 'select', options: SGLT2_DRUGS, def: 'dapagliflozin' },
    { key: 'egfr0', type: 'range', min: 20, max: 90, step: 5, def: 55, unit: 'mL/min' },
    { key: 'glucose', type: 'range', min: 100, max: 300, step: 10, def: 170, unit: 'mg/dL' },
    { key: 'sickDay', type: 'bool', def: false },
  ],
  series: [
    { key: 'egfr', unit: 'mL/min', min: 0 },
    { key: 'pgc', unit: 'mmHg', min: 0 },
    { key: 'uGlu', unit: 'g/d', min: 0 },
  ],
  init(p) { return { struct: p.egfr0, dip: 0, egfr: p.egfr0, pgc: 60, uGlu: Math.max(0, (p.glucose - 180) * 10 * p.egfr0 * 1.44 / 1000), weight: 0, on: false, ketoacidosis: false }; },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated' && t >= 1;
    if (treated && !st.on) { st.on = true; emit('start', { drug: p.drug }); }
    // Structural decline: ≈ −4.5 mL/min/year untreated vs ≈ −2 with SGLT2i (DAPA-CKD / EMPA-KIDNEY order). Model.
    st.struct = Math.max(5, st.struct - ((treated ? 2 : 4.5) / 52) * dt);
    // Haemodynamic dip: afferent constriction via tubuloglomerular feedback, ≈ −8% within 2–4 weeks, reversible.
    st.dip = relax(st.dip, treated ? 0.08 : 0, dt, 1.5);
    st.egfr = st.struct * (1 - st.dip);
    st.pgc = relax(st.pgc, treated ? 52 : 60, dt, 1.5);
    const filtered = p.glucose * 10 * st.egfr * 1.44 / 1000;
    st.uGlu = Math.max(0, (p.glucose - 180) * 10 * st.egfr * 1.44 / 1000) + (treated ? 0.3 * filtered : 0);
    st.weight = relax(st.weight, treated ? -2 : 0, dt, 12);
    if (treated && st.dip > 0.06) emit('dip');
    if (treated && t > 40) emit('slope');
    if (treated && p.sickDay && t > 20 && !st.ketoacidosis) { st.ketoacidosis = true; emit('ketoacidosis'); }
    if (st.egfr < 20) emit('below20');
    return st;
  },
  steps(st, p, arm) {
    const k = ['hyperfiltration'];
    if (st.on) k.push('glycosuria', 'maculaDensa', 'afferent', 'dip');
    if (st.on && st.dip > 0.07) k.push('protection');
    return k;
  },
  gauges(st) { return [{ key: 'weight', value: st.weight, unit: 'kg', lo: -5, hi: 0, band: false }]; },
  schematic(st) {
    return { kind: 'nephron', seg: { pct: st.on ? 0.65 : 0.67, loop: 0.25, dct: 0.045, cd: 0.03 }, distal: 0.04, b: { sglt2: st.on ? 1 : 0 }, aldo: 1, adh: 0.4, gradient: 1, kSec: 1, aff: st.on ? 0.75 : 1, eff: 1, pgc: st.pgc, glucose: st.uGlu };
  },
};

// ---------------------------------------------------------------------------
// 4. Loop diuretics — heart failure with oedema
// ---------------------------------------------------------------------------
/** Oral bioavailability and daily "coverage" (fraction of the day with effective block). Rounded: Model. */
export const LOOP_DRUGS = {
  furosemide: { F: 0.5, cover: 0.5 },
  bumetanide: { F: 0.85, cover: 0.45 },
  torasemide: { F: 0.85, cover: 0.75 },
  ethacrynic: { F: 0.9, cover: 0.5 },
};
/** Tubular secretion falls with GFR (organic anion transporters), so CKD needs higher doses. */
export const secretionFactor = (gfr, exp = 0.8) => Math.pow(clamp(gfr / 100, 0.05, 1.2), exp);
/** Loop block (0–1) from a furosemide-equivalent dose (mg; furosemide 40 mg ≈ bumetanide 1 mg ≈ torasemide 20 mg). */
export function loopBlock(drug, doseEq, route, gfr, freq) {
  const d = LOOP_DRUGS[drug];
  const E = doseEq * (route === 'iv' ? 1 : d.F) * secretionFactor(gfr);
  const peak = 0.97 * (E * E) / (E * E + 20 * 20);
  const cover = Math.min(0.95, d.cover * (freq === 'bid' ? 1.5 : 1));
  return { peak, avg: peak * cover, effective: E };
}
export const loop = nephronEntity({
  id: 'loop', tMax: 14,
  params: [
    { key: 'drug', type: 'select', options: Object.keys(LOOP_DRUGS), def: 'furosemide' },
    { key: 'dose', type: 'range', min: 20, max: 320, step: 20, def: 80, unit: 'mg' },
    { key: 'route', type: 'select', options: ['oral', 'iv'], def: 'oral' },
    { key: 'freq', type: 'select', options: ['qd', 'bid'], def: 'qd' },
    { key: 'gfr', type: 'range', min: 15, max: 100, step: 5, def: 60, unit: 'mL/min' },
    { key: 'addThiazide', type: 'bool', def: false },
    { key: 'naIn', type: 'range', min: 40, max: 200, step: 10, def: 100, unit: 'mmol/d' },
  ],
  series: [
    { key: 'weight', unit: 'kg' },
    { key: 'uNa', unit: 'mmol/d', min: 0 },
    { key: 'pk', unit: 'mmol/L' },
    { key: 'hco3', unit: 'mmol/L' },
  ],
  patient: (p) => PATIENTS.heartFailure(p.gfr, p.naIn),
  blocks: (p) => ({ loop: loopBlock(p.drug, p.dose, p.route, p.gfr, p.freq).avg, ...(p.addThiazide ? { thz: 0.6 } : {}) }),
  startVars: (p) => ({ drug: p.drug, dose: p.dose }),
  reset(st) { st.weight0 = st.weight; st.cr0 = st.cr; },
  events(st, t, p, arm, emit, on) {
    if (on) {
      st.peakNa = Math.max(st.peakNa, st.uNa);
      if (t > 3 && st.uNa < 0.7 * st.peakNa) emit('braking');
      if (st.remodel > 0.25 && !p.addThiazide && t > 6 && st.uNa < (p.naIn + 40)) emit('resistance');
      if (st.weight < st.weight0 - 2) emit('weightDown');
      if (p.route === 'iv' && p.dose >= 240) emit('ototoxicity');
      if (p.drug === 'ethacrynic') emit('ethacrynicOto');
    }
    if (st.pk < 3.5) emit('hypoK');
    if (st.hco3 > 29) emit('alkalosis');
    if (st.mg < 1.7) emit('hypoMg');
    if (st.cr > st.cr0 * 1.3) emit('prerenal');
  },
  steps(st, p, arm) {
    const k = ['congestion'];
    if (st.on) k.push('secretion', 'nkcc2', 'natriuresis', 'gradientLost');
    if (st.on && st.distal > 0.06) k.push('kSecretion');
    if (st.on && st.eav < 0.82) k.push('braking');
    if (st.on && st.remodel > 0.25) k.push('remodel');
    if (st.on && p.addThiazide) k.push('sequential');
    return k;
  },
  gauges(st) {
    return [
      { key: 'mg', value: st.mg, unit: 'mg/dL', lo: 1.7, hi: 2.4 },
      { key: 'uCa', value: st.uCa, unit: 'mg/d', lo: 100, hi: 300 },
      { key: 'urate', value: st.urate, unit: 'mg/dL', lo: 3.5, hi: 7 },
      { key: 'cr', value: st.cr, unit: 'mg/dL', lo: 0.6, hi: 1.3 },
    ];
  },
});

// ---------------------------------------------------------------------------
// 5. Thiazide and thiazide-like diuretics
// ---------------------------------------------------------------------------
/** Relative potency (standard dose = 1), coverage and dependence on GFR. Chlortalidone/metolazone work at low GFR. Model. */
export const THIAZIDES = {
  hydrochlorothiazide: { pot: 1, cover: 0.75, gfrExp: 1 },
  chlorthalidone: { pot: 1.3, cover: 1, gfrExp: 0.35 },
  indapamide: { pot: 1.1, cover: 1, gfrExp: 0.6 },
  metolazone: { pot: 1.4, cover: 1, gfrExp: 0.3 },
};
export function thiazideBlock(drug, doseRel, gfr) {
  const d = THIAZIDES[drug];
  const E = d.pot * doseRel * secretionFactor(gfr, d.gfrExp);
  return 0.9 * (E / (E + 0.6)) * d.cover;
}
export const thiazide = nephronEntity({
  id: 'thiazide', tMax: 28,
  params: [
    { key: 'patient', type: 'select', options: ['hypertension', 'elderlyLowSolute', 'hypercalciuria'], def: 'hypertension' },
    { key: 'drug', type: 'select', options: Object.keys(THIAZIDES), def: 'hydrochlorothiazide' },
    { key: 'dose', type: 'range', min: 0.5, max: 2, step: 0.5, def: 1, unit: '×' },
    { key: 'gfr', type: 'range', min: 15, max: 100, step: 5, def: 85, unit: 'mL/min' },
    { key: 'water', type: 'range', min: 1.2, max: 4, step: 0.2, def: 2.2, unit: 'L/d' },
  ],
  series: [
    { key: 'map', unit: 'mmHg' },
    { key: 'pna', unit: 'mmol/L' },
    { key: 'pk', unit: 'mmol/L' },
    { key: 'uCa', unit: 'mg/d', min: 0 },
  ],
  patient: (p) => {
    const base = p.patient === 'elderlyLowSolute' ? PATIENTS.elderlyLowSolute(p.gfr) : PATIENTS.hypertension(p.gfr);
    return { ...base, water: p.patient === 'elderlyLowSolute' ? Math.max(p.water, 2.8) : p.water, ...(p.patient === 'hypercalciuria' ? { map: 98, uCaFactor: 1.8 } : {}) };
  },
  blocks: (p) => ({ thz: thiazideBlock(p.drug, p.dose, p.gfr) }),
  extra: (p, on) => ({ vasodilation: on ? 4 : 0 }),
  startVars: (p) => ({ drug: p.drug }),
  events(st, t, p, arm, emit, on) {
    if (st.pna < 130) emit('hypoNa');
    if (st.pna < 125) emit('severeHypoNa');
    if (st.pk < 3.5) emit('hypoK');
    if (on && st.map < 100 && p.patient !== 'hypercalciuria') emit('bpControlled');
    if (on && p.patient === 'hypercalciuria' && st.uCa < 150) emit('hypocalciuria');
  },
  steps(st, p, arm) {
    const k = [p.patient === 'hypercalciuria' ? 'hypercalciuria' : 'hypertension'];
    if (st.on) k.push('ncc', 'natriuresis');
    if (st.on && st.uCa < 200) k.push('calcium');
    if (st.on && st.pna < 133) k.push('dilution');
    if (st.on && st.pk < 3.6) k.push('kLoss');
    return k;
  },
  gauges(st) {
    return [
      { key: 'uOsm', value: st.uOsm, unit: 'mOsm/kg', lo: 50, hi: 1200, band: false },
      { key: 'urate', value: st.urate, unit: 'mg/dL', lo: 3.5, hi: 7 },
      { key: 'mg', value: st.mg, unit: 'mg/dL', lo: 1.7, hi: 2.4 },
    ];
  },
});
// ---------------------------------------------------------------------------
// 6a. K⁺-sparing: ENaC blockers (amiloride, triamterene)
// ---------------------------------------------------------------------------
export const enac = nephronEntity({
  id: 'enac', tMax: 21,
  params: [
    { key: 'indication', type: 'select', options: ['thiazideHypoK', 'liddle', 'lithiumNDI'], def: 'thiazideHypoK' },
    { key: 'drug', type: 'select', options: ['amiloride', 'triamterene'], def: 'amiloride' },
    { key: 'dose', type: 'range', min: 5, max: 20, step: 5, def: 10, unit: 'mg' },
    { key: 'gfr', type: 'range', min: 15, max: 100, step: 5, def: 80, unit: 'mL/min' },
  ],
  series: [
    { key: 'pk', unit: 'mmol/L' },
    { key: 'map', unit: 'mmHg' },
    { key: 'uVol', unit: 'L/d', min: 0 },
  ],
  patient: (p) => {
    if (p.indication === 'liddle') return { ...PATIENTS.hypertension(p.gfr), aldoFixed: 2.6, map: 120, pk: 3.0, hco3: 30 };
    if (p.indication === 'lithiumNDI') return { ...PATIENTS.hypertension(p.gfr), map: 93, saltSens: 1, water: 'thirst', ndi: 0.85 };
    return { ...PATIENTS.hypertension(p.gfr), pk: 3.3 };
  },
  background: (p) => (p.indication === 'thiazideHypoK' ? { thz: 0.45 } : {}),
  blocks: (p) => ({ enac: clamp((p.drug === 'triamterene' ? 0.6 : 1) * 0.6 * p.dose / (p.dose + 20), 0, 0.5) }),
  // Lithium enters principal cells through ENaC; amiloride blocks the entry and partly restores ADH responsiveness.
  extra: (p, on, st, t) => (p.indication === 'lithiumNDI' ? { ndi: on ? 0.85 - 0.3 * Math.min(1, (t - 1) / 7) : 0.85 } : {}),
  startVars: (p) => ({ drug: p.drug }),
  events(st, t, p, arm, emit, on) {
    if (st.pk > 5.5) emit('hyperK');
    if (on && st.pk >= 3.5 && st.pk <= 5.0 && p.indication !== 'lithiumNDI') emit('kNormal');
    if (on && p.drug === 'triamterene') emit('crystals');
    if (on && p.indication === 'lithiumNDI' && st.uVol < 4) emit('polyuriaLess');
  },
  steps(st, p, arm) {
    const k = [p.indication];
    if (st.on) k.push('enacBlock', 'kSparing');
    if (st.on && p.indication === 'lithiumNDI') k.push('lithiumEntry');
    if (st.pk > 5.2) k.push('hyperKRisk');
    return k;
  },
  gauges(st) { return [{ key: 'hco3', value: st.hco3, unit: 'mmol/L', lo: 22, hi: 28 }, { key: 'uOsm', value: st.uOsm, unit: 'mOsm/kg', lo: 50, hi: 1200, band: false }]; },
});

// ---------------------------------------------------------------------------
// 6b. Mineralocorticoid receptor antagonists
// ---------------------------------------------------------------------------
export const MRA_DRUGS = {
  spironolactone: { max: 0.9, gyn: true },
  canrenone: { max: 0.85, gyn: true },
  eplerenone: { max: 0.7, gyn: false },
  finerenone: { max: 0.55, gyn: false },
};
export const mra = nephronEntity({
  id: 'mra', tMax: 28,
  params: [
    { key: 'patient', type: 'select', options: ['primaryAldo', 'cirrhosis', 'heartFailure'], def: 'primaryAldo' },
    { key: 'drug', type: 'select', options: Object.keys(MRA_DRUGS), def: 'spironolactone' },
    { key: 'dose', type: 'range', min: 0.5, max: 4, step: 0.5, def: 2, unit: '×' },
    { key: 'gfr', type: 'range', min: 15, max: 100, step: 5, def: 80, unit: 'mL/min' },
  ],
  series: [
    { key: 'weight', unit: 'kg' },
    { key: 'map', unit: 'mmHg' },
    { key: 'pk', unit: 'mmol/L' },
    { key: 'hco3', unit: 'mmol/L' },
  ],
  patient: (p) => (p.patient === 'primaryAldo' ? PATIENTS.primaryAldo(p.gfr) : p.patient === 'cirrhosis' ? PATIENTS.cirrhosis(p.gfr) : PATIENTS.heartFailure(p.gfr, 100)),
  blocks: (p) => ({ mr: MRA_DRUGS[p.drug].max * p.dose / (p.dose + 0.6) }),
  // In primary aldosteronism part of the BP fall comes from reversing aldosterone's vascular effects (Model).
  extra: (p, on) => ({ vasodilation: on && p.patient === 'primaryAldo' ? 12 : 0 }),
  startVars: (p) => ({ drug: p.drug }),
  reset(st) { st.weight0 = st.weight; },
  events(st, t, p, arm, emit, on) {
    if (st.pk > 5.5) emit('hyperK');
    if (st.pk > 6) emit('stopMra');
    if (on && st.pk >= 3.5 && st.pk <= 5.0 && p.patient === 'primaryAldo') emit('kNormal');
    if (on && MRA_DRUGS[p.drug].gyn && t > 14) emit('gynecomastia');
    if (on && st.weight < st.weight0 - 1.5) emit('weightDown');
  },
  steps(st, p, arm) {
    const k = [p.patient];
    if (st.on) k.push('mrBlock', 'natriuresis', 'kSparing');
    if (st.pk > 5.2) k.push('hyperKRisk');
    return k;
  },
  gauges(st) { return [{ key: 'aldo', value: st.aldo, unit: '×', lo: 0.5, hi: 1.5 }, { key: 'uNa', value: st.uNa, unit: 'mmol/d', lo: 0, hi: 400, band: false }]; },
});

// ---------------------------------------------------------------------------
// 7. Vasopressin receptor antagonists (and the other treatments of SIADH)
// ---------------------------------------------------------------------------
/** Hyponatraemia correction limits: ≤ 10 mmol/L in 24 h (≤ 8 if high risk of osmotic demyelination). */
export const NA_LIMIT_24H = 10;
export const SIADH_TREATMENTS = ['restriction', 'urea', 'saltLoop', 'tolvaptan15', 'tolvaptan30', 'conivaptan'];
export const vaptan = nephronEntity({
  id: 'vaptan', tMax: 7, runIn: 0,
  params: [
    { key: 'treatment', type: 'select', options: SIADH_TREATMENTS, def: 'tolvaptan15' },
    { key: 'cause', type: 'select', options: ['sclc', 'carbamazepine', 'ssri', 'cyclophosphamide', 'chlorpropamide'], def: 'sclc' },
    { key: 'na0', type: 'range', min: 112, max: 132, step: 1, def: 120, unit: 'mmol/L' },
    { key: 'water', type: 'range', min: 0.8, max: 3, step: 0.2, def: 1.8, unit: 'L/d' },
    { key: 'highRisk', type: 'bool', def: false },
  ],
  series: [
    { key: 'pna', unit: 'mmol/L' },
    { key: 'rate24', unit: 'mmol/L/24 h' },
    { key: 'uVol', unit: 'L/d', min: 0 },
  ],
  patient: (p) => {
    const tbw = 49 * 120 / p.na0;
    return { ...PATIENTS.siadh(90, p.water), tbw, pna: p.na0, ecf: 14 };
  },
  blocks: (p) => ({
    restriction: {}, urea: {}, saltLoop: { loop: 0.4 }, tolvaptan15: { v2: 0.75 }, tolvaptan30: { v2: 0.9 }, conivaptan: { v2: 0.85 },
  }[p.treatment]),
  extra: (p, on) => {
    if (!on) return {};
    if (p.treatment === 'restriction') return { waterIn: 0.8 };
    if (p.treatment === 'saltLoop') return { naIn: 120 + 100 }; // ≈ 6 g NaCl/day
    if (p.treatment === 'urea') return { urea: 350 + 500 }; // oral urea ≈ 30 g/day ≈ 500 mOsm
    return {};
  },
  startVars: (p) => ({ treatment: p.treatment }),
  reset(st, pt, p) { st.naStart = st.pna; },
  events(st, t, p, arm, emit, on) {
    const limit = p.highRisk ? 8 : NA_LIMIT_24H;
    if (on && st.rate24 > limit) emit('overcorrection', { limit });
    if (st.pna >= 130 && on) emit('na130');
    if (st.pna < 118) emit('severe');
    if (on && (p.treatment === 'tolvaptan15' || p.treatment === 'tolvaptan30') && t > 2) emit('thirst');
  },
  steps(st, p, arm) {
    const k = ['adhExcess', 'waterRetention'];
    if (st.on) k.push(p.treatment === 'restriction' ? 'lessWater' : p.treatment === 'urea' ? 'solute' : p.treatment === 'saltLoop' ? 'saltLoop' : 'aquaresis');
    if (st.on && st.rate24 > 6) k.push('watchRate');
    return k;
  },
  gauges(st) { return [{ key: 'uOsm', value: st.uOsm, unit: 'mOsm/kg', lo: 50, hi: 1200, band: false }, { key: 'adh', value: st.adh * 100, unit: '%', lo: 0, hi: 100, band: false }]; },
});
export const DIURETICS = [osmotic, carbonicAnhydrase, sglt2, loop, thiazide, enac, mra, vaptan];
