// Hand-drawn SVG schematics: a nephron (where each drug acts) and hormone/electrolyte axes.
// Pure rendering from a plain description object produced by the model.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Where each blocked transporter sits on the nephron drawing. */
const BLOCK_SITE = {
  osm: { x: 150, y: 52, seg: 'pct' }, ca: { x: 128, y: 98, seg: 'pct' }, sglt2: { x: 182, y: 72, seg: 'pct' },
  loop: { x: 212, y: 220, seg: 'loop' }, thz: { x: 282, y: 62, seg: 'dct' },
  enac: { x: 382, y: 140, seg: 'cd' }, mr: { x: 382, y: 172, seg: 'cd' }, v2: { x: 382, y: 236, seg: 'cd' },
};
const SEG_NORMAL = { pct: 0.67, loop: 0.25, dct: 0.05, cd: 0.03 };

function pctFmt(v, lang) {
  const n = new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: v < 0.1 ? 1 : 0 }).format(v * 100);
  return lang === 'es' ? `${n} %` : `${n}%`;
}
function numFmt(v, d, lang) { return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }).format(v); }

/** Localise node text: {token} → word, decimal point → comma in Spanish. */
function nodeText(txt, T, lang) {
  let s = String(txt || '').replace(/\{(\w+)\}/g, (_, k) => T.ui.tok[k] || k);
  if (lang === 'es') s = s.replace(/(\d)\.(\d)/g, '$1,$2');
  return s;
}

function reabArrow(x, y, dx, dy, frac) {
  const w = clamp(1 + 5 * frac, 1, 7);
  const x2 = x + dx; const y2 = y + dy;
  return `<line class="reab" x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke-width="${w.toFixed(1)}" marker-end="url(#arrReab)"/>`;
}

function nephron(d, T, lang) {
  const N = T.ui.nephron;
  const seg = d.seg || SEG_NORMAL;
  const b = d.b || {};
  const grad = clamp(d.gradient ?? 1, 0, 1);
  const affW = clamp(8 / (d.aff ?? 1), 2.5, 14);
  const effW = clamp(6.5 / (d.eff ?? 1), 2, 13);
  const parts = [];
  parts.push(`<defs>
    <marker id="arrReab" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="reab-head"/></marker>
    <marker id="arrK" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="k-head"/></marker>
    <linearGradient id="medGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="med-stop" stop-opacity="${(0.04 + 0.06 * grad).toFixed(2)}"/><stop offset="1" class="med-stop" stop-opacity="${(0.06 + 0.34 * grad).toFixed(2)}"/></linearGradient>
  </defs>`);
  // regions
  parts.push(`<rect class="cortex" x="0" y="0" width="480" height="150"/><rect x="0" y="150" width="480" height="190" fill="url(#medGrad)"/>`);
  parts.push(`<text class="region" x="472" y="16" text-anchor="end">${esc(N.cortex)}</text><text class="region" x="472" y="166" text-anchor="end">${esc(N.medulla)}</text>`);
  // arterioles and glomerulus
  parts.push(`<path class="arteriole" d="M4 38 C24 40 36 50 50 60" stroke-width="${affW.toFixed(1)}"/>`);
  parts.push(`<path class="arteriole eff" d="M50 84 C36 94 24 104 4 108" stroke-width="${effW.toFixed(1)}"/>`);
  parts.push(`<text class="lab small" x="6" y="31">${esc(N.aff)}</text><text class="lab small" x="6" y="126">${esc(N.eff)}</text>`);
  if (d.focus === 'glomerulus') parts.push(`<circle class="focus-ring" cx="78" cy="72" r="44"/>`);
  parts.push(`<circle class="bowman" cx="78" cy="72" r="34"/><circle class="glom" cx="76" cy="72" r="22"/>`);
  if (d.proteinuria) {
    const n = Math.round(clamp(d.proteinuria, 0, 1) * 9);
    for (let i = 0; i < n; i++) parts.push(`<circle class="protein" cx="${(104 + i * 9).toFixed(0)}" cy="${(70 + (i % 2) * 5).toFixed(0)}" r="2.3"/>`);
  }
  if (d.pgc !== undefined) parts.push(`<text class="lab val" x="6" y="146">${esc(N.pgc)} ${numFmt(d.pgc, 0, lang)} mmHg</text>`);
  parts.push(`<text class="lab" x="78" y="13" text-anchor="middle">${esc(N.glomerulus)}</text>`);
  // tubule path
  const pct = 'M112 72 C135 40 175 40 185 62 C195 84 150 92 160 110 C166 122 176 132 176 150';
  const thin = 'M176 150 L176 292';
  const loopP = 'M176 292 C176 318 212 318 212 292 L212 120';
  const dct = 'M212 120 C212 92 240 70 262 70 C290 70 300 46 330 46 C350 46 360 40 382 40';
  const cd = 'M382 40 L382 300';
  const segCls = (k) => (b[{ pct: 'osm', loop: 'loop', dct: 'thz', cd: 'enac' }[k]] || (k === 'pct' && (b.ca || b.sglt2)) || (k === 'cd' && (b.mr || b.v2)) ? 'tubule blocked' : 'tubule');
  parts.push(`<path class="${segCls('pct')}" d="${pct}"/><path class="tubule thin" d="${thin}"/><path class="${segCls('loop')}" d="${loopP}"/><path class="${segCls('dct')}" d="${dct}"/>`);
  if (d.focus === 'collecting') parts.push(`<rect class="focus-ring" x="364" y="30" width="36" height="280" rx="18"/>`);
  parts.push(`<path class="${segCls('cd')}" d="${cd}"/>`);
  // macula densa contact
  parts.push(`<path class="md" d="M212 120 C190 126 140 120 112 100"/><circle class="md-dot" cx="212" cy="122" r="4"/><text class="lab small" x="220" y="136">${esc(N.md)}</text>`);
  // reabsorption arrows, scaled to the fraction of filtered Na⁺ each segment reclaims
  const rf = (k) => clamp(seg[k] / SEG_NORMAL[k], 0, 1.6);
  parts.push(reabArrow(168, 32, 0, -20, rf('pct')), reabArrow(146, 100, -18, 14, rf('pct') * 0.7));
  parts.push(reabArrow(220, 190, 22, 0, rf('loop')), reabArrow(220, 250, 22, 0, rf('loop')));
  parts.push(reabArrow(300, 56, 0, -22, rf('dct')));
  parts.push(reabArrow(390, 110, 24, 0, rf('cd')));
  // segment labels with % of filtered Na⁺ reabsorbed
  parts.push(`<text class="lab" x="166" y="182" text-anchor="end">${esc(N.pct)}</text><text class="lab val" x="166" y="196" text-anchor="end">${pctFmt(seg.pct, lang)}</text>`);
  parts.push(`<text class="lab" x="244" y="282">${esc(N.loop)}</text><text class="lab val" x="244" y="296">${pctFmt(seg.loop, lang)}</text>`);
  parts.push(`<text class="lab" x="262" y="96">${esc(N.dct)}</text><text class="lab val" x="262" y="110">${pctFmt(seg.dct, lang)}</text>`);
  parts.push(`<text class="lab" x="374" y="324" text-anchor="end">${esc(N.cd)}</text><text class="lab val" x="400" y="80">${pctFmt(seg.cd, lang)}</text>`);
  // aquaporins (ADH effect) on the collecting duct
  const aq = d.aqp2 ?? clamp((d.adh ?? 0.4) * (1 - (b.v2 || 0)), 0, 1);
  const nAq = Math.round(aq * 6);
  for (let i = 0; i < nAq; i++) parts.push(`<rect class="aqp" x="${375}" y="${200 + i * 14}" width="4" height="8" rx="1.5"/>`);
  // K⁺ secretion into the collecting duct
  const kw = clamp(1 + 2.2 * (d.kSec ?? 1), 1, 7);
  parts.push(`<line class="ksec" x1="430" y1="134" x2="392" y2="134" stroke-width="${kw.toFixed(1)}" marker-end="url(#arrK)"/><text class="lab small" x="434" y="138">${esc(N.kSec)}</text>`);
  // hormone meters
  const meter = (y, label, v, max) => {
    const w = clamp(v / max, 0, 1) * 58;
    return `<text class="lab small" x="414" y="${y - 4}">${esc(label)}</text><rect class="meter-bg" x="414" y="${y}" width="58" height="6" rx="3"/><rect class="meter-fg" x="414" y="${y}" width="${w.toFixed(1)}" height="6" rx="3"/>`;
  };
  parts.push(meter(196, N.aldo, d.aldo ?? 1, 3), meter(228, N.adh, d.adh ?? 0.4, 1));
  // cysts (ADPKD)
  if (d.cysts) {
    const r = 5 + 12 * clamp(d.cysts, 0, 1);
    for (const [cx, cy] of [[346, 120], [420, 270], [340, 250], [430, 92]]) parts.push(`<circle class="cyst" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}"/>`);
  }
  // blocked transporters
  for (const [k, site] of Object.entries(BLOCK_SITE)) {
    const v = b[k] || 0;
    if (v < 0.04) continue;
    const op = clamp(0.45 + v, 0.5, 1).toFixed(2);
    parts.push(`<g class="block" opacity="${op}"><circle cx="${site.x}" cy="${site.y}" r="11"/><path d="M${site.x - 5} ${site.y - 5}L${site.x + 5} ${site.y + 5}M${site.x + 5} ${site.y - 5}L${site.x - 5} ${site.y + 5}"/><text x="${site.x}" y="${site.y - 15}" text-anchor="middle">${esc(T.ui.block[k])}</text></g>`);
  }
  // urine
  parts.push(`<path class="urine" d="M372 300 L392 300 L382 318z"/>`);
  const uLines = [];
  if (d.fena !== undefined) uLines.push(`${N.fena} ${pctFmt(d.fena, lang)}`);
  if (d.uVol !== undefined) uLines.push(`${N.urine} ${numFmt(d.uVol, 1, lang)} L/d`);
  uLines.forEach((l, i) => parts.push(`<text class="lab val" x="404" y="${306 + i * 14}">${esc(l)}</text>`));
  if (d.stone && d.stone.size > 0.05) {
    const r = clamp(2 + d.stone.size * 0.9, 2, 13);
    parts.push(`<circle class="stone stone-${d.stone.type}" cx="382" cy="${(300 - r).toFixed(1)}" r="${r.toFixed(1)}"/><text class="lab small" x="364" y="${(300 - r).toFixed(1)}" text-anchor="end">${esc(T.stone[d.stone.type])}</text>`);
  }
  // drugs on board
  const drugs = d.drugs || [];
  drugs.slice(0, 4).forEach((k, i) => {
    const label = T.opt[k] || k;
    const w = 12 + label.length * 6.1;
    parts.push(`<g class="chip" transform="translate(252 ${170 + i * 22})"><rect width="${w.toFixed(0)}" height="18" rx="9"/><text x="${(w / 2).toFixed(0)}" y="12.5" text-anchor="middle">${esc(label)}</text></g>`);
  });
  return { viewBox: '0 0 480 340', body: parts.join('') };
}

function axis(d, T, lang) {
  const W = 104; const H = 44;
  const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  const parts = [`<defs><marker id="arrAx" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="edge-head"/></marker></defs>`];
  for (const [a, bId, w] of d.edges) {
    const A = byId[a]; const B = byId[bId];
    if (!A || !B) continue;
    // clip the segment to the two rectangles
    const dx = B.x - A.x; const dy = B.y - A.y;
    const clip = (sx, sy) => { const tx = dx ? (W / 2 + 4) / Math.abs(dx) : Infinity; const ty = dy ? (H / 2 + 4) / Math.abs(dy) : Infinity; const t = Math.min(tx, ty); return [sx * t, sy * t]; };
    const [cx, cy] = clip(dx, dy);
    const x1 = A.x + cx; const y1 = A.y + cy; const x2 = B.x - cx; const y2 = B.y - cy;
    const sw = clamp(1 + 5 * w, 1, 7);
    parts.push(`<line class="edge" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${sw.toFixed(1)}" marker-end="url(#arrAx)"/>`);
  }
  for (const n of d.nodes) {
    const lvl = clamp(n.level ?? 0, -1, 1);
    const cls = lvl > 0.15 ? 'hi' : lvl < -0.15 ? 'lo' : 'ok';
    const op = Math.abs(lvl).toFixed(2);
    const x = n.x - W / 2; const y = n.y - H / 2;
    parts.push(`<g class="anode ${cls}" data-node="${n.id}"><rect class="nbase" x="${x}" y="${y}" width="${W}" height="${H}" rx="10"/><rect class="ntint" x="${x}" y="${y}" width="${W}" height="${H}" rx="10" opacity="${(0.15 + 0.5 * Math.abs(lvl)) * (cls === 'ok' ? 0 : 1)}" data-level="${op}"/>`);
    parts.push(`<text class="nlab" x="${n.x}" y="${n.y - (n.text ? 3 : -4)}" text-anchor="middle">${esc(T.node[n.id])}</text>`);
    if (n.text) parts.push(`<text class="ntext" x="${n.x}" y="${n.y + 13}" text-anchor="middle">${esc(nodeText(n.text, T, lang))}</text>`);
    parts.push('</g>');
    if (n.drug) {
      const label = T.opt[n.drug] || n.drug;
      const w = Math.min(170, 14 + Math.min(24, label.length) * 6.1);
      parts.push(`<g class="chip"><rect x="${(n.x - w / 2).toFixed(0)}" y="${n.y + H / 2 + 5}" width="${w.toFixed(0)}" height="18" rx="9"/><text x="${n.x}" y="${n.y + H / 2 + 17.5}" text-anchor="middle">${esc(label.length > 24 ? label.slice(0, 23) + '…' : label)}</text></g>`);
    }
  }
  return { viewBox: '-14 18 476 290', body: parts.join('') };
}

export function renderSchematic(host, desc, T, lang, title) {
  const r = desc.kind === 'axis' ? axis(desc, T, lang) : nephron(desc, T, lang);
  host.innerHTML = `<svg class="schem ${desc.kind}" viewBox="${r.viewBox}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${r.body}</svg>`;
}
