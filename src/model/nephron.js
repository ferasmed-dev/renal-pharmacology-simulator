// Shared nephron + body-fluid model used by the diuretic entities.
// Steady-state segment handling of filtered Na⁺ (recomputed every step) drives slow
// balances of Na⁺, K⁺ and water, plus HCO₃⁻, Mg²⁺ and urate. Pure functions only.
import { clamp, relax } from './core.js';

/** Filtered Na⁺ (mmol/day) for a GFR in mL/min: GFR × 1.44 L/day × 140 mmol/L. */
export const filteredNa = (gfr) => gfr * 1.44 * 140;

/**
 * Normal fractional reabsorption of the filtered Na⁺ load (physiology): proximal tubule ≈ 65–67%,
 * thick ascending limb ≈ 25%, distal convoluted tubule ≈ 5%, collecting duct ≈ 3%, excreted ≈ 0.5–1%.
 * Each segment reabsorbs a fraction of what reaches it, up to a capacity (fraction of the filtered load),
 * so blocking one segment is partly compensated downstream. Capacities: Model.
 */
export const SEG = {
  pct: 0.67,
  loopFrac: 0.75, loopCap: 0.4,
  dctFrac: 0.55, dctCap: 0.085,
  cdBase: 0.5, cdAldo: 0.3, cdCapBase: 0.025, cdCapAldo: 0.015,
};

/**
 * Segment handling for one moment.
 * x = { gfr, eav (effective arterial volume, 1 = normal), aldo (1 = normal), adh (0–1), glucose (mg/dL),
 *       remodel (0–1, distal hypertrophy after chronic loop blockade), ndi (0–1 nephrogenic resistance),
 *       pk (plasma K⁺), mannitol (mOsm/day), urea (mOsm/day), naIn, kIn,
 *       b: { ca, sglt2, osm, loop, thz, enac, mr, v2 } blocks 0–1 }
 */
export function nephronFlux(x) {
  const b = { ca: 0, sglt2: 0, osm: 0, loop: 0, thz: 0, enac: 0, mr: 0, v2: 0, ...x.b };
  const F = filteredNa(x.gfr);
  // Proximal: glomerulotubular balance and "braking" — a contracted effective volume raises proximal reabsorption.
  const brake = clamp(0.25 * (1 - x.eav), -0.12, 0.1); // negative = pressure natriuresis / aldosterone escape
  const pct = clamp((SEG.pct + brake) * (1 - 0.35 * b.ca - 0.04 * b.sglt2 - 0.12 * b.osm), 0.3, 0.85);
  let d = 1 - pct;
  // Pressure natriuresis ("aldosterone escape"): an expanded effective volume lowers distal reabsorption too.
  const escape = 1 - 0.8 * clamp(x.eav - 1, 0, 0.5);
  const loop = Math.min(SEG.loopFrac * (1 - b.loop) * d * (0.5 + 0.5 * escape), SEG.loopCap * (1 - b.loop));
  d -= loop;
  const dct = Math.min(SEG.dctFrac * (1 - b.thz) * d * escape, SEG.dctCap * (1 + 0.6 * (x.remodel || 0)) * (1 - b.thz));
  d -= dct;
  const distal = d; // fraction of filtered Na⁺ reaching the collecting duct
  const aEff = Math.max(0, x.aldo * (1 - b.mr));
  const fC = clamp(SEG.cdBase + SEG.cdAldo * Math.min(aEff, 1.4), 0.4, 0.95) * (1 - b.enac) * escape;
  const capC = (SEG.cdCapBase + SEG.cdCapAldo * Math.min(aEff, 3)) * (1 - b.enac);
  const cd = Math.min(fC * d, capC);
  d -= cd;
  const fena = d;
  const uNa = fena * F;
  // K⁺ secretion: rises with distal Na⁺ delivery and aldosterone, falls with ENaC block / MR antagonism and hypokalaemia.
  const flow = Math.sqrt(Math.max(distal, 1e-4) / 0.037);
  const pkF = Math.pow(clamp(x.pk / 4.2, 0.5, 1.8), 2);
  const uK = x.kIn * 0.9 * flow * Math.pow(Math.max(aEff, 0.05), 0.5) * (1 - 0.8 * b.enac) * pkF * (x.gfr < 30 ? 0.6 + x.gfr / 75 : 1);
  // Glucose: SGLT2 blockade causes glycosuria (≈ 60–80 g/day with normal GFR and hyperglycaemia).
  const toG = (mgdl) => (mgdl * 10 * x.gfr * 1.44) / 1000; // mg/dL × L/day → g/day
  const gluFiltered = toG(x.glucose);
  const spill = toG(Math.max(0, x.glucose - 180)); // above the renal threshold
  const uGlu = Math.min(gluFiltered, spill + 0.3 * gluFiltered * b.sglt2);
  // Water: urine osmolality between a minimum (diluting segments) and a maximum (medullary gradient), set by ADH.
  const uMax = 1100 * (1 - 0.75 * Math.min(1, 2.2 * b.loop)); // loop block washes out the medullary gradient
  const uMin = 60 + 350 * b.thz + 150 * b.loop; // thiazides impair maximal dilution (DCT is a diluting segment)
  const adhEff = clamp((x.adh ?? 0.3) * (1 - b.v2) * (1 - (x.ndi || 0)), 0, 1); // V2 antagonism or nephrogenic resistance
  const uOsm = Math.max(uMin, uMin + (Math.max(uMax, uMin) - uMin) * adhEff);
  const osmEx = 2 * (uNa + uK) + (x.urea ?? 350) + uGlu * 5.55 + (x.mannitol || 0);
  const uVol = osmEx / uOsm; // L/day
  // Calcium: loop → hypercalciuria; thiazide → hypocalciuria; contraction → more proximal Ca²⁺ reabsorption.
  const uCa = 200 * (1 + 1.6 * b.loop) * (1 - 0.6 * b.thz) * (1 - 0.6 * Math.max(0, 1 - x.eav)) * (x.gfr / 100) ** 0.5;
  return { F, fena, uNa, uK, uGlu, uOsm, uVol, uCa, distal, seg: { pct, loop, dct, cd }, aEff, adhEff, b };
}

/** Initial body state for a patient profile. */
export function bodyInit(pt) {
  const tbw = pt.tbw ?? 42;
  const pna = pt.pna ?? 140;
  const ecf = pt.ecf ?? 14;
  const naE = ecf * pna;
  const kE = tbw * pna - naE + ((pt.pk ?? 4.2) - 4.2) * 300; // keeps PNa = (Na_e + K_e)/TBW
  return {
    tbw, naE, kE, kE0: kE, ecf0: ecf, tbw0: tbw, pna, ecf, pk: pt.pk ?? 4.2, hco3: pt.hco3 ?? 24, mg: pt.mg ?? 2.0, urate: pt.urate ?? 6.0,
    gfr: pt.gfr, cr: 0.9 * 100 / pt.gfr, map: pt.map ?? 93, remodel: 0, eav: pt.eav ?? 1, aldo: pt.aldo ?? 1, adh: 0.3,
    weight: 70 + (tbw - 42), uNa: pt.naIn ?? 150, uK: pt.kIn ?? 70, uVol: 1.5, uOsm: 500, uCa: 200, uGlu: 0, fena: 0.0074,
    distal: 0.037, seg: { pct: 0.67, loop: 0.25, dct: 0.045, cd: 0.03 }, uPH: 6.0, vasc: 0,
  };
}

/**
 * Advance the body one step (dt in days) under drug blocks b. pt = patient profile.
 */
export function bodyStep(st, pt, b, dt, extra = {}) {
  // Effective arterial volume follows ECF from the patient's own baseline (filling); aldosterone follows it.
  st.eav = (pt.eav ?? 1) + 0.8 * (st.ecf - st.ecf0) / 14;
  st.aldo = pt.aldoFixed ?? clamp((pt.aldo ?? 1) + 4 * ((pt.eav ?? 1) - st.eav) + 0.5 * (st.pk - 4.2), 0.3, 4);
  // ADH: osmotic (plasma Na⁺) and non-osmotic (low effective volume) stimuli, unless fixed (SIADH) or absent (central DI).
  st.adh = pt.adhFixed ?? clamp((st.pna - 134) / 10 + 0.8 * Math.max(0, 0.9 - st.eav), 0.02, 1);
  // GFR: prerenal fall when effective volume drops below the patient's baseline.
  st.gfr = pt.gfr * clamp(1 - 1.2 * Math.max(0, (pt.eav ?? 1) - st.eav), 0.3, 1.1) * (extra.gfrFactor ?? 1);
  st.remodel = relax(st.remodel, b.loop || 0, dt, 7);
  const f = nephronFlux({ gfr: st.gfr, eav: st.eav, aldo: st.aldo, adh: st.adh, glucose: pt.glucose ?? 100, remodel: st.remodel, ndi: extra.ndi ?? pt.ndi ?? 0, pk: st.pk, mannitol: extra.mannitol || 0, urea: extra.urea ?? pt.urea, naIn: pt.naIn ?? 150, kIn: pt.kIn ?? 70, b });
  Object.assign(st, { uNa: f.uNa, uK: f.uK, uVol: f.uVol, uOsm: f.uOsm, uCa: f.uCa * (pt.uCaFactor ?? 1), uGlu: f.uGlu, fena: f.fena, distal: f.distal, seg: f.seg });
  // Water intake: fixed habit, or thirst-driven (drinks to replace losses and more if hypernatraemic).
  const insensible = 0.8;
  const thirst = pt.water === 'thirst' ? Math.max(0.5, f.uVol + insensible + clamp((st.pna - 141) * 0.5, -1.5, 3)) : (pt.water ?? 2.2) + clamp((st.pna - 142) * 0.6, 0, 4); // thirst rises with hypernatraemia
  const waterIn = extra.waterIn ?? thirst;
  st.naE += ((extra.naIn ?? pt.naIn ?? 150) - f.uNa) * dt;
  st.kE += ((pt.kIn ?? 70) * 0.9 - f.uK) * dt; // ≈ 10% of K⁺ intake leaves in stool
  st.tbw = Math.max(25, st.tbw + (waterIn - f.uVol - insensible) * dt);
  st.pna = (st.naE + st.kE) / st.tbw;
  st.ecf = st.naE / st.pna;
  st.pk = clamp(4.2 + (st.kE - (st.tbw0 * (pt.pna ?? 140) - st.ecf0 * (pt.pna ?? 140))) / 300, 1.5, 9);
  // Body weight: total body water, minus the water that follows K⁺ into cells when K⁺ stores refill (Model: Edelman K_e is a pool, not a volume).
  st.weight = 70 + (st.tbw - 42) - (st.kE - st.kE0) / 140;
  // Acid–base: contraction and distal H⁺ secretion raise HCO₃⁻; carbonic anhydrase inhibition and K⁺-sparing agents lower it.
  const hTarget = 24 + 10 * Math.max(0, 1 - st.eav) + 2 * (Math.min(st.aldo * (1 - (b.mr || 0)), 3) - 1) + 2 * Math.max(0, 3.6 - st.pk)
    - 8 * (b.ca || 0) - 1.5 * (b.enac || 0) - 1.5 * (b.mr || 0) + (pt.hco3Offset ?? 0);
  st.hco3 = relax(st.hco3, clamp(hTarget, 12, 40), dt, 1.5);
  st.uPH = clamp(5.8 + 1.6 * (b.ca || 0) * (st.hco3 / 24) - 0.3 * Math.max(0, st.hco3 - 28) / 4, 4.8, 7.8);
  st.mg = relax(st.mg, clamp((pt.mg ?? 2.0) - 0.35 * (b.loop || 0) - 0.2 * (b.thz || 0) + 0.15 * (b.enac || 0), 1, 2.6), dt, 10);
  st.urate = relax(st.urate, (pt.urate ?? 6) + 2 * Math.max(0, 1 - st.eav) + 0.8 * ((b.loop || 0) + (b.thz || 0)) - 0.8 * (b.sglt2 || 0), dt, 7);
  st.cr = relax(st.cr, 0.9 * 100 / Math.max(5, st.gfr), dt, 1);
  st.vasc = relax(st.vasc, extra.vasodilation || 0, dt, 14);
  st.map = (pt.map ?? 93) + (pt.saltSens ?? 2.5) * (st.ecf - st.ecf0) - st.vasc + (extra.mapOffset || 0);
  return f;
}
