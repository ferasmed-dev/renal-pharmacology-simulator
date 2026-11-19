// Glomerular haemodynamics (arteriolar tone → GFR) and the CKD-slowing pillars.
import { clamp, relax } from './core.js';

// ---------------------------------------------------------------------------
// Glomerulus: Starling forces with afferent (RA) and efferent (RE) resistances
// ---------------------------------------------------------------------------
/**
 * Steady-state single-glomerulus model (whole-kidney scale). PGC = Pp × RE/(RA+RE);
 * RPF ∝ Pp/(RA+RE); GFR = Kf × (PGC − PBS − mean πGC), with πGC rising along the capillary as filtration fraction rises.
 * Calibrated to GFR ≈ 100 mL/min, RPF ≈ 600 mL/min, PGC ≈ 56 mmHg at MAP 93. Model.
 */
export function glomerulus(Pp, RA, RE, Kf = 6.4) {
  const PGC = Pp * RE / (RA + RE);
  const RPF = 16.1 * Pp / (RA + RE);
  let gfr = 100;
  for (let i = 0; i < 30; i++) {
    const ff = clamp(gfr / RPF, 0, 0.6);
    const piE = 25 / (1 - ff);
    const piAvg = (25 + piE) / 2;
    const next = Math.max(0, Kf * (PGC - 12 - piAvg));
    gfr = 0.5 * gfr + 0.5 * next;
  }
  return { PGC, RPF, gfr, ff: gfr / RPF };
}

export const PATIENT_STATES = {
  normal: { map: 93, angII: 1, pg: 1, stenosis: 0 },
  volumeDepleted: { map: 80, angII: 2.5, pg: 2.2, stenosis: 0 },
  heartFailure: { map: 78, angII: 2, pg: 2, stenosis: 0 },
  ckd: { map: 100, angII: 1.3, pg: 1.6, stenosis: 0, kf: 0.45 },
  bilateralRas: { map: 100, angII: 3, pg: 1.5, stenosis: 0.3 },
  transplant: { map: 98, angII: 1, pg: 1.2, stenosis: 0, kf: 0.6 },
};
export const GLOM_DRUGS = ['nsaid', 'cni', 'contrast', 'sglt2', 'noradrenaline', 'fenoldopam', 'acei', 'angiotensinII', 'diuretic'];

/** Arteriolar resistances for a patient state and a set of active drugs. */
export function resistances(state, d, contrastLevel = 0) {
  let angII = state.angII * (d.diuretic ? 1.5 : 1);
  const pg = state.pg * (d.diuretic ? 1.2 : 1);
  if (d.acei) angII = 1 + (angII - 1) * 0.15 - 0.3; // removes angiotensin II tone
  if (d.angiotensinII) angII += 1.5;
  const pgEffect = d.nsaid ? 1 : 1 + 0.2 * (pg - 1); // prostaglandins dilate the afferent arteriole
  let RA = (1 + 0.1 * (angII - 1)) / pgEffect;
  RA *= 1 + 0.4 * (d.cni ? 1 : 0) + 0.6 * contrastLevel + 0.06 * (d.sglt2 ? 1 : 0) + 0.25 * (d.noradrenaline ? 1 : 0);
  if (d.fenoldopam) RA /= 1.35;
  const RE = 1.5 * (1 + 0.35 * (Math.max(0.3, angII) - 1));
  const map = state.map + (d.noradrenaline ? 15 : 0) - (d.diuretic ? 6 : 0) - (d.acei ? 6 : 0) + (d.angiotensinII ? 10 : 0);
  const Pp = map * (1 - state.stenosis);
  return { RA, RE, Pp, map };
}

export const glomerularHaemo = {
  id: 'glomerularHaemo', mode: 'haemo', unit: 'd', tMax: 7, dt: 0.02, region: ['glomerulus'],
  params: [
    { key: 'state', type: 'select', options: Object.keys(PATIENT_STATES), def: 'volumeDepleted' },
    ...GLOM_DRUGS.map((k) => ({ key: k, type: 'bool', def: k === 'nsaid' || k === 'acei' || k === 'diuretic' })),
  ],
  series: [
    { key: 'gfr', unit: 'mL/min', min: 0 },
    { key: 'pgc', unit: 'mmHg', min: 0 },
    { key: 'cr', unit: 'mg/dL', min: 0 },
  ],
  init(p) {
    const s = PATIENT_STATES[p.state];
    const r = resistances(s, {});
    const g = glomerulus(r.Pp, r.RA, r.RE, 6.4 * (s.kf ?? 1));
    return { gfr: g.gfr, pgc: g.PGC, cr: 0.9 * 100 / Math.max(5, g.gfr), RA: r.RA, RE: r.RE, ff: g.ff, map: r.map, on: false, gfr0: g.gfr, contrast: 0 };
  },
  step(st, t, dt, p, arm, emit) {
    const s = PATIENT_STATES[p.state];
    const on = arm === 'treated' && t >= 1;
    if (on && !st.on) { st.on = true; emit('start', { list: GLOM_DRUGS.filter((k) => p[k]).join(',') }); }
    const d = on ? Object.fromEntries(GLOM_DRUGS.map((k) => [k, !!p[k]])) : {};
    // Contrast: transient afferent vasoconstriction + tubular injury, peaking at 2–3 days (Model).
    const tc = t - 1;
    st.contrast = on && p.contrast ? clamp(tc / 1.5, 0, 1) * Math.exp(-Math.max(0, tc - 1.5) / 2.5) : 0;
    const r = resistances(s, d, st.contrast);
    const g = glomerulus(r.Pp, r.RA, r.RE, 6.4 * (s.kf ?? 1));
    st.RA = r.RA; st.RE = r.RE; st.map = r.map; st.ff = g.ff;
    st.gfr = relax(st.gfr, g.gfr, dt, 0.15);
    st.pgc = relax(st.pgc, g.PGC, dt, 0.15);
    st.cr = relax(st.cr, 0.9 * 100 / Math.max(4, st.gfr), dt, 0.8);
    const fall = 1 - st.gfr / st.gfr0;
    if (on && fall > 0.25) emit('gfrDown');
    if (st.cr > 1.5 * (0.9 * 100 / st.gfr0)) emit('aki');
    if (on && p.nsaid && p.acei && p.diuretic) emit('tripleWhammy');
    if (on && fall < -0.05) emit('gfrUp');
    return st;
  },
  steps(st, p, arm) {
    const k = ['autoregulation'];
    if (PATIENT_STATES[p.state].angII > 1.5) k.push('angIIDependent');
    if (PATIENT_STATES[p.state].pg > 1.4) k.push('pgDependent');
    if (st.on) {
      if (p.nsaid || p.cni || p.contrast || p.sglt2 || p.noradrenaline) k.push('affConstrict');
      if (p.fenoldopam) k.push('affDilate');
      if (p.acei) k.push('effDilate');
      if (p.angiotensinII) k.push('effConstrict');
      if (st.gfr < st.gfr0 * 0.75) k.push('gfrFalls');
    }
    return k;
  },
  gauges(st) {
    return [
      { key: 'RA', value: st.RA, unit: '×', lo: 0.8, hi: 1.2 },
      { key: 'RE', value: st.RE / 1.5, unit: '×', lo: 0.8, hi: 1.2 },
      { key: 'ff', value: st.ff * 100, unit: '%', lo: 15, hi: 25 },
    ];
  },
  schematic(st, p) {
    const active = st.on ? GLOM_DRUGS.filter((k) => p[k]) : [];
    return { kind: 'nephron', focus: 'glomerulus', seg: { pct: 0.67, loop: 0.25, dct: 0.045, cd: 0.03 }, distal: 0.037, b: {}, aldo: 1, adh: 0.4, gradient: 1, kSec: 1, aff: st.RA, eff: st.RE / 1.5, pgc: st.pgc, gfr: st.gfr, drugs: active };
  },
};

// ---------------------------------------------------------------------------
// Nephroprotection: stacking the pillars in progressive CKD
// ---------------------------------------------------------------------------
/**
 * Multipliers on the eGFR slope and on albuminuria (rounded from outcome trials; Model):
 * RAS inhibitor ≈ 0.75 / 0.65 (RENAAL, IDNT, REIN); SGLT2i ≈ 0.6 / 0.7 (CREDENCE, DAPA-CKD, EMPA-KIDNEY);
 * finerenone ≈ 0.82 / 0.7 (FIDELIO/FIGARO; FINE-ONE in type 1 diabetes: albuminuria);
 * semaglutide ≈ 0.76 / 0.7 (FLOW); endothelin antagonists (IgAN, FSGS) ≈ 0.8 / 0.55 (ALIGN, PROTECT, DUPLEX).
 */
export const PILLARS = {
  rasi: { slope: 0.75, alb: 0.65, dip: 0.08, for: ['dkdT2', 'dkdT1', 'igan', 'fsgs', 'nondiabetic'] },
  sglt2: { slope: 0.6, alb: 0.7, dip: 0.06, for: ['dkdT2', 'igan', 'fsgs', 'nondiabetic'] },
  finerenone: { slope: 0.82, alb: 0.7, dip: 0.03, for: ['dkdT2', 'dkdT1'] },
  glp1: { slope: 0.76, alb: 0.7, dip: 0, for: ['dkdT2'] },
  era: { slope: 0.8, alb: 0.55, dip: 0.03, for: ['igan', 'fsgs'] },
};
export const DISEASES = { dkdT2: { slope: 5 }, dkdT1: { slope: 5 }, igan: { slope: 5.5 }, fsgs: { slope: 6 }, nondiabetic: { slope: 4 } };
export function activePillars(p) { return Object.keys(PILLARS).filter((k) => p[k] && PILLARS[k].for.includes(p.disease)); }

export const pillars = {
  id: 'pillars', mode: 'haemo', unit: 'y', tMax: 10, dt: 0.02, region: ['glomerulus'],
  params: [
    { key: 'disease', type: 'select', options: Object.keys(DISEASES), def: 'dkdT2' },
    { key: 'egfr0', type: 'range', min: 25, max: 90, step: 5, def: 50, unit: 'mL/min' },
    { key: 'uacr0', type: 'range', min: 100, max: 3000, step: 100, def: 900, unit: 'mg/g' },
    { key: 'rasi', type: 'bool', def: true },
    { key: 'sglt2', type: 'bool', def: true },
    { key: 'finerenone', type: 'bool', def: true },
    { key: 'glp1', type: 'bool', def: true },
    { key: 'era', type: 'bool', def: false },
  ],
  series: [
    { key: 'egfr', unit: 'mL/min', min: 0 },
    { key: 'uacr', unit: 'mg/g', min: 0 },
  ],
  init(p) { return { struct: p.egfr0, dip: 0, egfr: p.egfr0, uacr: p.uacr0, on: false, failure: null }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 0.25;
    const act = on ? activePillars(p) : [];
    if (on && !st.on) {
      st.on = true; emit('start', { list: act.join(',') });
      for (const k of Object.keys(PILLARS)) if (p[k] && !PILLARS[k].for.includes(p.disease)) emit('notIndicated', { pillar: k }, false);
    }
    const slopeMult = act.reduce((m, k) => m * PILLARS[k].slope, 1);
    const albMult = act.reduce((m, k) => m * PILLARS[k].alb, 1);
    const dip = act.reduce((m, k) => m + PILLARS[k].dip, 0);
    const base = DISEASES[p.disease].slope * (1 + 0.15 * Math.log10(p.uacr0 / 300));
    st.struct = Math.max(4, st.struct - base * slopeMult * dt);
    st.dip = relax(st.dip, dip, dt, 0.08);
    st.egfr = st.struct * (1 - st.dip);
    st.uacr = relax(st.uacr, p.uacr0 * albMult, dt, 0.25);
    if (st.egfr < 15 && st.failure === null) { st.failure = t; emit('kidneyFailure', { y: Math.round(t * 10) / 10 }); }
    if (on && st.uacr < p.uacr0 * 0.7) emit('albuminuriaDown');
    return st;
  },
  steps(st, p, arm) {
    const k = ['progression', 'hyperfiltration'];
    if (st.on) for (const a of activePillars(p)) k.push(a);
    return k;
  },
  gauges(st, p) {
    const act = activePillars(p);
    return [{ key: 'slopeMult', value: act.reduce((m, k) => m * PILLARS[k].slope, 1) * 100, unit: '%', lo: 0, hi: 100, band: false }];
  },
  schematic(st, p) {
    const act = st.on ? activePillars(p) : [];
    return { kind: 'nephron', focus: 'glomerulus', seg: { pct: 0.67, loop: 0.25, dct: 0.045, cd: 0.03 }, distal: 0.037, b: { sglt2: act.includes('sglt2') ? 1 : 0, mr: act.includes('finerenone') ? 0.5 : 0 }, aldo: 1, adh: 0.4, gradient: 1, kSec: 1, aff: act.includes('sglt2') ? 0.85 : 1, eff: act.includes('rasi') ? 0.7 : 1.15, pgc: 60 - 4 * act.length, proteinuria: Math.min(1, st.uacr / 1500), drugs: act };
  },
};

export const HAEMO = [glomerularHaemo, pillars];
