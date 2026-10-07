#!/usr/bin/env node
// Confronta i CSV attuali del sito con quelli generati da bsdata-to-csv.mjs e scrive un
// rapporto Markdown. Uso: node tools/confronta-csv.mjs [cartella-con-i-file-bsdata]
//   (default: radice del repo; legge info_11e.csv e Datasheets_wargear_11e.csv)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cartella = path.resolve(RADICE, process.argv[2] || '.');

const chiave = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function leggi(file) {
  const righe = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  return righe.slice(1).map((r) => {
    const v = [];
    let c = '', tra = false;
    for (let i = 0; i < r.length; i++) {
      const ch = r[i];
      if (ch === '"') { if (tra && r[i + 1] === '"') { c += '"'; i++; } else tra = !tra; }
      else if (ch === '|' && !tra) { v.push(c); c = ''; }
      else c += ch;
    }
    v.push(c);
    return v;
  });
}

const COL_INFO = ['id', 'line', 'name', 'MOV', 'RES', 'TS', 'TS+', 'Note', 'W', 'Ld', 'OC', 'base', 'fac', 'faction'];
const vecchieInfo = leggi(path.join(RADICE, 'info.csv')).map((v) => Object.fromEntries(COL_INFO.map((c, i) => [c, v[i] ?? ''])));
const nuoveInfo = leggi(path.join(cartella, 'info_11e.csv')).map((v) => Object.fromEntries(COL_INFO.map((c, i) => [c, v[i] ?? ''])));
const COL_ARMI = ['id', 'unita', 'line', 'lineW', 'dice', 'arma', 'desc', 'range', 'tipo', 'A', 'BS', 'S', 'AP', 'D'];
const leggiArmi = (f) => leggi(f).map((v) => Object.fromEntries(COL_ARMI.map((c, i) => [c, v[i] ?? ''])));
const vecchieArmi = leggiArmi(path.join(RADICE, 'Datasheets_wargear.csv'));
const nuoveArmi = leggiArmi(path.join(cartella, 'Datasheets_wargear_11e.csv'));

const out = [];
const p = (s = '') => out.push(s);
const elenco = (arr, max = 40) => {
  arr.slice(0, max).forEach((x) => p(`- ${x}`));
  if (arr.length > max) p(`- … e altri ${arr.length - max}`);
};

// ---- 1. Numeri per fazione
const perFazione = (righe) => {
  const m = new Map();
  for (const r of righe) {
    const e = m.get(r.faction) || { schede: new Set(), righe: 0 };
    e.schede.add(r.id);
    e.righe++;
    m.set(r.faction, e);
  }
  return m;
};
const fv = perFazione(vecchieInfo), fn = perFazione(nuoveInfo);
p('# Confronto info.csv / Datasheets_wargear.csv: sito attuale vs BSData 11e');
p();
p(`Righe modello: **${vecchieInfo.length}** attuali, **${nuoveInfo.length}** BSData. Righe arma: **${vecchieArmi.length}** attuali, **${nuoveArmi.length}** BSData.`);
p();
p('## Per fazione (schede / righe modello)');
p();
p('| Fazione | Attuale | BSData |');
p('|---|---|---|');
for (const f of [...new Set([...fv.keys(), ...fn.keys()])].sort()) {
  const a = fv.get(f), b = fn.get(f);
  p(`| ${f} | ${a ? `${a.schede.size} / ${a.righe}` : '—'} | ${b ? `${b.schede.size} / ${b.righe}` : '—'} |`);
}

// ---- 2. Schede (stesso datasheet_id) presenti solo da una parte
const chiaveMorbida = (s) =>
  chiave((s || '').replace(/armor/gi, 'armour').replace(/\[[^\]]*\]/g, '').replace(/\b(squad|team|unit)\b/gi, ''))
    .replace(/ies$/, 'y')
    .replace(/(es|s)$/, '');
const raggruppa = (righe) => {
  const m = new Map();
  for (const r of righe) {
    if (!m.has(r.id)) m.set(r.id, []);
    m.get(r.id).push(r);
  }
  return m;
};
const sv = raggruppa(vecchieInfo), sn = raggruppa(nuoveInfo);
const etichetta = (righe) => `${righe[0].faction}: ${righe.map((r) => r.name).join(' + ')}`;
const soloVecchi = [...sv].filter(([id]) => !sn.has(id)).map(([, r]) => etichetta(r));
const soloNuovi = [...sn].filter(([id]) => !sv.has(id)).map(([, r]) => etichetta(r));
p();
p(`## Schede solo nel sito attuale (${soloVecchi.length}) — non hanno un corrispondente in BSData`);
p();
elenco(soloVecchi, 500);
p();
p(`## Schede solo in BSData (${soloNuovi.length}) — sarebbero nuove (id >= 100000)`);
p();
elenco(soloNuovi, 500);

// ---- 3. Statistiche dei modelli delle schede in comune
const campi = [['MOV', 'MOV'], ['RES', 'RES (T)'], ['TS', 'TS (Sv)'], ['TS+', 'TS+ (InSv)'], ['W', 'W'], ['Ld', 'Ld'], ['OC', 'OC'], ['base', 'base_size']];
const diffStat = new Map(campi.map(([c]) => [c, []]));
const modelliSoloVecchi = [], modelliSoloNuovi = [];
let comuni = 0;
for (const [id, vecchie] of sv) {
  const nuove = sn.get(id);
  if (!nuove) continue;
  const usate = new Set();
  for (const a of vecchie) {
    const b = nuove.find((x) => !usate.has(x) && chiaveMorbida(x.name) === chiaveMorbida(a.name));
    if (!b) { modelliSoloVecchi.push(`${a.faction}: ${a.name} (scheda «${nuove[0].name}»)`); continue; }
    usate.add(b);
    comuni++;
    for (const [c] of campi) {
      if (a[c] !== b[c]) diffStat.get(c).push(`${a.faction}: ${a.name}: «${a[c]}» → «${b[c]}»`);
    }
  }
  for (const b of nuove) if (!usate.has(b)) modelliSoloNuovi.push(`${b.faction}: ${b.name} (scheda «${vecchie[0].name}»)`);
}
p();
p(`## Modelli, dentro schede in comune, presenti da una parte sola`);
p();
p(`Solo nel sito attuale: **${modelliSoloVecchi.length}**`);
p();
elenco(modelliSoloVecchi, 200);
p();
p(`Solo in BSData: **${modelliSoloNuovi.length}**`);
p();
elenco(modelliSoloNuovi, 200);
p();
p(`## Statistiche dei ${comuni} modelli abbinati`);
p();
p('| Campo | Modelli con valore diverso |');
p('|---|---|');
for (const [c, etichettaCampo] of campi) p(`| ${etichettaCampo} | ${diffStat.get(c).length} |`);
for (const [c, etichettaCampo] of campi) {
  if (c === 'base') continue;
  const d = diffStat.get(c);
  if (!d.length) continue;
  p();
  p(`### Differenze in ${etichettaCampo}`);
  p();
  elenco(d, 60);
}

// ---- 4. Armi: confronto per scheda collegata dallo stesso id
const idComune = new Set(vecchieInfo.map((r) => r.id).filter((id) => nuoveInfo.some((n) => n.id === id)));
const perId = raggruppa;
const av = perId(vecchieArmi), an = perId(nuoveArmi);
const nomeScheda = new Map(vecchieInfo.map((r) => [r.id, `${r.faction}: ${r.name}`]));
const chiaveArma = (n) => chiave(n.replace(/\([^)]*\)/g, ''));
const val = (x) => (x || '').toLowerCase().replace(/^n\/a$/, '-');
const norm = (r) => [r.tipo, r.range, r.A, r.BS, r.S, r.AP, r.D].map(val).join(' ');
const campiArma = [['range', 'portata'], ['A', 'attacchi'], ['BS', 'BS/WS'], ['S', 'forza'], ['AP', 'AP'], ['D', 'danni']];
const perCampoArma = Object.fromEntries(campiArma.map(([c]) => [c, 0]));
let schedeStessaArmi = 0;
const armiMancanti = [], armiNuove = [], armiDiverse = [], kwDiverse = [];
for (const id of idComune) {
  const x = new Map((av.get(id) || []).map((r) => [chiaveArma(r.arma), r]));
  const y = new Map((an.get(id) || []).map((r) => [chiaveArma(r.arma), r]));
  let uguale = true;
  for (const [n, r] of x) {
    const s = y.get(n);
    if (!s) { armiMancanti.push(`${nomeScheda.get(id)} — ${r.arma}`); uguale = false; }
    else {
      for (const [c] of campiArma) if (val(r[c]) !== val(s[c])) perCampoArma[c]++;
      if (norm(r) !== norm(s)) { armiDiverse.push(`${nomeScheda.get(id)} — ${r.arma}: «${norm(r)}» → «${norm(s)}»`); uguale = false; }
      else if (r.desc.toLowerCase() !== s.desc.toLowerCase()) kwDiverse.push(`${nomeScheda.get(id)} — ${r.arma}: «${r.desc}» → «${s.desc}»`);
    }
  }
  for (const [n, r] of y) if (!x.has(n)) { armiNuove.push(`${nomeScheda.get(id)} — ${r.arma}`); uguale = false; }
  if (uguale) schedeStessaArmi++;
}
p();
p(`## Armi (schede in comune, stesso id: ${idComune.size})`);
p();
p(`- Schede con armi identiche (nome + A/BS/S/AP/D/portata): **${schedeStessaArmi}**`);
p(`- Armi nel sito attuale ma non in BSData: **${armiMancanti.length}**`);
p(`- Armi solo in BSData: **${armiNuove.length}**`);
p(`- Armi con valori diversi: **${armiDiverse.length}**`);
p(`  - di cui, per campo: ${campiArma.map(([c, n]) => `${n} ${perCampoArma[c]}`).join(' · ')}`);
p(`- Armi con le sole parole chiave diverse (ignorando maiuscole): **${kwDiverse.length}**`);
const sezioni = [
  ['Armi con valori diversi', armiDiverse],
  ['Armi nel sito attuale ma non in BSData', armiMancanti],
  ['Armi solo in BSData', armiNuove],
  ['Armi con parole chiave diverse', kwDiverse],
];
for (const [titolo, lista] of sezioni) {
  p();
  p(`### ${titolo}`);
  p();
  elenco(lista, 40);
}

// ---- 5. Controlli di coerenza sul file nuovo
const senzaArmi = [...new Set(nuoveInfo.map((r) => r.id))].filter((id) => !an.has(id));
const senzaBase = nuoveInfo.filter((r) => !r.base);
const baseVecchieVuote = vecchieInfo.filter((r) => !r.base).length;
p();
p('## Controlli sul file nuovo');
p();
p(`- Schede senza nessuna arma: **${senzaArmi.length}**`);
elenco(senzaArmi.map((id) => nuoveInfo.find((r) => r.id === id)).map((r) => `${r.faction}: ${r.name}`), 40);
p(`- Righe senza dimensione basetta: **${senzaBase.length}** (nel file attuale: ${baseVecchieVuote}; segnaposto 100×50 mm nell'app)`);
const valori = (col) => [...new Set(nuoveInfo.map((r) => r[col]))].sort();
p(`- Valori distinti: TS ${valori('TS').join(' ')} · TS+ ${valori('TS+').join(' ')} · Ld ${valori('Ld').join(' ')}`);

fs.mkdirSync(path.join(RADICE, 'bsdata'), { recursive: true });
const file = path.join(RADICE, 'bsdata', 'confronto.md');
fs.writeFileSync(file, out.join('\n') + '\n');
console.log(`Rapporto scritto in ${file}`);
