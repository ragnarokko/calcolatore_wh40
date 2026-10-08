#!/usr/bin/env node
// Genera info_11e.csv e Datasheets_wargear_11e.csv a partire dalla repo BSData/wh40k-11e
// (cataloghi BattleScribe in JSON). Nessuna dipendenza: serve solo Node 18+.
//
//   node tools/bsdata-to-csv.mjs                 # scrive i due file _11e nella radice del repo
//   node tools/bsdata-to-csv.mjs --refresh       # riscarica i JSON invece di usare bsdata/cache/
//   node tools/bsdata-to-csv.mjs --out cartella  # scrive altrove (per un confronto)
//   node tools/bsdata-to-csv.mjs --refresh --repo https://github.com/utente/repo
//                                                # usa un'altra repo e la ricorda (vedi sotto)
//
// I file prodotti hanno lo stesso formato degli originali (separatore `|`, stesse colonne);
// info.csv e Datasheets_wargear.csv NON vengono toccati. Le dimensioni delle basette non esistono
// in BSData: vengono riprese da info.csv / info_11e.csv (per modello, poi solo per nome). Anche i
// `datasheet_id` già in uso restano gli stessi (tools/bsdata-ids.json li fissa: da committare);
// per le unità nuove l'id è un numero >= 100000 derivato dall'id BSData.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const ricarica = args.includes('--refresh');

// Repo GitHub da cui scaricare i cataloghi. Si cambia con `--repo <indirizzo>` (es. se BSData la
// sposta): l'indirizzo viene ricordato in tools/bsdata-sorgente.json (da committare), così le
// esecuzioni successive non hanno bisogno di ripeterlo. Il Tavolo da Gioco mostra il comando già
// pronto (⚙ Impostazioni). Accetta https://github.com/utente/repo, anche con /tree/ramo, o utente/repo.
const FILE_SORGENTE = path.join(RADICE, 'tools', 'bsdata-sorgente.json');
const SORGENTE_PREDEFINITA = { repo: 'BSData/wh40k-11e', branch: null };

function analizzaRepo(testo) {
  const m = String(testo)
    .trim()
    .match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#]+?))?\/?$/);
  if (!m) throw new Error(`Indirizzo GitHub non valido: ${testo}`);
  return { repo: `${m[1]}/${m[2]}`, branch: m[3] || null };
}

const iRepo = args.indexOf('--repo');
let sorgente;
if (iRepo >= 0) {
  if (!args[iRepo + 1]) throw new Error('--repo richiede un indirizzo');
  sorgente = analizzaRepo(args[iRepo + 1]);
} else if (fs.existsSync(FILE_SORGENTE)) {
  sorgente = JSON.parse(fs.readFileSync(FILE_SORGENTE, 'utf8'));
} else {
  sorgente = SORGENTE_PREDEFINITA;
}
const REPO = sorgente.repo;
let BRANCH = sorgente.branch; // se null si usa il ramo predefinito della repo
console.log(`Sorgente dati: https://github.com/${REPO}`);
const iOut = args.indexOf('--out');
const cartellaOut = path.resolve(RADICE, iOut >= 0 ? args[iOut + 1] : '.');
const cartellaCache = path.join(RADICE, 'bsdata', 'cache', REPO.replace('/', '__'));
// File nuovi, accanto agli originali (info.csv e Datasheets_wargear.csv, che questo script non
// tocca mai): se il set BSData non funziona basta puntare le app di nuovo agli originali.
const nomeInfo = 'info_11e.csv';
const nomeArmi = 'Datasheets_wargear_11e.csv';

// Catalogo → nome fazione nel sito. Tutto ciò che non è qui sotto prende il nome del file senza
// il prefisso "Imperium - ", "Chaos - ", ... (es. "Imperium - Grey Knights" → "Grey Knights").
const FAZIONE_DA_CATALOGO = {
  'Aeldari - Craftworlds': 'Aeldari',
  'Imperium - Agents of the Imperium': 'Imperial Agents',
  // I capitoli hanno solo le unità proprie e usano il resto dei Space Marines: nel sito (come
  // già oggi) stanno tutti sotto un'unica fazione.
  'Imperium - Black Templars': 'Space Marines',
  'Imperium - Blood Angels': 'Space Marines',
  'Imperium - Dark Angels': 'Space Marines',
  'Imperium - Deathwatch': 'Space Marines',
  'Imperium - Imperial Fists': 'Space Marines',
  'Imperium - Iron Hands': 'Space Marines',
  'Imperium - Raven Guard': 'Space Marines',
  'Imperium - Salamanders': 'Space Marines',
  'Imperium - Space Wolves': 'Space Marines',
  'Imperium - Ultramarines': 'Space Marines',
  'Imperium - White Scars': 'Space Marines',
};
// Libreria propria di una fazione: le sue schede sono le entryLink/voci radice della libreria, non
// del catalogo (che elenca solo ciò che prende in prestito da altre fazioni). Le altre librerie
// importate (Titans, Agents, Knights alleati, ...) NON si aggiungono: sono alleati, non la fazione.
const LIBRERIA_PROPRIA = {
  'Imperium - Imperial Knights': 'Imperium - Imperial Knights - Library',
  'Chaos - Chaos Daemons': 'Chaos - Chaos Daemons Library',
  'Chaos - Chaos Knights': 'Chaos - Chaos Knights Library',
};
// Cataloghi che non sono eserciti giocabili (regole di base).
const CATALOGHI_ESCLUSI = new Set(['Warhammer 40,000']);

// ---------------------------------------------------------------- download

async function elencoFile() {
  const intestazioni = { 'User-Agent': 'bsdata-to-csv' };
  if (!BRANCH) {
    const rr = await fetch(`https://api.github.com/repos/${REPO}`, { headers: intestazioni });
    if (!rr.ok) throw new Error(`Repo ${REPO} non raggiungibile (HTTP ${rr.status}): controlla l'indirizzo`);
    BRANCH = (await rr.json()).default_branch;
  }
  const r = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}`, { headers: intestazioni });
  if (!r.ok) throw new Error(`Elenco file di ${REPO} non leggibile (HTTP ${r.status})`);
  const albero = await r.json();
  return albero.tree.filter((e) => e.type === 'blob' && e.path.endsWith('.json')).map((e) => e.path);
}

async function leggiCatalogo(nomeFile) {
  const locale = path.join(cartellaCache, nomeFile);
  if (!ricarica && fs.existsSync(locale)) return JSON.parse(fs.readFileSync(locale, 'utf8'));
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${encodeURIComponent(nomeFile)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${nomeFile}: HTTP ${r.status}`);
  const testo = await r.text();
  fs.mkdirSync(cartellaCache, { recursive: true });
  fs.writeFileSync(locale, testo);
  return JSON.parse(testo);
}

// ---------------------------------------------------------------- indice dei nodi

const indice = new Map(); // id → { nodo, file }
function indicizza(o, file) {
  if (Array.isArray(o)) return o.forEach((v) => indicizza(v, file));
  if (!o || typeof o !== 'object') return;
  if (o.id && o.name && !indice.has(o.id)) indice.set(o.id, { nodo: o, file });
  for (const v of Object.values(o)) indicizza(v, file);
}

const caratteristiche = (profilo) =>
  Object.fromEntries((profilo.characteristics || []).map((c) => [c.name, (c.$text ?? '').toString().trim()]));

// Gruppi di opzioni che non sono equipaggiamento di base della scheda: potenziamenti, reliquie,
// regole Crusade/modalità di gioco speciali. "Weapons" è il catalogo di tutte le armi che le schede
// "personaggio su misura" (Crucible, Hordeboss, Magos, Commander, ...) possono scegliere: non sono armi loro. Le armi che contengono non vanno nella scheda.
const GRUPPI_ESCLUSI =
  /enhancement|crusade|battle (trait|scar|honou?r)|honou?rs|relic|boons?\b|mark of chaos|commendations|inner circle|angels ascendant|chapter command|deeds of making|mighty champions|warband champion|ascendant lord|aeldari paths|specialisms|strains|archeotech|bossloot|weapon modifications|detachment|order of battle|warlord|blackstone|armageddon|tyrannic|pariah|boarding|breaching|dark age|legends of saga|headhunter|upgrades$|^weapons$/i;

// Raccoglie, scendendo nell'albero di una scheda, i profili "Unit" (uno per tipo di modello) e
// quelli delle armi. Non entra nelle altre schede (entryLink verso una unit: capi attaccabili,
// trasporti, ...). `visitati` serve sia a evitare cicli sia a sapere quali modelli stanno già
// dentro una scheda (per non contarli anche come schede a sé).
function raccogli(nodo, ris, visitati, profondita = 0) {
  if (!nodo || visitati.has(nodo.id) || profondita > 14) return;
  if (!nodo.type && GRUPPI_ESCLUSI.test(nodo.name)) return;
  visitati.add(nodo.id);
  const aggiungi = (p) => {
    if (!p || p.typeName === undefined) return;
    if (p.typeName === 'Unit') ris.modelli.push(p);
    else if (/Weapons$/.test(p.typeName)) ris.armi.push(p);
  };
  for (const p of nodo.profiles || []) aggiungi(p);
  // Feel No Pain proprio della scheda: un collegamento alla regola "Feel No Pain" con un modificatore che
  // ne aggiunge la soglia al nome ("5+"), oppure già "Feel No Pain 5+". Quelli con commento o che
  // nascondono la regola sono concessioni condizionate (capi che si uniscono, potenziamenti).
  for (const r of [...(nodo.rules || []), ...(nodo.infoLinks || []).filter((l) => l.type === 'rule')]) {
    if (!/^Feel No Pain/.test(r.name ?? '') || r.comment) continue;
    const modificatori = r.modifiers || [];
    if (modificatori.some((m) => m.field === 'hidden')) continue;
    const testo = [r.name, ...modificatori.filter((m) => m.field === 'name' && m.type === 'append').map((m) => m.value)].join(' ');
    const m = /Feel No Pain\s+(\d)\+/.exec(testo);
    if (m) ris.fnp.push(Number(m[1]));
  }
  for (const l of nodo.infoLinks || []) {
    if (l.type === 'profile') aggiungi(indice.get(l.targetId)?.nodo);
  }
  for (const f of nodo.selectionEntries || []) raccogli(f, ris, visitati, profondita + 1);
  for (const g of nodo.selectionEntryGroups || []) raccogli(g, ris, visitati, profondita + 1);
  for (const l of nodo.entryLinks || []) {
    const t = indice.get(l.targetId)?.nodo;
    if (t && t.type !== 'unit') raccogli(t, ris, visitati, profondita + 1);
  }
}

// ---------------------------------------------------------------- normalizzazioni

const chiave = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Chiave "morbida" per riconoscere lo stesso modello tra i due file, che non concordano su
// singolare/plurale né su suffissi come [Legends] (es. "Crisis Battlesuits" ↔ "Crisis Battlesuit").
const chiaveMorbida = (s) =>
  chiave((s || '').replace(/armor/gi, 'armour').replace(/\[[^\]]*\]/g, '').replace(/\b(squad|team|unit)\b/gi, ''))
    .replace(/ies$/, 'y')
    .replace(/(es|s)$/, '');
// Apostrofi tipografici come nei CSV attuali (T’au Empire).
const tipografico = (s) => s.replace(/'/g, '’');

function campo(v) {
  const t = String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();
  return t.includes('"') ? `"${t.replace(/"/g, '""')}"` : t;
}
const riga = (valori) => valori.map(campo).join('|');

const senzaPiu = (v) => (v === '' || v === '-' || v === 'N/A' ? '-' : v.replace(/\+/g, ''));
const portata = (v) => (/^Melee$/i.test(v) ? 'Melee' : v.replace(/"$/, ''));

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// ---------------------------------------------------------------- dati attuali (id, basi, codici)

function leggiCsvEsistente() {
  const risultato = {
    perFazioneNome: new Map(), perFazioneMorbida: new Map(), perNome: new Map(), perNomeMorbido: new Map(),
    fac: new Map(), idUsati: new Set(), perId: new Map(),
  };
  // L'originale (info.csv) serve a migrare id e basette la prima volta; il file già generato, letto
  // per ultimo, ha la precedenza (così le basette corrette a mano in info_11e.csv restano).
  const righe = [path.join(RADICE, 'info.csv'), path.join(cartellaOut, nomeInfo)]
    .filter((f, i, a) => fs.existsSync(f) && a.indexOf(f) === i)
    .flatMap((f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).slice(1));
  for (const r of righe) {
    const v = [];
    let corrente = '', tra = false;
    for (let i = 0; i < r.length; i++) {
      const c = r[i];
      if (c === '"') { if (tra && r[i + 1] === '"') { corrente += '"'; i++; } else tra = !tra; }
      else if (c === '|' && !tra) { v.push(corrente); corrente = ''; }
      else corrente += c;
    }
    v.push(corrente);
    const [id, linea, nome, , , , , , , , , base, fac, fazione] = v;
    const voce = { id, linea, nome, base, fac, fazione };
    risultato.idUsati.add(id);
    if (!risultato.perId.has(id)) risultato.perId.set(id, []);
    risultato.perId.get(id).unshift(voce);
    risultato.perFazioneNome.set(`${chiave(fazione)}|${chiave(nome)}`, voce);
    const preferisci = (mappa, k) => {
      if (!mappa.has(k) || (!mappa.get(k).base && base)) mappa.set(k, voce);
    };
    preferisci(risultato.perNome, chiave(nome));
    preferisci(risultato.perNomeMorbido, chiaveMorbida(nome));
    if (!risultato.perFazioneMorbida.has(`${chiave(fazione)}|${chiaveMorbida(nome)}`)) {
      risultato.perFazioneMorbida.set(`${chiave(fazione)}|${chiaveMorbida(nome)}`, voce);
    }
    if (fazione && fac) risultato.fac.set(chiave(fazione), { fac, fazione });
  }
  return risultato;
}

// ---------------------------------------------------------------- principale

const nomiFile = await elencoFile();
// L'indirizzo si ricorda solo dopo che la repo ha risposto, così un errore di battitura non lo rovina.
if (iRepo >= 0) {
  fs.writeFileSync(FILE_SORGENTE, JSON.stringify({ repo: REPO, branch: sorgente.branch }, null, 1) + '\n');
  console.log('Sorgente salvata in tools/bsdata-sorgente.json (da committare)');
}
const cataloghi = [];
for (const nomeFile of nomiFile) {
  const json = await leggiCatalogo(nomeFile);
  const radice = json.catalogue || json.gameSystem;
  indicizza(radice, nomeFile);
  cataloghi.push({ nomeFile, nome: nomeFile.replace(/\.json$/, ''), radice });
}
console.log(`Letti ${cataloghi.length} file, ${indice.size} nodi.`);

const esistenti = leggiCsvEsistente();
const nomeFazione = (nomeCatalogo) =>
  FAZIONE_DA_CATALOGO[nomeCatalogo] || nomeCatalogo.replace(/^(Imperium|Chaos|Aeldari|Library) - /, '');

// 1. Schede per fazione: i bersagli (unit/model) degli entryLink del catalogo, più le voci
//    definite direttamente nel catalogo (i cataloghi "library" non sono fazioni).
const schede = []; // { fazione, nodo }
const visti = new Set();
for (const { nome, radice } of cataloghi) {
  if (radice.library || CATALOGHI_ESCLUSI.has(nome)) continue;
  const fazione = nomeFazione(nome);
  const sorgenti = [radice];
  const propria = cataloghi.find((c) => c.nome === LIBRERIA_PROPRIA[nome]);
  if (propria) sorgenti.push(propria.radice);
  const candidati = sorgenti.flatMap((r) => [
    ...(r.sharedSelectionEntries || []),
    ...(r.selectionEntries || []),
    ...(r.entryLinks || []).map((l) => indice.get(l.targetId)?.nodo),
  ]);
  for (const n of candidati) {
    if (!n || (n.type !== 'unit' && n.type !== 'model')) continue;
    const k = `${fazione}|${n.id}`;
    if (visti.has(k)) continue;
    visti.add(k);
    schede.push({ fazione, nodo: n });
  }
}

// 2. Estrae modelli e armi di ogni scheda; i "model" già contenuti in una unit della stessa
//    fazione non sono schede a sé.
const estratte = schede.map((s) => {
  const ris = { modelli: [], armi: [], fnp: [] };
  const visitati = new Set();
  raccogli(s.nodo, ris, visitati);
  return { ...s, ...ris, visitati };
});
const dentroUnit = new Map(); // fazione → id dei nodi contenuti in una unit
for (const e of estratte) {
  if (e.nodo.type !== 'unit') continue;
  if (!dentroUnit.has(e.fazione)) dentroUnit.set(e.fazione, new Set());
  for (const id of e.visitati) if (id !== e.nodo.id) dentroUnit.get(e.fazione).add(id);
}
const finali = estratte.filter(
  (e) => e.modelli.length > 0 && !(e.nodo.type === 'model' && dentroUnit.get(e.fazione)?.has(e.nodo.id)),
);
const scartate = estratte.length - finali.length;

// 3. CSV
const intestazioneInfo = 'datasheet_id|line|name|MOV|RES|TS|TS+|Note|W|Ld|OC|base_size|fac|faction|FNP';
const intestazioneArmi =
  'datasheet_id|name|line|line_in_wargear|dice|name|description|range|type|A|BS_WS|S|AP|D';
const righeInfo = [];
const righeArmi = [];
const idAssegnati = new Set();
const senzaBase = [];
const codiciNuovi = new Set();

finali.sort(
  (a, b) =>
    a.fazione.localeCompare(b.fazione) || a.nodo.name.localeCompare(b.nodo.name) || a.nodo.id.localeCompare(b.nodo.id),
);

// Corrispondenza stabile scheda BSData → datasheet_id, salvata in tools/bsdata-ids.json (da
// committare): senza, schede con lo stesso nome (es. due "Custodian Guard") scambierebbero gli id
// a ogni rigenerazione. La prima volta gli id si ricavano dal info.csv esistente per nome.
const fileIds = path.join(RADICE, 'tools', 'bsdata-ids.json');
const idsSalvati = fs.existsSync(fileIds) ? JSON.parse(fs.readFileSync(fileIds, 'utf8')) : {};
const chiaveScheda = (s) => `${chiave(s.fazione)}|${s.nodo.id}`;
for (const s of finali) if (idsSalvati[chiaveScheda(s)]) idAssegnati.add(idsSalvati[chiaveScheda(s)]);

for (const s of finali) {
  // Un profilo per tipo di modello: BSData ripete lo stesso profilo (stesso nome e stesse
  // caratteristiche) per ogni variante di equipaggiamento, qui conta una volta sola.
  const modelli = [];
  const giaVisti = new Set();
  for (const p of s.modelli) {
    const k = [p.name, ...Object.values(caratteristiche(p))].join('~');
    if (giaVisti.has(k)) continue;
    giaVisti.add(k);
    modelli.push(p);
  }
  const fKey = chiave(s.fazione);
  const vecchioFaz = (nome) =>
    esistenti.perFazioneNome.get(`${fKey}|${chiave(nome)}`) ||
    esistenti.perFazioneMorbida.get(`${fKey}|${chiaveMorbida(nome)}`);
  const vecchioQualsiasi = (nome) =>
    vecchioFaz(nome) || esistenti.perNome.get(chiave(nome)) || esistenti.perNomeMorbido.get(chiaveMorbida(nome));

  // id: quello già in uso se un modello della scheda esiste già in questa fazione e l'id è libero.
  // Si prova con i nomi dei modelli e poi con quello della scheda (nel file attuale i nomi sono
  // spesso quelli dell'unità).
  let id = idsSalvati[chiaveScheda(s)] || null;
  for (const nome of id ? [] : [...modelli.map((p) => p.name), s.nodo.name]) {
    const v = vecchioFaz(nome);
    if (v && !idAssegnati.has(v.id)) { id = v.id; break; }
  }
  if (!id) {
    let n = 100000 + (hash(`${s.fazione}|${s.nodo.id}`) % 900000);
    while (idAssegnati.has(String(n)) || esistenti.idUsati.has(String(n))) n++;
    id = String(n);
  }
  idAssegnati.add(id);
  idsSalvati[chiaveScheda(s)] = id;

  const infoFazione = esistenti.fac.get(fKey);
  const fazioneOut = infoFazione?.fazione ?? tipografico(s.fazione);
  let fac = infoFazione?.fac;
  if (!fac) {
    fac = s.fazione.split(/\s+/).map((p) => p[0]).join('').toUpperCase();
    codiciNuovi.add(`${fazioneOut} → ${fac}`);
  }

  // Soglia migliore (la più bassa) tra quelle trovate nella scheda; vale per tutti i suoi modelli.
  const fnp = s.fnp.length ? `${Math.min(...s.fnp)}+` : '';
  modelli.forEach((p, i) => {
    const c = caratteristiche(p);
    // Prima le righe della stessa scheda nel file attuale (così le basi corrette a mano restano),
    // poi i modelli omonimi della fazione e infine quelli di qualunque fazione.
    const stessaScheda = (esistenti.perId.get(id) || []).find(
      (r) => chiave(r.nome) === chiave(p.name) || chiaveMorbida(r.nome) === chiaveMorbida(p.name),
    );
    const v =
      (stessaScheda?.base ? stessaScheda : null) ||
      vecchioFaz(p.name) || (i === 0 && vecchioFaz(s.nodo.name)) || vecchioQualsiasi(p.name) ||
      (i === 0 && vecchioQualsiasi(s.nodo.name));
    const base = v?.base ?? '';
    if (!base) senzaBase.push(`${fazioneOut}: ${p.name}`);
    // Salvezza invulnerabile condizionata (es. "4+* / 6", "5+ (Ranged)"): il testo originale va in Note.
    const nota = /[*(/]/.test(c.InSv ?? '') ? `Invulnerabile: ${c.InSv}` : '';
    righeInfo.push(
      riga([id, i + 1, p.name, c.M, c.T, c.Sv, senzaPiu(c.InSv ?? ''), nota, c.W, c.LD, c.OC, base, fac, fazioneOut, fnp]),
    );
  });

  // Armi: unione di quelle di tutta la scheda, senza doppioni, a raggio prima delle mischia e in
  // ordine alfabetico come nel file attuale.
  const armi = new Map();
  for (const a of s.armi) {
    const c = caratteristiche(a);
    const tipo = a.typeName.startsWith('Ranged') ? 'Ranged' : 'Melee';
    const k = [tipo, a.name, c.Range, c.A, c.BS ?? c.WS, c.S, c.AP, c.D, c.Keywords].join('~');
    if (!armi.has(k)) armi.set(k, { nome: a.name.replace(/^➤\s*/, ''), tipo, c });
  }
  const ordinate = [...armi.values()].sort(
    (x, y) => (x.tipo === y.tipo ? 0 : x.tipo === 'Ranged' ? -1 : 1) || x.nome.localeCompare(y.nome),
  );
  const nelGruppo = new Map();
  ordinate.forEach((a, i) => {
    const prefisso = a.nome.includes(' - ') ? a.nome.split(' - ')[0] : a.nome;
    const n = (nelGruppo.get(prefisso) || 0) + 1;
    nelGruppo.set(prefisso, n);
    righeArmi.push(
      riga([
        id, modelli[0].name, i + 1, n, '', a.nome, a.c.Keywords ?? '', portata(a.c.Range ?? ''), a.tipo,
        a.c.A, senzaPiu(a.c.BS ?? a.c.WS ?? ''), a.c.S, a.c.AP, a.c.D,
      ]),
    );
  });
}

fs.mkdirSync(cartellaOut, { recursive: true });
fs.writeFileSync(path.join(cartellaOut, nomeInfo), '﻿' + [intestazioneInfo, ...righeInfo].join('\r\n') + '\r\n');
fs.writeFileSync(path.join(cartellaOut, nomeArmi), '﻿' + [intestazioneArmi, ...righeArmi].join('\r\n') + '\r\n');

fs.writeFileSync(
  fileIds,
  JSON.stringify(Object.fromEntries(Object.entries(idsSalvati).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n',
);

console.log(`Schede: ${finali.length} (scartate ${scartate} modelli già contenuti in una unit o senza profilo)`);
console.log(`${nomeInfo}: ${righeInfo.length} righe; ${nomeArmi}: ${righeArmi.length} righe → ${cartellaOut}`);
console.log(`Modelli senza dimensione basetta: ${senzaBase.length}`);
if (codiciNuovi.size) console.log(`Codici fazione nuovi (da controllare): ${[...codiciNuovi].join(', ')}`);
