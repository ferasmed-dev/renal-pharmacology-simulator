// Electrolyte and acid–base correctors, urate drugs and stone prevention.
import { clamp, relax, interp } from './core.js';

// ---------------------------------------------------------------------------
// 1. Hyperkalaemia: membrane protection, shift and removal
// ---------------------------------------------------------------------------
/**
 * Potassium binders: onset and expected fall (rounded; Model). Sodium zirconium cyclosilicate: onset ≈ 1 h,
 * ≈ −1.1 mmol/L at 48 h; patiromer: onset ≈ 7 h, slower; polystyrene sulfonates: slow, variable (days).
 */
export const BINDERS_K = {
  none: { onset: 0, max: 0, tau: 1 },
  szc: { onset: 1, max: 1.4, tau: 8 },
  patiromer: { onset: 7, max: 0.9, tau: 24 },
  calciumPolystyrene: { onset: 6, max: 0.7, tau: 30 },
  sodiumPolystyrene: { onset: 6, max: 0.7, tau: 30 },
};
export const hyperkalemia = {
  id: 'hyperkalemia', mode: 'elec', unit: 'h', tMax: 48, dt: 0.1, region: ['axis'],
  params: [
    { key: 'binder', type: 'select', options: Object.keys(BINDERS_K), def: 'szc' },
    { key: 'calcium', type: 'bool', def: true },
    { key: 'insulin', type: 'bool', def: true },
    { key: 'salbutamol', type: 'bool', def: false },
    { key: 'k0', type: 'range', min: 5.6, max: 8, step: 0.1, def: 6.6, unit: 'mmol/L' },
  ],
  series: [
    { key: 'pk', unit: 'mmol/L' },
    { key: 'ecgRisk', unit: '/10', min: 0, max: 10 },
  ],
  init(p) { return { pk: p.k0, total: 0, shift: 0, removed: 0, membrane: 0, on: false, ecgRisk: 0 }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 0.5;
    const tt = t - 0.5;
    if (on && !st.on) { st.on = true; emit('start'); }
    // Untreated CKD with ongoing intake: K⁺ keeps rising slowly (Model: +0.008 mmol/L/h).
    st.total += 0.008 * dt;
    // Shift into cells: insulin + glucose ≈ −0.7 within 1 h lasting 4–6 h; salbutamol ≈ −0.5; then it wears off.
    const pulse = (a, onsetH, durH) => (tt < 0 ? 0 : a * clamp(tt / onsetH, 0, 1) * Math.exp(-Math.max(0, tt - durH) / 1.5));
    st.shift = on ? pulse(p.insulin ? 0.7 : 0, 0.75, 4) + pulse(p.salbutamol ? 0.5 : 0, 0.5, 2.5) : 0;
    const B = BINDERS_K[p.binder];
    st.removed = on && tt > B.onset ? B.max * (1 - Math.exp(-(tt - B.onset) / B.tau)) : 0;
    st.pk = p.k0 + st.total - st.shift - st.removed;
    // Calcium gluconate stabilises the myocardial membrane for ≈ 30–60 min without changing K⁺.
    st.membrane = on && p.calcium ? Math.exp(-Math.max(0, tt - 0.25) / 0.8) : 0;
    st.ecgRisk = clamp((st.pk - 5.5) * 4, 0, 10) * (1 - 0.7 * st.membrane);
    if (on && p.calcium && tt < 0.5) emit('membrane');
    if (on && p.insulin) { emit('shift'); emit('glucoseCheck'); }
    if (on && p.insulin && tt > 5 && st.shift < 0.3) emit('rebound');
    if (st.pk > 7) emit('severe');
    if (on && st.pk < 5.5) emit('kSafe');
    if (on && (p.binder === 'sodiumPolystyrene' || p.binder === 'calciumPolystyrene')) emit('slowBinder');
    return st;
  },
  steps(st, p, arm) {
    const k = ['excess', 'membraneRisk'];
    if (st.on && p.calcium) k.push('stabilise');
    if (st.on && (p.insulin || p.salbutamol)) k.push('shiftIn');
    if (st.on && p.binder !== 'none') k.push('removal');
    if (st.on && st.shift > 0.05 && st.removed < 0.2) k.push('temporary');
    return k;
  },
  gauges(st) { return [{ key: 'shift', value: st.shift, unit: 'mmol/L', lo: 0, hi: 1.2, band: false }, { key: 'removed', value: st.removed, unit: 'mmol/L', lo: 0, hi: 1.2, band: false }]; },
  schematic(st, p) {
    return {
      kind: 'axis', layout: 'potassium',
      nodes: [
        { id: 'blood', x: 210, y: 150, level: (st.pk - 5) / 2.5, text: 'K⁺ ' + st.pk.toFixed(1) },
        { id: 'heart', x: 380, y: 70, level: st.ecgRisk / 10, drug: st.on && p.calcium && st.membrane > 0.1 ? 'calciumGluconate' : null },
        { id: 'cells', x: 380, y: 240, level: st.shift / 1.2, drug: st.on && (p.insulin || p.salbutamol) ? (p.insulin ? 'insulin' : 'salbutamol') : null },
        { id: 'gut', x: 50, y: 240, level: st.removed / 1.2, drug: st.on && p.binder !== 'none' ? p.binder : null },
        { id: 'kidney', x: 50, y: 70, level: -0.5 },
      ],
      edges: [['blood', 'cells', st.shift + 0.1], ['blood', 'gut', st.removed + 0.1], ['blood', 'kidney', 0.2], ['blood', 'heart', st.ecgRisk / 10]],
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Metabolic acidosis: alkali in CKD and distal renal tubular acidosis
// ---------------------------------------------------------------------------
export const acidosis = {
  id: 'acidosis', mode: 'elec', unit: 'mo', tMax: 12, dt: 0.05, region: ['axis'],
  params: [
    { key: 'patient', type: 'select', options: ['ckd', 'distalRta'], def: 'ckd' },
    { key: 'alkali', type: 'select', options: ['sodiumBicarbonate', 'sodiumCitrate', 'potassiumCitrate'], def: 'sodiumBicarbonate' },
    { key: 'dose', type: 'range', min: 0.5, max: 2, step: 0.25, def: 1, unit: 'mEq/kg/d' },
  ],
  series: [
    { key: 'hco3', unit: 'mmol/L' },
    { key: 'pk', unit: 'mmol/L' },
    { key: 'egfr', unit: 'mL/min', min: 0 },
  ],
  init(p) { return { hco3: p.patient === 'ckd' ? 17 : 16, pk: p.patient === 'ckd' ? 5.0 : 3.0, egfr: p.patient === 'ckd' ? 30 : 85, on: false, naLoad: 0 }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 0.25;
    if (on && !st.on) { st.on = true; emit('start', { alkali: p.alkali }); }
    const base = p.patient === 'ckd' ? 17 : 16;
    st.hco3 = relax(st.hco3, on ? Math.min(26, base + 6.5 * p.dose) : base - (p.patient === 'ckd' ? 0.15 * t : 0), dt, 0.3);
    const kTarget = p.patient === 'ckd' ? 5.0 + (on && p.alkali === 'potassiumCitrate' ? 0.6 : 0) - (on ? 0.2 : 0) : 3.0 + (on && p.alkali === 'potassiumCitrate' ? 0.9 : on ? -0.1 : 0);
    st.pk = relax(st.pk, kTarget, dt, 0.4);
    // Correcting acidosis may slow CKD progression modestly (small trials; Model: slope −3.5 → −2.7 mL/min/year).
    st.egfr = Math.max(5, st.egfr - ((p.patient === 'ckd' ? (on && st.hco3 >= 22 ? 2.7 : 3.5) : 0.5) / 12) * dt);
    st.naLoad = on && p.alkali !== 'potassiumCitrate' ? p.dose * 70 : 0;
    if (on && st.hco3 >= 22) emit('target');
    if (st.pk > 5.5) emit('hyperK');
    if (st.pk < 3.2) emit('hypoK');
    if (on && st.naLoad > 100) emit('sodiumLoad');
    return st;
  },
  steps(st, p, arm) {
    const k = [p.patient === 'ckd' ? 'ammoniagenesis' : 'hSecretion', 'boneMuscle'];
    if (st.on) k.push('alkali');
    if (st.on && p.alkali === 'potassiumCitrate') k.push('citrate');
    return k;
  },
  gauges(st) { return [{ key: 'naLoad', value: st.naLoad, unit: 'mmol/d', lo: 0, hi: 200, band: false }]; },
  schematic(st, p) {
    return {
      kind: 'axis', layout: 'acid',
      nodes: [
        { id: 'kidney', x: 70, y: 90, level: -0.7, text: p.patient === 'ckd' ? 'NH₄⁺ ↓' : 'H⁺ ↓' },
        { id: 'blood', x: 220, y: 150, level: (st.hco3 - 24) / 8, text: 'HCO₃⁻ ' + st.hco3.toFixed(0) },
        { id: 'bone', x: 380, y: 80, level: st.hco3 < 20 ? 0.6 : 0 },
        { id: 'gut', x: 70, y: 240, level: 0, drug: st.on ? p.alkali : null },
      ],
      edges: [['gut', 'blood', st.on ? 0.8 : 0.1], ['kidney', 'blood', 0.2], ['bone', 'blood', st.hco3 < 20 ? 0.6 : 0.1]],
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Magnesium and phosphate repletion (refractory hypokalaemia)
// ---------------------------------------------------------------------------
export const repletion = {
  id: 'repletion', mode: 'elec', unit: 'd', tMax: 10, dt: 0.05, region: ['axis'],
  params: [
    { key: 'deficit', type: 'select', options: ['magnesium', 'phosphate'], def: 'magnesium' },
    { key: 'route', type: 'select', options: ['oral', 'iv'], def: 'iv' },
    { key: 'kcl', type: 'bool', def: true },
  ],
  series: [
    { key: 'level', unit: 'mg/dL' },
    { key: 'pk', unit: 'mmol/L' },
  ],
  init(p) { return { level: p.deficit === 'magnesium' ? 1.1 : 1.2, pk: 2.9, on: false }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 0.5;
    if (on && !st.on) { st.on = true; emit('start', { deficit: p.deficit, route: p.route }); }
    const normal = p.deficit === 'magnesium' ? 2.0 : 3.2;
    const tau = p.route === 'iv' ? 0.6 : 2.5; // oral magnesium limited by diarrhoea; about half of IV Mg²⁺ is lost in urine
    st.level = relax(st.level, on ? normal : st.level, dt, tau);
    // Hypomagnesaemia keeps ROMK open → renal K⁺ wasting: KCl alone does not correct K⁺ until Mg²⁺ is repleted.
    const mgOk = p.deficit !== 'magnesium' || st.level > 1.6;
    const kGain = p.kcl && st.pk < 4 ? (mgOk ? 0.35 : 0.06) : 0; // KCl stopped once K⁺ ≥ 4
    st.pk = clamp(st.pk + (kGain - (mgOk ? 0.05 : 0.08) * (st.pk - 2.6)) * dt, 2, 5.2);
    if (p.deficit === 'magnesium' && p.kcl && !mgOk && t > 1.5) emit('refractoryK');
    if (on && mgOk && st.level > normal * 0.85) emit('repleted');
    if (on && p.route === 'oral' && p.deficit === 'magnesium') emit('diarrhoea');
    if (st.pk >= 3.5) emit('kNormal');
    if (on && p.deficit === 'phosphate' && p.route === 'iv') emit('ivPhosphateRisk');
    return st;
  },
  steps(st, p) {
    const k = [p.deficit === 'magnesium' ? 'mgLoss' : 'pLoss'];
    if (p.deficit === 'magnesium') k.push('romk');
    if (st.on) k.push('replete');
    if (st.pk >= 3.5) k.push('kRecovers');
    return k;
  },
  schematic(st, p) {
    return {
      kind: 'axis', layout: 'repletion',
      nodes: [
        { id: 'blood', x: 220, y: 150, level: (st.level - 2) / 1.5, text: (p.deficit === 'magnesium' ? 'Mg²⁺ ' : 'P ') + st.level.toFixed(1) + ' · K⁺ ' + st.pk.toFixed(1) },
        { id: 'kidney', x: 70, y: 90, level: st.level < 1.6 ? 0.7 : 0, text: p.deficit === 'magnesium' ? 'ROMK' : '' },
        { id: 'gut', x: 70, y: 240, level: 0, drug: st.on ? (p.deficit === 'magnesium' ? 'magnesiumSalts' : 'phosphateSalts') : null },
        { id: 'cells', x: 380, y: 150, level: 0 },
      ],
      edges: [['gut', 'blood', st.on ? 0.8 : 0.1], ['blood', 'kidney', st.level < 1.6 ? 0.8 : 0.3], ['cells', 'blood', 0.3]],
    };
  },
};

// ---------------------------------------------------------------------------
// 4. Urate-lowering therapy (gout with CKD)
// ---------------------------------------------------------------------------
/** Fractional fall in serum urate at steady state (titrated to target where applicable; rounded; Model). */
export const ULT = {
  allopurinol: { fall: 0.42, months: 3, gfrMin: 0 },
  febuxostat: { fall: 0.45, months: 1.5, gfrMin: 0 },
  probenecid: { fall: 0.3, months: 1.5, gfrMin: 50 },
  benzbromarone: { fall: 0.45, months: 1.5, gfrMin: 20 },
  losartan: { fall: 0.08, months: 1, gfrMin: 0 },
  sglt2: { fall: 0.12, months: 1, gfrMin: 20 },
  pegloticase: { fall: 0.85, months: 0.1, gfrMin: 0 },
};
export const urate = {
  id: 'urate', mode: 'elec', unit: 'mo', tMax: 12, dt: 0.02, region: ['axis'],
  params: [
    { key: 'drug', type: 'select', options: Object.keys(ULT), def: 'allopurinol' },
    { key: 'egfr', type: 'range', min: 15, max: 90, step: 5, def: 45, unit: 'mL/min' },
    { key: 'u0', type: 'range', min: 7, max: 12, step: 0.1, def: 9.2, unit: 'mg/dL' },
    { key: 'prophylaxis', type: 'bool', def: true },
    { key: 'hlaB5801', type: 'bool', def: false },
  ],
  series: [
    { key: 'urate', unit: 'mg/dL', min: 0 },
    { key: 'flare', unit: '%/mo', min: 0 },
  ],
  init(p) { return { urate: p.u0, flare: 8, on: false, drop: 0 }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 0.25;
    const d = ULT[p.drug];
    if (on && !st.on) {
      st.on = true; emit('start', { drug: p.drug });
      if (p.drug === 'allopurinol') emit(p.hlaB5801 ? 'hlaRisk' : 'startLow');
      if (p.drug === 'febuxostat') emit('cvWarning');
      if (p.drug === 'probenecid' && p.egfr < d.gfrMin) emit('ineffectiveGfr');
      if (p.drug === 'benzbromarone') emit('liver');
      if (p.drug === 'pegloticase') emit('g6pd');
    }
    const works = p.egfr >= d.gfrMin ? 1 : 0.25;
    const target = on ? p.u0 * (1 - d.fall * works) : p.u0;
    const prev = st.urate;
    st.urate = relax(st.urate, target, dt, d.months / 2);
    // Flares rise when urate falls fast (crystal remodelling) unless colchicine/NSAID prophylaxis; then fall below baseline.
    const falling = Math.max(0, prev - st.urate) / dt; // mg/dL per month
    const base = st.urate < 6 ? 8 * clamp(1 - (t - 3) / 9, 0.3, 1) : 8;
    st.flare = base + falling * (p.prophylaxis ? 3 : 12);
    if (on && st.urate < 6) emit('target6');
    if (on && st.urate < 5) emit('target5');
    if (on && !p.prophylaxis && falling > 0.4) emit('flare');
    return st;
  },
  steps(st, p, arm) {
    const k = ['production', 'excretion'];
    if (st.on) k.push(['allopurinol', 'febuxostat'].includes(p.drug) ? 'xo' : p.drug === 'pegloticase' ? 'uricase' : 'urat1');
    if (st.on && st.urate < 6) k.push('dissolve');
    return k;
  },
  gauges(st) { return [{ key: 'target', value: st.urate, unit: 'mg/dL', lo: 0, hi: 6 }]; },
  schematic(st, p) {
    const on = st.on;
    const xo = ['allopurinol', 'febuxostat'].includes(p.drug);
    return {
      kind: 'axis', layout: 'urate',
      nodes: [
        { id: 'liver', x: 70, y: 90, level: on && xo ? -0.5 : 0.4, drug: on && xo ? p.drug : null, text: 'XO' },
        { id: 'blood', x: 220, y: 150, level: (st.urate - 6) / 4, drug: on && p.drug === 'pegloticase' ? 'pegloticase' : null, text: '{urate} ' + st.urate.toFixed(1) },
        { id: 'kidney', x: 380, y: 90, level: 0, drug: on && ['probenecid', 'benzbromarone', 'losartan', 'sglt2'].includes(p.drug) ? p.drug : null, text: 'URAT1' },
        { id: 'joint', x: 380, y: 240, level: st.urate > 6.8 ? 0.7 : 0 },
      ],
      edges: [['liver', 'blood', on && xo ? 0.3 : 0.8], ['blood', 'kidney', 0.6], ['blood', 'joint', st.urate > 6.8 ? 0.7 : 0.1]],
    };
  },
};

// ---------------------------------------------------------------------------
// 5. Tumour lysis: rasburicase vs allopurinol
// ---------------------------------------------------------------------------
export const tumourLysis = {
  id: 'tumourLysis', mode: 'elec', unit: 'h', tMax: 72, dt: 0.1, region: ['axis'],
  params: [
    { key: 'drug', type: 'select', options: ['rasburicase', 'allopurinol', 'febuxostat'], def: 'rasburicase' },
    { key: 'hydration', type: 'bool', def: true },
    { key: 'g6pd', type: 'bool', def: false },
  ],
  series: [
    { key: 'urate', unit: 'mg/dL', min: 0 },
    { key: 'cr', unit: 'mg/dL', min: 0 },
  ],
  init() { return { urate: 9, cr: 1.0, gen: 0, on: false }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated';
    if (on && !st.on && t >= 1) { st.on = true; emit('start', { drug: p.drug }); if (p.drug === 'rasburicase' && p.g6pd) emit('hemolysis'); }
    // Chemotherapy at t = 0 releases purines: urate generation peaks over 24–48 h (Model).
    const genRate = 0.6 * Math.exp(-t / 30);
    const xo = st.on && p.drug !== 'rasburicase' ? (p.drug === 'febuxostat' ? 0.1 : 0.2) : 1; // XO inhibitors stop NEW urate only
    const uricase = st.on && p.drug === 'rasburicase' && !p.g6pd ? 1.2 : 0; // converts existing urate to allantoin
    const renal = 0.01 * (p.hydration ? 1.5 : 1) * (1 / st.cr);
    st.urate = Math.max(0.3, st.urate + (genRate * xo - uricase * st.urate - renal * st.urate) * dt);
    // Urate nephropathy: crystals in the tubules when urate is high and urine flow low.
    const injury = Math.max(0, st.urate - 10) * (p.hydration ? 0.01 : 0.03);
    st.cr = relax(st.cr, 1.0 + injury * 40, dt, 12);
    if (st.urate > 12) emit('highUrate');
    if (on && st.urate < 4) emit('urateLow');
    if (st.cr > 1.5) emit('aki');
    return st;
  },
  steps(st, p, arm) {
    const k = ['lysis', 'purines'];
    if (st.on) k.push(p.drug === 'rasburicase' ? 'allantoin' : 'xoBlock');
    if (st.urate > 10) k.push('crystals');
    return k;
  },
  schematic(st, p) {
    const on = st.on;
    return {
      kind: 'axis', layout: 'tls',
      nodes: [
        { id: 'tumour', x: 60, y: 100, level: Math.exp(-0 / 30) * 0.8 },
        { id: 'liver', x: 220, y: 70, level: on && p.drug !== 'rasburicase' ? -0.5 : 0.5, drug: on && p.drug !== 'rasburicase' ? p.drug : null, text: 'XO' },
        { id: 'blood', x: 220, y: 200, level: (st.urate - 6) / 6, drug: on && p.drug === 'rasburicase' ? 'rasburicase' : null, text: '{urate} ' + st.urate.toFixed(1) },
        { id: 'kidney', x: 390, y: 200, level: (st.cr - 1) / 2 },
      ],
      edges: [['tumour', 'liver', 0.8], ['liver', 'blood', on && p.drug !== 'rasburicase' ? 0.2 : 0.8], ['blood', 'kidney', 0.6]],
    };
  },
};

// ---------------------------------------------------------------------------
// 6. Stone prevention drugs
// ---------------------------------------------------------------------------
/** Relative supersaturation proxies (1 = crystallisation threshold); same approach as the 24-h urine work-up. Model. */
export function rss(u) {
  const V = Math.max(0.3, u.V);
  const citInhib = 2 / (1 + u.cit / 320);
  const caox = (u.ca / V / 125) * (u.ox / V / 20) * citInhib;
  const caP = (u.ca / V / 125) * Math.pow(10, u.pH - 6.6) * citInhib;
  const ua = (u.ua / V) * (1 / (1 + Math.pow(10, u.pH - 5.5))) / 100;
  const cysSol = u.pH > 7 ? 250 * Math.pow(2, (u.pH - 7) / 0.5) : 250;
  const cys = (u.cys / V) / cysSol;
  const str = u.urease ? 3.5 * clamp((Math.max(u.pH, 7.4) - 6.8) / 0.6, 0, 3) : 0;
  return { caox, caP, ua, cys, str };
}
export const STONE_PROFILES = {
  hypercalciuria: { u: { V: 1.4, ca: 360, ox: 38, ua: 600, cys: 20, cit: 450, pH: 6.0, urease: false }, salt: 'caox' },
  hypocitraturia: { u: { V: 1.4, ca: 240, ox: 38, ua: 600, cys: 20, cit: 150, pH: 6.0, urease: false }, salt: 'caox' },
  uricAcid: { u: { V: 1.3, ca: 200, ox: 30, ua: 850, cys: 20, cit: 500, pH: 5.1, urease: false }, salt: 'ua' },
  cystinuria: { u: { V: 1.5, ca: 150, ox: 25, ua: 500, cys: 750, cit: 500, pH: 6.2, urease: false }, salt: 'cys' },
  struvite: { u: { V: 1.5, ca: 200, ox: 30, ua: 500, cys: 20, cit: 500, pH: 7.2, urease: true }, salt: 'str' },
  primaryHyperoxaluria: { u: { V: 2, ca: 200, ox: 140, ua: 600, cys: 20, cit: 450, pH: 6.0, urease: false }, salt: 'caox' },
};
/** What each drug does to the 24-h urine (rounded; Model). */
export const STONE_DRUGS = {
  thiazide: (u) => ({ ...u, ca: u.ca * 0.6 }),
  potassiumCitrate: (u) => ({ ...u, cit: u.cit + 400, pH: Math.min(7.0, u.pH + 0.7) }),
  alkaliAllopurinol: (u) => ({ ...u, pH: 6.8, ua: u.ua * 0.65 }),
  tiopronin: (u) => ({ ...u, cys: u.cys * 0.45, pH: 7.5, V: Math.max(u.V, 3) }),
  penicillamine: (u) => ({ ...u, cys: u.cys * 0.5, pH: 7.5, V: Math.max(u.V, 3) }),
  acetohydroxamic: (u) => ({ ...u, urease: false, pH: 6.3 }),
  lumasiran: (u) => ({ ...u, ox: u.ox * 0.35 }),
  nedosiran: (u) => ({ ...u, ox: u.ox * 0.4 }),
  loopDiuretic: (u) => ({ ...u, ca: u.ca * 1.6, V: u.V + 0.5 }),
};
export const stonePrevention = {
  id: 'stonePrevention', mode: 'elec', unit: 'mo', tMax: 24, dt: 0.1, region: ['nephron'],
  params: [
    { key: 'profile', type: 'select', options: Object.keys(STONE_PROFILES), def: 'hypercalciuria' },
    { key: 'drug', type: 'select', options: Object.keys(STONE_DRUGS), def: 'thiazide' },
    { key: 'fluids', type: 'bool', def: true },
  ],
  series: [
    { key: 'size', unit: 'mm', min: 0 },
    { key: 'rss', unit: '×', min: 0 },
  ],
  init(p) { const pr = STONE_PROFILES[p.profile]; const r = rss(pr.u); return { size: 2, rss: r[pr.salt], all: r, on: false, u: pr.u }; },
  step(st, t, dt, p, arm, emit) {
    const pr = STONE_PROFILES[p.profile];
    const on = arm === 'treated' && t >= 1;
    if (on && !st.on) { st.on = true; emit('start', { drug: p.drug }); if (p.drug === 'loopDiuretic') emit('wrongDrug'); }
    let u = pr.u;
    if (on) { u = STONE_DRUGS[p.drug](u); if (p.fluids) u = { ...u, V: Math.max(u.V, 2.5) }; }
    st.u = u;
    st.all = rss(u);
    st.rss = st.all[pr.salt];
    const k = pr.salt === 'str' ? 0.36 : 0.12;
    let dS = st.rss > 1 ? k * Math.pow(st.rss - 1, 0.8) : 0;
    if (st.rss < 0.8 && pr.salt === 'ua' && st.size > 0) dS = -1.5; // only uric acid stones dissolve reliably
    st.size = clamp(st.size + dS * dt, 0, 40);
    if (on && st.rss < 1) emit('undersaturated');
    if (st.size > 10) emit('growing');
    if (on && st.size === 0) emit('dissolved');
    return st;
  },
  steps(st, p, arm) {
    const k = ['supersaturation'];
    if (st.on) k.push('drugEffect');
    if (st.on && st.rss < 1) k.push('noGrowth');
    return k;
  },
  gauges(st) { return ['caox', 'caP', 'str', 'ua', 'cys'].map((key) => ({ key: 'rss_' + key, value: st.all[key], unit: '×', lo: 0, hi: 1 })); },
  schematic(st, p) {
    const map = { thiazide: { thz: 0.6 }, potassiumCitrate: {}, alkaliAllopurinol: {}, tiopronin: {}, penicillamine: {}, acetohydroxamic: {}, lumasiran: {}, nedosiran: {}, loopDiuretic: { loop: 0.6 } };
    return { kind: 'nephron', seg: { pct: 0.67, loop: 0.25, dct: 0.045, cd: 0.03 }, distal: 0.037, b: st.on ? map[p.drug] : {}, aldo: 1, adh: 0.5, gradient: 1, kSec: 1, stone: { size: st.size, type: STONE_PROFILES[p.profile].salt }, drugs: st.on ? [p.drug] : [] };
  },
};

export const ELECTROLYTES = [hyperkalemia, acidosis, repletion, urate, tumourLysis, stonePrevention];
