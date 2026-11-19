// Drugs acting on the kidney's hormone systems: RAAS, ADH axis, Ca–P–PTH (CKD-MBD), FGF23, renal anaemia, ADPKD.
import { clamp, relax } from './core.js';
import { bodyInit, bodyStep } from './nephron.js';

// ---------------------------------------------------------------------------
// 1. RAAS blockade in proteinuric CKD
// ---------------------------------------------------------------------------
/**
 * Effect by drug: fraction of proteinuria removed, eGFR "dip" (efferent dilatation), K⁺ rise, BP fall.
 * ACEi/ARB ≈ −35% proteinuria (RENAAL/IDNT/REIN order); sparsentan ≈ −50% (PROTECT/DUPLEX);
 * ACEi + ARB adds little antiproteinuric benefit but more AKI and hyperkalaemia (VA NEPHRON-D, ONTARGET);
 * aliskiren on top of ACEi/ARB in diabetes: harm (ALTITUDE). Values rounded: Model.
 */
export const RAAS_DRUGS = {
  acei: { prot: 0.35, dip: 0.12, k: 0.35, map: 8, slope: 0.7 },
  arb: { prot: 0.35, dip: 0.12, k: 0.3, map: 8, slope: 0.7 },
  aliskiren: { prot: 0.25, dip: 0.1, k: 0.3, map: 7, slope: 0.85 },
  arni: { prot: 0.3, dip: 0.1, k: 0.25, map: 10, slope: 0.72 },
  sparsentan: { prot: 0.5, dip: 0.12, k: 0.25, map: 8, slope: 0.6 },
  aceiArb: { prot: 0.45, dip: 0.2, k: 0.7, map: 11, slope: 0.7 },
};
export const raas = {
  id: 'raas', mode: 'horm', unit: 'mo', tMax: 48, dt: 0.05, region: ['glomerulus'],
  params: [
    { key: 'drug', type: 'select', options: Object.keys(RAAS_DRUGS), def: 'acei' },
    { key: 'egfr0', type: 'range', min: 20, max: 90, step: 5, def: 45, unit: 'mL/min' },
    { key: 'prot0', type: 'range', min: 0.5, max: 6, step: 0.5, def: 2.5, unit: 'g/d' },
    { key: 'k0', type: 'range', min: 3.8, max: 5.4, step: 0.1, def: 4.7, unit: 'mmol/L' },
    { key: 'ras', type: 'bool', def: false },
    { key: 'volumeDepleted', type: 'bool', def: false },
  ],
  series: [
    { key: 'egfr', unit: 'mL/min', min: 0 },
    { key: 'prot', unit: 'g/d', min: 0 },
    { key: 'pk', unit: 'mmol/L' },
  ],
  init(p) { return { struct: p.egfr0, dip: 0, egfr: p.egfr0, prot: p.prot0, pk: p.k0, map: 105, on: false, cr0: 0.9 * 100 / p.egfr0, crRise: 0 }; },
  step(st, t, dt, p, arm, emit) {
    const d = RAAS_DRUGS[p.drug];
    const on = arm === 'treated' && t >= 1;
    if (on && !st.on) { st.on = true; emit('start', { drug: p.drug }); }
    // Untreated proteinuric CKD: ≈ −6 mL/min/year, faster with more proteinuria (Model).
    const baseSlope = (3 + 1.2 * p.prot0) / 12;
    const slope = baseSlope * (on ? d.slope : 1);
    st.struct = Math.max(4, st.struct - slope * dt);
    // Efferent dilatation lowers glomerular pressure: an early reversible eGFR fall. When GFR depends on angiotensin II
    // (bilateral renal artery stenosis, volume depletion) the fall is large: acute kidney injury.
    const dipTarget = on ? d.dip + (p.ras ? 0.45 : 0) + (p.volumeDepleted ? 0.25 : 0) : 0;
    st.dip = relax(st.dip, Math.min(0.75, dipTarget), dt, 0.25);
    st.egfr = st.struct * (1 - st.dip);
    st.prot = relax(st.prot, p.prot0 * (on ? 1 - d.prot : 1) * (st.struct / p.egfr0) ** -0.3, dt, 0.5);
    const kRise = on ? d.k * (60 / Math.max(15, st.egfr)) ** 0.7 : 0;
    st.pk = relax(st.pk, p.k0 + kRise + 0.004 * (p.egfr0 - st.egfr), dt, 0.3);
    st.map = relax(st.map, 105 - (on ? d.map : 0), dt, 0.5);
    st.crRise = (1 / Math.max(0.05, 1 - st.dip) - 1) * 100; // creatinine rise attributable to the haemodynamic dip
    if (on && st.crRise > 30) emit('creatRise30', { r: Math.round(st.crRise) });
    if (on && st.dip > 0.4) emit('aki');
    if (st.pk > 5.5) emit('hyperK');
    if (st.pk > 6) emit('hyperKSevere');
    if (on && p.drug === 'aceiArb') emit('dualBlock');
    if (on && p.drug === 'aliskiren') emit('aliskiren');
    if (on && st.prot < p.prot0 * 0.7) emit('protDown');
    if (st.egfr < 15) emit('kidneyFailure');
    return st;
  },
  steps(st, p, arm) {
    const k = ['angII', 'hyperfiltration'];
    if (st.on) k.push('effDilate', 'pgcDown', 'protein');
    if (st.on && st.dip > 0.2) k.push('dependent');
    if (st.on && st.pk > 5) k.push('kRise');
    return k;
  },
  gauges(st) { return [{ key: 'crRise', value: Math.max(0, st.crRise), unit: '%', lo: 0, hi: 30 }, { key: 'map', value: st.map, unit: 'mmHg', lo: 70, hi: 100 }]; },
  schematic(st, p) { return { kind: 'nephron', focus: 'glomerulus', seg: { pct: 0.67, loop: 0.25, dct: 0.045, cd: 0.03 }, distal: 0.037, b: {}, aldo: st.on ? 0.6 : 1.3, adh: 0.4, gradient: 1, kSec: 0.8, aff: 1, eff: st.on ? 0.6 : 1.2, pgc: 60 - 10 * st.dip / 0.12 * (st.on ? 0.6 : 0), proteinuria: st.prot / 3, drugs: st.on ? [p.drug] : [] }; },
};

// ---------------------------------------------------------------------------
// 2. ADH agonists: desmopressin in diabetes insipidus (central vs nephrogenic)
// ---------------------------------------------------------------------------
export const DI_CAUSES = ['central', 'lithium', 'demeclocycline', 'foscarnet', 'amphotericin'];
export const desmopressin = {
  id: 'desmopressin', mode: 'horm', unit: 'd', tMax: 5, dt: 0.02, region: ['collecting'],
  params: [
    { key: 'cause', type: 'select', options: DI_CAUSES, def: 'central' },
    { key: 'drinking', type: 'select', options: ['thirst', 'habit4L', 'noAccess'], def: 'thirst' },
  ],
  series: [
    { key: 'uVol', unit: 'L/d', min: 0 },
    { key: 'uOsm', unit: 'mOsm/kg', min: 0 },
    { key: 'pna', unit: 'mmol/L' },
  ],
  init(p) {
    const central = p.cause === 'central';
    const pt = { tbw: 42, ecf: 14, gfr: 100, eav: 1, aldo: 1, naIn: 150, kIn: 70, map: 93, saltSens: 1, adhFixed: central ? 0.03 : undefined, ndi: central ? 0 : 0.9, water: 'thirst' };
    const st = bodyInit(pt);
    st.pt = pt; st.on = false;
    for (let i = 0; i < 100; i++) bodyStep(st, pt, {}, 0.02, {});
    return st;
  },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 1;
    if (on && !st.on) { st.on = true; emit('start'); }
    const pt = { ...st.pt };
    // Desmopressin = selective V2 agonist: replaces missing ADH (central DI) but cannot overcome receptor resistance.
    if (on && p.cause === 'central') pt.adhFixed = 0.9;
    // With unrestricted habitual drinking but absent thirst feedback, desmopressin leads to water retention.
    const extra = p.drinking === 'habit4L' && on ? { waterIn: 4 } : p.drinking === 'noAccess' ? { waterIn: 0.8 } : {};
    bodyStep(st, pt, {}, dt, extra);
    if (st.uVol > 3) emit('polyuria');
    if (st.pna > 148) emit('hypernatremia');
    if (st.pna < 132) emit('hyponatremia');
    if (on && p.cause !== 'central' && t > 1.5) emit('noResponse');
    if (on && p.cause === 'central' && st.uOsm > 500) emit('concentrates');
    return st;
  },
  steps(st, p, arm) {
    const k = [p.cause === 'central' ? 'noAdh' : 'resistance', 'dilute'];
    if (st.on) k.push(p.cause === 'central' ? 'v2Agonist' : 'noEffect');
    if (st.pna > 145) k.push('thirstNeeded');
    if (st.pna < 133) k.push('waterRetention');
    return k;
  },
  gauges(st) { return [{ key: 'adh', value: st.adh * 100, unit: '%', lo: 0, hi: 100, band: false }]; },
  schematic(st, p) { return { kind: 'nephron', focus: 'collecting', seg: st.seg, distal: st.distal, b: {}, aldo: st.aldo, adh: p.cause === 'central' ? st.adh : st.adh * 0.1, gradient: 1, kSec: 1, uVol: st.uVol, aqp2: st.on && p.cause === 'central' ? 1 : p.cause === 'central' ? 0.1 : 0.15, drugs: st.on ? ['desmopressin'] : [] }; },
};

// ---------------------------------------------------------------------------
// 3. Terlipressin + albumin in hepatorenal syndrome (HRS-AKI)
// ---------------------------------------------------------------------------
export const terlipressin = {
  id: 'terlipressin', mode: 'horm', unit: 'd', tMax: 14, dt: 0.05, region: ['glomerulus'],
  params: [
    { key: 'cr0', type: 'range', min: 1.5, max: 5, step: 0.1, def: 2.6, unit: 'mg/dL' },
    { key: 'response', type: 'select', options: ['responder', 'nonResponder'], def: 'responder' },
    { key: 'hypoxia', type: 'bool', def: false },
  ],
  series: [
    { key: 'cr', unit: 'mg/dL', min: 0 },
    { key: 'map', unit: 'mmHg' },
    { key: 'uVol', unit: 'mL/h', min: 0 },
  ],
  init(p) { return { cr: p.cr0, map: 68, uVol: 20, on: false, resp: false }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 1;
    if (on && !st.on) { st.on = true; emit('start'); if (p.hypoxia) emit('contraindicated'); }
    // V1 agonism constricts the splanchnic bed → more effective volume → afferent perfusion and GFR recover (responders).
    const respond = on && p.response === 'responder';
    st.map = relax(st.map, on ? 80 : 66, dt, 1);
    const crTarget = respond ? 1.2 : on ? p.cr0 + 0.08 * t : p.cr0 + 0.25 * t;
    st.cr = relax(st.cr, crTarget, dt, respond ? 3 : 1.5);
    st.uVol = relax(st.uVol, respond ? 60 : on ? 25 : 15, dt, 1.5);
    if (respond && st.cr < 1.5 && !st.resp) { st.resp = true; emit('reversal'); }
    if (on && t > 4 && !respond) emit('noResponse');
    if (on && p.hypoxia && t > 2) emit('respiratoryFailure');
    if (!on && st.cr > 4) emit('dialysis');
    return st;
  },
  steps(st, p, arm) {
    const k = ['splanchnic', 'renalVasoconstriction'];
    if (st.on) k.push('v1', 'albumin');
    if (st.resp) k.push('reversal');
    return k;
  },
  schematic(st) { return { kind: 'nephron', focus: 'glomerulus', seg: { pct: 0.72, loop: 0.22, dct: 0.04, cd: 0.02 }, distal: 0.02, b: {}, aldo: 2.5, adh: 0.8, gradient: 1, kSec: 0.6, aff: st.on ? 1 : 1.7, eff: 1, pgc: st.on ? 52 : 40, drugs: st.on ? ['terlipressin'] : [] }; },
};

// ---------------------------------------------------------------------------
// 4. CKD–mineral and bone disorder (dialysis patient)
// ---------------------------------------------------------------------------
/** Relative fall in absorbed phosphate per binder (rounded; Model). Calcium-based binders add calcium load. */
export const BINDERS = {
  none: { p: 0, ca: 0 }, calciumCarbonate: { p: 0.22, ca: 0.35 }, calciumAcetate: { p: 0.26, ca: 0.3 },
  sevelamer: { p: 0.25, ca: 0 }, lanthanum: { p: 0.28, ca: 0 }, sucroferric: { p: 0.3, ca: 0 }, ferricCitrate: { p: 0.25, ca: 0 }, tenapanor: { p: 0.25, ca: 0 },
};
export const VITD = {
  none: { pth: 0, ca: 0, p: 0 }, cholecalciferol: { pth: 0.08, ca: 0.05, p: 0 }, calcifediol: { pth: 0.12, ca: 0.1, p: 0.05 },
  calcitriol: { pth: 0.35, ca: 0.5, p: 0.6 }, alfacalcidol: { pth: 0.33, ca: 0.45, p: 0.55 }, paricalcitol: { pth: 0.38, ca: 0.25, p: 0.3 },
};
export const CALCIMIMETICS = { none: { pth: 0, ca: 0 }, cinacalcet: { pth: 0.45, ca: 0.6 }, etelcalcetide: { pth: 0.55, ca: 0.75 } };
/** PTH target in dialysis ≈ 2–9 × the upper limit of normal (≈ 65 pg/mL) → ≈ 130–585 pg/mL (KDIGO). */
export const PTH_RANGE = [130, 585];
export const ckdMbd = {
  id: 'ckdMbd', mode: 'horm', unit: 'mo', tMax: 12, dt: 0.05, region: ['axis'],
  params: [
    { key: 'binder', type: 'select', options: Object.keys(BINDERS), def: 'sevelamer' },
    { key: 'vitd', type: 'select', options: Object.keys(VITD), def: 'none' },
    { key: 'calcimimetic', type: 'select', options: Object.keys(CALCIMIMETICS), def: 'cinacalcet' },
    { key: 'diet', type: 'bool', def: true },
  ],
  series: [
    { key: 'p', unit: 'mg/dL' },
    { key: 'ca', unit: 'mg/dL' },
    { key: 'pth', unit: 'pg/mL', min: 0 },
  ],
  init() { return { p: 7.2, ca: 8.7, pth: 820, on: false, caLoad: 0 }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 1;
    if (on && !st.on) { st.on = true; emit('start'); }
    const B = on ? BINDERS[p.binder] : BINDERS.none;
    const V = on ? VITD[p.vitd] : VITD.none;
    const C = on ? CALCIMIMETICS[p.calcimimetic] : CALCIMIMETICS.none;
    const diet = on && p.diet ? 0.1 : 0;
    const pTarget = 7.2 * (1 - B.p - diet) + V.p;
    st.p = relax(st.p, Math.max(2.5, pTarget), dt, 0.8);
    const caTarget = 8.7 + B.ca + V.ca - C.ca;
    st.ca = relax(st.ca, caTarget, dt, 0.7);
    // PTH: driven up by phosphate retention, low calcium and calcitriol deficiency; vitamin D analogues and
    // calcimimetics suppress it. Secondary hyperparathyroidism: slow (months). Model.
    const pthTarget = 820 * (1 + 0.18 * (st.p - 7.2)) * (1 + 0.35 * (8.7 - st.ca)) * (1 - V.pth) * (1 - C.pth);
    st.pth = relax(st.pth, Math.max(60, pthTarget), dt, 1.5);
    st.caLoad += B.ca * dt;
    if (st.ca > 10.2) emit('hypercalcemia');
    if (st.ca < 8.0) emit('hypocalcemia');
    if (on && st.p < 5.5) emit('pDown');
    if (on && st.pth < PTH_RANGE[1]) emit('pthInRange');
    if (on && st.pth < PTH_RANGE[0]) emit('pthOversuppressed');
    return st;
  },
  steps(st, p, arm) {
    const k = ['pRetention', 'fgf23', 'secondaryHpt'];
    if (st.on && p.binder !== 'none') k.push('binder');
    if (st.on && p.vitd !== 'none') k.push('vitd');
    if (st.on && p.calcimimetic !== 'none') k.push('casr');
    return k;
  },
  gauges(st) { return [{ key: 'caxp', value: st.ca * st.p, unit: 'mg²/dL²', lo: 0, hi: 55 }]; },
  schematic(st, p) {
    const on = st.on;
    return {
      kind: 'axis', layout: 'mbd',
      nodes: [
        { id: 'gut', x: 70, y: 80, level: (st.p - 4.5) / 4, drug: on && p.binder !== 'none' ? p.binder : null },
        { id: 'blood', x: 210, y: 150, level: 0, text: 'P ' + st.p.toFixed(1) + ' · Ca ' + st.ca.toFixed(1) },
        { id: 'parathyroid', x: 350, y: 80, level: Math.min(1, st.pth / 900), drug: on && p.calcimimetic !== 'none' ? p.calcimimetic : null, text: 'PTH ' + Math.round(st.pth) },
        { id: 'bone', x: 350, y: 240, level: Math.min(1, st.pth / 900) },
        { id: 'kidney', x: 70, y: 240, level: -0.6, drug: on && p.vitd !== 'none' ? p.vitd : null },
      ],
      edges: [['gut', 'blood', st.p / 7], ['blood', 'parathyroid', 0.6], ['parathyroid', 'bone', st.pth / 800], ['bone', 'blood', st.pth / 900], ['kidney', 'blood', 0.2]],
    };
  },
};

// ---------------------------------------------------------------------------
// 5. FGF23 excess: X-linked hypophosphataemia (burosumab)
// ---------------------------------------------------------------------------
export const xlh = {
  id: 'xlh', mode: 'horm', unit: 'w', tMax: 48, dt: 0.25, region: ['axis'],
  params: [{ key: 'treatment', type: 'select', options: ['burosumab', 'conventional'], def: 'burosumab' }],
  series: [
    { key: 'p', unit: 'mg/dL' },
    { key: 'rickets', unit: '/10', min: 0, max: 10 },
  ],
  init() { return { p: 2.2, rickets: 6, pth: 70, on: false }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 1;
    if (on && !st.on) { st.on = true; emit('start', { treatment: p.treatment }); }
    // Burosumab (anti-FGF23) restores renal phosphate reabsorption and calcitriol: phosphate normalises within weeks.
    // Conventional oral phosphate + calcitriol: transient peaks, secondary hyperparathyroidism, nephrocalcinosis risk.
    const bur = on && p.treatment === 'burosumab';
    const conv = on && p.treatment === 'conventional';
    st.p = relax(st.p, bur ? 3.3 : conv ? 2.7 : 2.2, dt, bur ? 3 : 4);
    st.rickets = relax(st.rickets, bur ? 1.5 : conv ? 3.5 : 6.5, dt, 20);
    st.pth = relax(st.pth, conv ? 120 : 70, dt, 8);
    if (bur && st.p > 3) emit('pNormal');
    if (conv && t > 20) emit('nephrocalcinosis');
    return st;
  },
  steps(st, p) {
    const k = ['fgf23High', 'phosphaturia'];
    if (st.on) k.push(p.treatment === 'burosumab' ? 'antiFgf23' : 'phosphateCalcitriol');
    if (st.rickets < 3) k.push('healing');
    return k;
  },
  gauges(st) { return [{ key: 'pth', value: st.pth, unit: 'pg/mL', lo: 15, hi: 65 }]; },
  schematic(st, p) {
    return {
      kind: 'axis', layout: 'xlh',
      nodes: [
        { id: 'bone', x: 80, y: 90, level: st.on && p.treatment === 'burosumab' ? 0.2 : 0.9, text: 'FGF23' },
        { id: 'kidney', x: 280, y: 90, level: -0.5, drug: st.on && p.treatment === 'burosumab' ? 'burosumab' : null },
        { id: 'blood', x: 180, y: 220, level: (st.p - 3.2) / 2, text: 'P ' + st.p.toFixed(1) },
        { id: 'gut', x: 340, y: 230, level: 0, drug: st.on && p.treatment === 'conventional' ? 'phosphateSalts' : null },
      ],
      edges: [['bone', 'kidney', st.on && p.treatment === 'burosumab' ? 0.2 : 1], ['kidney', 'blood', st.p / 4], ['gut', 'blood', 0.4]],
    };
  },
};

// ---------------------------------------------------------------------------
// 6. Renal anaemia
// ---------------------------------------------------------------------------
export const ESAS = ['none', 'epoetin', 'darbepoetin', 'cera'];
export const HIFPHIS = ['none', 'roxadustat', 'daprodustat', 'vadadustat'];
export const IRONS = ['none', 'ivCarboxymaltose', 'ivSucrose', 'ivDerisomaltose', 'oral'];
/** KDIGO: start ESA when Hb < 10 g/dL; maintain ≈ 10–11.5; do not intentionally exceed 13 (stroke, thrombosis). */
export const HB_TARGET = [10, 11.5];
export const anemia = {
  id: 'anemia', mode: 'horm', unit: 'mo', tMax: 6, dt: 0.02, region: ['axis'],
  params: [
    { key: 'esa', type: 'select', options: ESAS, def: 'epoetin' },
    { key: 'hif', type: 'select', options: HIFPHIS, def: 'none' },
    { key: 'iron', type: 'select', options: IRONS, def: 'ivCarboxymaltose' },
    { key: 'ferritin0', type: 'range', min: 30, max: 600, step: 10, def: 80, unit: 'ng/mL' },
    { key: 'highTarget', type: 'bool', def: false },
  ],
  series: [
    { key: 'hb', unit: 'g/dL' },
    { key: 'ferritin', unit: 'ng/mL', min: 0 },
    { key: 'tsat', unit: '%', min: 0 },
  ],
  init(p) { return { hb: 8.6, ferritin: p.ferritin0, tsat: 10 + p.ferritin0 / 15, on: false, ironGiven: false }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 0.25;
    if (on && !st.on) { st.on = true; emit('start'); if (p.esa !== 'none' && p.hif !== 'none') emit('combination'); }
    if (on && !st.ironGiven && p.iron.startsWith('iv')) { st.ironGiven = true; st.ferritin += 400; emit('ivIron'); }
    if (on && p.iron === 'oral') st.ferritin += 25 * dt; // poor absorption in CKD (hepcidin)
    st.tsat = clamp(10 + st.ferritin / 15, 5, 50);
    // Iron availability limits erythropoiesis (absolute or functional deficiency: TSAT < 20%, ferritin < 100). HIF-PHIs lower hepcidin.
    const ironAvail = clamp((st.tsat - 8) / 14, 0.15, 1) * (on && p.hif !== 'none' ? 1.2 : 1);
    const stim = on && (p.esa !== 'none' || p.hif !== 'none');
    const target = p.highTarget ? 13.5 : 11;
    const rise = stim && st.hb < target ? 1.3 * Math.min(1, ironAvail) : 0; // g/dL per month, titrated to target
    st.hb = clamp(st.hb + (rise - 0.08) * dt, 5, 16);
    st.ferritin = Math.max(10, st.ferritin - (rise * 25 + 6) * dt); // ≈ 170 mg iron per g/dL of Hb
    if (st.hb >= HB_TARGET[0]) emit('hb10');
    if (st.hb > 13) emit('hbTooHigh');
    if (stim && ironAvail < 0.6) emit('ironLimited');
    if (!on && st.hb < 8) emit('transfusion');
    return st;
  },
  steps(st, p, arm) {
    const k = ['epoDeficit', 'hepcidin'];
    if (st.on && p.iron !== 'none') k.push('iron');
    if (st.on && p.esa !== 'none') k.push('esa');
    if (st.on && p.hif !== 'none') k.push('hif');
    if (st.hb > 10) k.push('target');
    return k;
  },
  gauges(st) { return [{ key: 'hbTarget', value: st.hb, unit: 'g/dL', lo: HB_TARGET[0], hi: HB_TARGET[1] }]; },
  schematic(st, p) {
    const on = st.on;
    return {
      kind: 'axis', layout: 'anemia',
      nodes: [
        { id: 'kidney', x: 80, y: 90, level: -0.7, drug: on && p.hif !== 'none' ? p.hif : null, text: 'EPO' },
        { id: 'marrow', x: 260, y: 90, level: (st.hb - 11) / 4, drug: on && p.esa !== 'none' ? p.esa : null, text: 'Hb ' + st.hb.toFixed(1) },
        { id: 'ironStores', x: 80, y: 240, level: (st.ferritin - 200) / 300, drug: on && p.iron !== 'none' ? p.iron : null, text: '{ferritin} ' + Math.round(st.ferritin) },
        { id: 'liver', x: 260, y: 240, level: 0.5, text: '{hepcidin}' },
      ],
      edges: [['kidney', 'marrow', on && (p.esa !== 'none' || p.hif !== 'none') ? 1 : 0.3], ['ironStores', 'marrow', st.tsat / 30], ['liver', 'ironStores', 0.6]],
    };
  },
};

// ---------------------------------------------------------------------------
// 7. ADPKD: tolvaptan slows cyst growth
// ---------------------------------------------------------------------------
/** TEMPO 3:4: total kidney volume growth 2.8% vs 5.5%/year; REPRISE: eGFR −2.3 vs −3.6 mL/min/year. */
export const adpkd = {
  id: 'adpkd', mode: 'horm', unit: 'y', tMax: 5, dt: 0.02, region: ['collecting'],
  params: [
    { key: 'mayo', type: 'select', options: ['1C', '1D', '1E'], def: '1D' },
    { key: 'egfr0', type: 'range', min: 25, max: 90, step: 5, def: 60, unit: 'mL/min' },
  ],
  series: [
    { key: 'tkv', unit: 'mL', min: 0 },
    { key: 'egfr', unit: 'mL/min', min: 0 },
    { key: 'uVol', unit: 'L/d', min: 0 },
  ],
  init(p) { return { tkv: 1400, egfr: p.egfr0, uVol: 1.8, on: false }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 0.1;
    if (on && !st.on) { st.on = true; emit('start'); }
    const growth = { '1C': 0.04, '1D': 0.055, '1E': 0.075 }[p.mayo] * (on ? 0.51 : 1);
    st.tkv *= 1 + growth * dt;
    const slope = ({ '1C': 3, '1D': 3.6, '1E': 4.5 }[p.mayo]) * (on ? 0.65 : 1);
    st.egfr = Math.max(5, st.egfr - slope * dt);
    st.uVol = relax(st.uVol, on ? 5.5 : 1.8, dt, 0.05);
    if (on && t < 1.5) emit('liverMonitoring');
    if (on && st.uVol > 4) emit('aquaresis');
    if (st.egfr < 25) emit('egfr25');
    return st;
  },
  steps(st, p, arm) {
    const k = ['camp', 'cysts'];
    if (st.on) k.push('v2Block', 'lessCamp', 'aquaresis');
    return k;
  },
  schematic(st, p) { return { kind: 'nephron', focus: 'collecting', seg: { pct: 0.67, loop: 0.25, dct: 0.045, cd: 0.03 }, distal: 0.037, b: { v2: st.on ? 0.85 : 0 }, aldo: 1, adh: 0.6, gradient: 1, kSec: 1, uVol: st.uVol, cysts: Math.min(1, st.tkv / 3000), drugs: st.on ? ['tolvaptan'] : [] }; },
};

export const HORMONES = [raas, desmopressin, terlipressin, ckdMbd, xlh, anemia, adpkd];
