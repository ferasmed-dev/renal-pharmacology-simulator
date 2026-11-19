// Public model API: entities by block, presets, key decisions and "Model" tags. Pure (no DOM).
export * from './model/core.js';
export * as nephron from './model/nephron.js';
export * as diuretics from './model/diuretics.js';
export * as hormones from './model/hormones.js';
export * as haemodynamics from './model/haemodynamics.js';
export * as electrolytes from './model/electrolytes.js';
import { DIURETICS, loopBlock, NA_LIMIT_24H } from './model/diuretics.js';
import { HORMONES, PTH_RANGE } from './model/hormones.js';
import { HAEMO, activePillars } from './model/haemodynamics.js';
import { ELECTROLYTES } from './model/electrolytes.js';

export const MODES = [
  { id: 'diur', entities: DIURETICS },
  { id: 'horm', entities: HORMONES },
  { id: 'haemo', entities: HAEMO },
  { id: 'elec', entities: ELECTROLYTES },
];
export const ENTITIES = MODES.flatMap((m) => m.entities);
export const ENTITY = Object.fromEntries(ENTITIES.map((e) => [e.id, e]));
export const modeOf = (id) => ENTITY[id]?.mode;

/** Teaching presets; each has a deep link ?preset=<key>. Expected behaviour is checked in tests/model.test.js. */
export const PRESETS = {
  // Diuretics
  mannitolIcp: { entity: 'osmotic', params: {} },
  mannitolOliguric: { entity: 'osmotic', params: { oliguric: true, repeat: true } },
  acetazolamideAlkalosis: { entity: 'carbonicAnhydrase', params: {} },
  sglt2Dkd: { entity: 'sglt2', params: {} },
  sglt2SickDay: { entity: 'sglt2', params: { sickDay: true } },
  loopHeartFailure: { entity: 'loop', params: {} },
  loopCkdUnderdosed: { entity: 'loop', params: { gfr: 25, dose: 80, route: 'oral' } },
  loopCkdSequential: { entity: 'loop', params: { gfr: 25, dose: 240, route: 'iv', addThiazide: true } },
  loopTorasemide: { entity: 'loop', params: { drug: 'torasemide', dose: 80 } },
  thiazideHypertension: { entity: 'thiazide', params: {} },
  thiazideHyponatraemia: { entity: 'thiazide', params: { patient: 'elderlyLowSolute', gfr: 60, water: 3.2 } },
  thiazideStones: { entity: 'thiazide', params: { patient: 'hypercalciuria' } },
  chlorthalidoneCkd: { entity: 'thiazide', params: { drug: 'chlorthalidone', gfr: 25 } },
  amilorideHypoK: { entity: 'enac', params: {} },
  amilorideLiddle: { entity: 'enac', params: { indication: 'liddle' } },
  amilorideLithium: { entity: 'enac', params: { indication: 'lithiumNDI' } },
  spironolactoneAldosteronism: { entity: 'mra', params: {} },
  spironolactoneCirrhosis: { entity: 'mra', params: { patient: 'cirrhosis', dose: 4 } },
  mraHyperkalaemia: { entity: 'mra', params: { patient: 'heartFailure', gfr: 25, dose: 2 } },
  tolvaptanSiadh: { entity: 'vaptan', params: {} },
  tolvaptanOvercorrection: { entity: 'vaptan', params: { treatment: 'tolvaptan30', highRisk: true } },
  siadhRestriction: { entity: 'vaptan', params: { treatment: 'restriction' } },
  siadhUrea: { entity: 'vaptan', params: { treatment: 'urea' } },
  // Hormone axes
  aceiProteinuria: { entity: 'raas', params: {} },
  aceiRenalArteryStenosis: { entity: 'raas', params: { ras: true } },
  dualRaasBlockade: { entity: 'raas', params: { drug: 'aceiArb', k0: 5.0 } },
  sparsentan: { entity: 'raas', params: { drug: 'sparsentan', egfr0: 60 } },
  desmopressinCentralDi: { entity: 'desmopressin', params: {} },
  desmopressinLithium: { entity: 'desmopressin', params: { cause: 'lithium' } },
  desmopressinWaterExcess: { entity: 'desmopressin', params: { drinking: 'habit4L' } },
  terlipressinHrs: { entity: 'terlipressin', params: {} },
  terlipressinNoResponse: { entity: 'terlipressin', params: { response: 'nonResponder' } },
  mbdSevelamerCinacalcet: { entity: 'ckdMbd', params: {} },
  mbdCalciumCalcitriol: { entity: 'ckdMbd', params: { binder: 'calciumCarbonate', vitd: 'calcitriol', calcimimetic: 'none' } },
  xlhBurosumab: { entity: 'xlh', params: {} },
  anaemiaEsaIron: { entity: 'anemia', params: {} },
  anaemiaEsaNoIron: { entity: 'anemia', params: { iron: 'none', ferritin0: 50 } },
  anaemiaHighTarget: { entity: 'anemia', params: { highTarget: true, ferritin0: 300 } },
  anaemiaHifPhi: { entity: 'anemia', params: { esa: 'none', hif: 'roxadustat', iron: 'oral' } },
  adpkdTolvaptan: { entity: 'adpkd', params: {} },
  // Glomerular haemodynamics and nephroprotection
  tripleWhammy: { entity: 'glomerularHaemo', params: {} },
  sglt2Haemodynamics: { entity: 'glomerularHaemo', params: { state: 'normal', nsaid: false, acei: false, diuretic: false, sglt2: true } },
  aceiBilateralStenosis: { entity: 'glomerularHaemo', params: { state: 'bilateralRas', nsaid: false, diuretic: false, acei: true } },
  nsaidHeartFailure: { entity: 'glomerularHaemo', params: { state: 'heartFailure', acei: false, diuretic: false, nsaid: true } },
  calcineurinTransplant: { entity: 'glomerularHaemo', params: { state: 'transplant', nsaid: false, acei: false, diuretic: false, cni: true } },
  contrastCkd: { entity: 'glomerularHaemo', params: { state: 'ckd', nsaid: false, acei: false, diuretic: false, contrast: true } },
  pillarsType2: { entity: 'pillars', params: {} },
  pillarsType1: { entity: 'pillars', params: { disease: 'dkdT1', sglt2: false, glp1: false } },
  pillarsIgan: { entity: 'pillars', params: { disease: 'igan', finerenone: false, glp1: false, era: true, uacr0: 1500 } },
  // Electrolytes, urate, stones
  hyperkalaemiaSzc: { entity: 'hyperkalemia', params: {} },
  hyperkalaemiaShiftOnly: { entity: 'hyperkalemia', params: { binder: 'none' } },
  hyperkalaemiaPatiromer: { entity: 'hyperkalemia', params: { binder: 'patiromer', calcium: false, insulin: false, k0: 6.0 } },
  acidosisCkd: { entity: 'acidosis', params: {} },
  rtaPotassiumCitrate: { entity: 'acidosis', params: { patient: 'distalRta', alkali: 'potassiumCitrate' } },
  magnesiumRefractoryK: { entity: 'repletion', params: {} },
  phosphateRepletion: { entity: 'repletion', params: { deficit: 'phosphate', route: 'oral' } },
  allopurinolGout: { entity: 'urate', params: {} },
  probenecidLowGfr: { entity: 'urate', params: { drug: 'probenecid', egfr: 30 } },
  pegloticase: { entity: 'urate', params: { drug: 'pegloticase', u0: 11 } },
  rasburicaseTls: { entity: 'tumourLysis', params: {} },
  allopurinolTls: { entity: 'tumourLysis', params: { drug: 'allopurinol' } },
  rasburicaseG6pd: { entity: 'tumourLysis', params: { g6pd: true } },
  thiazideCalciumStones: { entity: 'stonePrevention', params: {} },
  citrateHypocitraturia: { entity: 'stonePrevention', params: { profile: 'hypocitraturia', drug: 'potassiumCitrate' } },
  uricAcidStones: { entity: 'stonePrevention', params: { profile: 'uricAcid', drug: 'alkaliAllopurinol' } },
  cystinuria: { entity: 'stonePrevention', params: { profile: 'cystinuria', drug: 'tiopronin' } },
  struviteAha: { entity: 'stonePrevention', params: { profile: 'struvite', drug: 'acetohydroxamic' } },
  primaryHyperoxaluria: { entity: 'stonePrevention', params: { profile: 'primaryHyperoxaluria', drug: 'lumasiran' } },
  loopWrongForStones: { entity: 'stonePrevention', params: { drug: 'loopDiuretic' } },
};

/** Drug(s) that fit each stone profile. */
export const STONE_MATCH = {
  hypercalciuria: ['thiazide'], hypocitraturia: ['potassiumCitrate'], uricAcid: ['alkaliAllopurinol'],
  cystinuria: ['tiopronin', 'penicillamine'], struvite: ['acetohydroxamic'], primaryHyperoxaluria: ['lumasiran', 'nedosiran'],
};

/** Key decision at a given state (pure; returns an i18n key under ent.<id>.dec). */
export function decision(id, st, p) {
  switch (id) {
    case 'osmotic': return p.oliguric ? 'avoidOliguric' : st.posm - 288 > 20 ? 'gap' : 'ok';
    case 'carbonicAnhydrase': return st.pk < 3.3 ? 'addK' : 'ok';
    case 'sglt2': return p.egfr0 < 20 ? 'notStart' : p.sickDay ? 'sickDay' : 'start';
    case 'loop': {
      const lb = loopBlock(p.drug, p.dose, p.route, p.gfr, p.freq);
      if (lb.effective < 20) return 'doseTooLow';
      if (st.remodel > 0.25 && !p.addThiazide) return 'addThiazide';
      if (st.pk < 3.5) return 'addK';
      return 'ok';
    }
    case 'thiazide':
      if (st.pna < 130) return 'stopHypoNa';
      if (p.gfr < 30 && p.drug === 'hydrochlorothiazide') return 'lowGfr';
      return p.patient === 'hypercalciuria' ? 'stones' : 'ok';
    case 'enac': return st.pk > 5.5 ? 'hyperK' : p.indication;
    case 'mra': return st.pk > 5.5 ? 'hyperK' : p.patient;
    case 'vaptan': return st.rate24 > (p.highRisk ? 8 : NA_LIMIT_24H) ? 'relower' : p.treatment;
    case 'raas':
      if (p.drug === 'aceiArb') return 'avoidDual';
      if (p.drug === 'aliskiren') return 'aliskiren';
      if (st.crRise > 30) return 'stop';
      if (st.pk > 5.5) return 'hyperK';
      return 'continue';
    case 'desmopressin': return p.cause !== 'central' ? 'nephrogenic' : p.drinking === 'habit4L' ? 'restrictWater' : 'central';
    case 'terlipressin': return p.hypoxia ? 'contraindicated' : 'treat';
    case 'ckdMbd':
      if (st.ca > 10.2) return 'hypercalcemia';
      if (st.pth < PTH_RANGE[0]) return 'oversuppressed';
      if (st.p > 5.5) return 'phosphateHigh';
      return 'onTarget';
    case 'xlh': return p.treatment;
    case 'anemia':
      if (st.hb > 13) return 'tooHigh';
      if (p.esa !== 'none' && p.hif !== 'none') return 'combination';
      if (st.tsat < 20) return 'ironFirst';
      return st.hb < 10 ? 'start' : 'maintain';
    case 'adpkd': return p.mayo === '1C' ? 'considerRisk' : 'indicated';
    case 'glomerularHaemo':
      if (p.nsaid && p.acei && p.diuretic) return 'tripleWhammy';
      return st.gfr < 0.75 * st.gfr0 ? 'stopCulprit' : 'ok';
    case 'pillars': return p.disease;
    case 'hyperkalemia': return st.pk > 6.5 ? 'emergency' : p.binder === 'none' ? 'shiftOnly' : 'binder';
    case 'acidosis': return p.patient;
    case 'repletion': return p.deficit === 'magnesium' ? 'mgFirst' : 'phosphate';
    case 'urate':
      if (p.drug === 'allopurinol' && p.hlaB5801) return 'hla';
      if (p.drug === 'probenecid' && p.egfr < 50) return 'probenecidGfr';
      return 'treatToTarget';
    case 'tumourLysis': return p.drug === 'rasburicase' && p.g6pd ? 'g6pd' : p.drug;
    case 'stonePrevention':
      if (p.drug === 'loopDiuretic') return 'wrong';
      return STONE_MATCH[p.profile].includes(p.drug) ? 'matched' : 'mismatch';
    default: return null;
  }
}
export { activePillars };

/** Parameters/series that are simulator tuning choices or proxies ("Modelo" / "Model" tag in the UI). */
export const MODEL_TAGS = {
  osmotic: ['icp'], carbonicAnhydrase: ['uPH'], sglt2: ['pgc'], loop: [], thiazide: [], enac: [], mra: [], vaptan: [],
  raas: [], desmopressin: [], terlipressin: ['response'], ckdMbd: [], xlh: ['rickets'], anemia: [], adpkd: [],
  glomerularHaemo: ['pgc'], pillars: [], hyperkalemia: ['ecgRisk'], acidosis: [], repletion: [], urate: ['flare'],
  tumourLysis: [], stonePrevention: ['rss'],
};
export const isModelTagged = (id, key) => (MODEL_TAGS[id] || []).includes(key);
