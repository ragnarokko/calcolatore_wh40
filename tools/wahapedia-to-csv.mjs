#!/usr/bin/env node
// Aggiorna i CSV "tradizionali" (info.csv e Datasheets_wargear.csv) e i file extra per un futuro
// army builder (cartella army_builder/) a partire dall'export dati di Wahapedia.
//
//   node tools/wahapedia-to-csv.mjs                         scarica, converte e sovrascrive i file
//   node tools/wahapedia-to-csv.mjs --sorgente <indirizzo>  usa un'altra edizione/sito (es. .../wh40k12ed)
//   node tools/wahapedia-to-csv.mjs --cache                 riusa i file già scaricati (nessuna rete)
//   node tools/wahapedia-to-csv.mjs --out <cartella>        scrive altrove invece che nella radice del repo
//
// Fonte: https://wahapedia.ru/wh40k11ed/<Tabella>.csv (specifica: "Export Data Specs", tabelle separate da
// "|"). L'indirizzo scelto viene ricordato in tools/wahapedia-sorgente.json (da committare) solo dopo
// che il sito ha risposto. I download restano in wahapedia/cache/ (cartella ignorata da git).
//
// Pulizie rispetto ai file grezzi (le stesse già applicate a mano finora):
//   - info.csv: una riga per profilo di modello; MOV=M, RES=T, TS=Sv, TS+=inv_sv, Note=inv_sv_descr;
//     base_size ripulita ("flying base", "Use model", "Unique"... diventano vuote) e poi sovrascritta
//     dalle correzioni manuali di tools/wahapedia-basette.json.
//   - Datasheets_wargear.csv: dopo datasheet_id c'è il nome della scheda; BS_WS senza "+" ("3+" → "3"),
//     spazi tolti, "-0" → "0", righe senza nome arma scartate.
// Gli id sono quelli di Wahapedia senza zeri iniziali (identici a quelli già in uso).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_SORGENTE = path.join(RADICE, 'tools', 'wahapedia-sorgente.json');
const FILE_BASETTE = path.join(RADICE, 'tools', 'wahapedia-basette.json');
const SORGENTE_PREDEFINITA = 'https://wahapedia.ru/wh40k11ed';
const CARTELLA_EXTRA = 'army_builder';

const TABELLE = [
  'Last_update',
  'Factions',
  'Source',
  'Datasheets',
  'Datasheets_models',
  'Datasheets_wargear',
  'Datasheets_models_cost',
  'Datasheets_unit_composition',
  'Datasheets_options',
  'Datasheets_leader',
  'Datasheets_keywords',
  'Datasheets_abilities',
  'Abilities',
  'Detachments',
  'Enhancements',
];

// ---------------------------------------------------------------------------------------------
// Argomenti

function leggiArgomenti(argv) {
  const opzioni = { sorgente: null, cache: false, out: RADICE, aiuto: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cache') opzioni.cache = true;
    else if (a === '--sorgente') opzioni.sorgente = argv[++i];
    else if (a === '--out') opzioni.out = path.resolve(argv[++i] || '');
    else if (a === '--help' || a === '-h') opzioni.aiuto = true;
    else {
      console.error(`Opzione sconosciuta: ${a} (usa --help)`);
      process.exit(1);
    }
  }
  return opzioni;
}

function normalizzaSorgente(testo) {
  try {
    const url = new URL((testo || '').trim());
    if (url.protocol !== 'https:') return null;
    const percorso = url.pathname.replace(/\/+$/, '');
    if (!/^\/wh40k\d+ed$/i.test(percorso)) return null;
    return `${url.origin}${percorso}`;
  } catch {
    return null;
  }
}

function sorgenteSalvata() {
  try {
    return normalizzaSorgente(JSON.parse(fs.readFileSync(FILE_SORGENTE, 'utf8')).sorgente);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Download

async function scarica(url, tentativi = 3) {
  let ultimo;
  for (let i = 0; i < tentativi; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (aggiornamento dati personale)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const testo = await r.text();
      if (testo.trimStart().startsWith('<')) throw new Error('risposta HTML invece di un CSV');
      return testo;
    } catch (e) {
      ultimo = e;
      await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${ultimo.message}`);
}

async function ottieniTabelle(sorgente, usaCache) {
  const cartella = path.join(RADICE, 'wahapedia', 'cache', new URL(sorgente).pathname.replace(/\W+/g, '_'));
  fs.mkdirSync(cartella, { recursive: true });
  const testi = {};
  for (const nome of TABELLE) {
    const file = path.join(cartella, `${nome}.csv`);
    if (usaCache) {
      if (!fs.existsSync(file)) throw new Error(`Manca ${file}: lancia prima lo script senza --cache`);
      testi[nome] = fs.readFileSync(file, 'utf8');
    } else {
      process.stdout.write(`  scarico ${nome}.csv … `);
      testi[nome] = await scarica(`${sorgente}/${nome}.csv`);
      fs.writeFileSync(file, testi[nome]);
      console.log(`${(testi[nome].length / 1024).toFixed(0)} KB`);
    }
  }
  return testi;
}

// ---------------------------------------------------------------------------------------------
// Lettura e scrittura CSV con separatore "|"

function leggiTabella(testo) {
  const t = testo.replace(/^﻿/, '');
  const righe = [];
  let riga = [];
  let campo = '';
  let tra = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (tra) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else tra = false;
      } else campo += c;
    } else if (c === '"' && campo === '') tra = true;
    else if (c === '|') {
      riga.push(campo);
      campo = '';
    } else if (c === '\n') {
      riga.push(campo);
      righe.push(riga);
      riga = [];
      campo = '';
    } else if (c !== '\r') campo += c;
  }
  if (campo || riga.length) {
    riga.push(campo);
    righe.push(riga);
  }
  const [intestazione, ...corpo] = righe;
  const nomi = intestazione.map((n) => n.trim());
  return corpo
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(nomi.map((n, i) => [n || `_${i}`, r[i] ?? ''])));
}

const campoCsv = (v) => {
  const s = String(v ?? '');
  return /["|\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Stessa forma dei file esistenti: BOM iniziale e righe CRLF.
const costruisciCsv = (intestazione, righe) =>
  `﻿${[intestazione, ...righe].map((r) => r.map(campoCsv).join('|')).join('\r\n')}\r\n`;

const idNumerico = (id) => String(Number(id));

function testoSemplice(html) {
  return String(html ?? '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/<\/li>\s*<li[^>]*>/gi, ' • ')
    .replace(/<li[^>]*>/gi, ' • ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Pulizie dei valori

function pulisciBase(grezzo) {
  const v = (grezzo || '').trim().replace(/\s*flying base$/i, '');
  if (!/\d/.test(v) || /^(use model|unique|no official base size)$/i.test(v)) return '';
  return v;
}

function pulisciArma(a) {
  const t = (v) => (v ?? '').trim();
  const bs = t(a.BS_WS).replace(/\+$/, '');
  const ap = t(a.AP) === '-0' ? '0' : t(a.AP);
  return { A: t(a.A), BS_WS: bs, S: t(a.S), AP: ap, D: t(a.D) };
}

function caricaCorrezioniBasette() {
  try {
    const lista = JSON.parse(fs.readFileSync(FILE_BASETTE, 'utf8')).basette || [];
    return new Map(lista.map((b) => [`${b.id}|${b.line}`, b]));
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------------------------
// Conversioni

function costruisciTutto(tab) {
  const fazioni = new Map(tab.Factions.map((f) => [f.id, f.name]));
  const schede = new Map(tab.Datasheets.map((d) => [idNumerico(d.id), d]));
  const fonti = new Map(tab.Source.map((s) => [s.id, s]));
  const avvisi = [];
  const nomiPerId = new Map();
  // Nome della scheda; per quelle assenti da Datasheets.csv si ripiega sul primo modello (vedi sotto).
  const nomeScheda = (id) => schede.get(idNumerico(id))?.name || nomiPerId.get(idNumerico(id)) || '';

  // Schede che compaiono nei modelli ma non in Datasheets.csv: fazione ripresa dal vecchio info.csv.
  const vecchioInfo = leggiVecchio('info.csv');
  const fazionePrecedente = new Map();
  vecchioInfo.forEach((r) => fazionePrecedente.set(idNumerico(r.datasheet_id), { fac: r.fac, faction: r.faction }));

  const correzioni = caricaCorrezioniBasette();
  const correzioniUsate = new Set();
  const discordanti = [];

  const info = [];
  for (const m of tab.Datasheets_models) {
    const id = idNumerico(m.datasheet_id);
    const scheda = schede.get(id);
    let fac = scheda?.faction_id;
    let faction = fac ? fazioni.get(fac) : '';
    if (!fac) {
      const prec = fazionePrecedente.get(id);
      if (!prec) {
        avvisi.push(`Modello «${m.name}» (scheda ${id}) senza scheda in Datasheets.csv e senza fazione nota: scartato`);
        continue;
      }
      ({ fac, faction } = prec);
      avvisi.push(`Scheda ${id} («${m.name}») assente in Datasheets.csv: fazione ripresa dal vecchio info.csv (${faction})`);
    }
    let base = pulisciBase(m.base_size);
    const chiave = `${id}|${m.line}`;
    const corr = correzioni.get(chiave);
    if (corr) {
      correzioniUsate.add(chiave);
      if (base && base !== corr.base) discordanti.push(`${m.name} (${chiave}): Wahapedia «${base}», correzione manuale «${corr.base}»`);
      base = corr.base;
    }
    // Alcuni modelli non hanno nome (la scheda ha un solo profilo): vale il nome della scheda.
    const nome = (m.name || scheda?.name || '').trim();
    info.push([id, m.line, nome, m.M, m.T, m.Sv, m.inv_sv, m.inv_sv_descr, m.W, m.Ld, m.OC, base, fac, faction]);
  }
  for (const [chiave, corr] of correzioni) {
    if (!correzioniUsate.has(chiave)) avvisi.push(`Correzione basetta orfana (la scheda non esiste più?): ${corr.nome} ${chiave}`);
  }

  info.forEach((r) => nomiPerId.set(r[0], nomiPerId.get(r[0]) ?? r[2]));
  const wargear = [];
  for (const a of tab.Datasheets_wargear) {
    if (!(a.name ?? '').trim()) continue;
    const id = idNumerico(a.datasheet_id);
    const p = pulisciArma(a);
    wargear.push([
      id,
      // Come nel file originale: il nome del primo modello della scheda (quello di info.csv), non della scheda.
      nomiPerId.get(id) || nomeScheda(id),
      a.line,
      a.line_in_wargear,
      a.dice,
      a.name.trim(),
      a.description,
      a.range,
      a.type,
      p.A,
      p.BS_WS,
      p.S,
      p.AP,
      p.D,
    ]);
  }

  // ---- File extra per l'army builder -----------------------------------------------------
  const extra = {};

  extra['schede.csv'] = [
    ['datasheet_id', 'name', 'fac', 'faction', 'ruolo', 'fonte', 'legends', 'virtuale', 'trasporto', 'equipaggiamento', 'link'],
    tab.Datasheets.map((d) => {
      const fonte = fonti.get(d.source_id);
      return [
        idNumerico(d.id),
        d.name,
        d.faction_id,
        fazioni.get(d.faction_id) ?? '',
        d.role,
        fonte?.name ?? '',
        /legends/i.test(fonte?.name ?? '') ? 'true' : 'false',
        d.virtual,
        testoSemplice(d.transport),
        testoSemplice(d.loadout),
        d.link,
      ];
    }),
  ];

  // Costi in punti: Wahapedia alterna righe-intestazione (senza costo: scaglione per numero di unità
  // o sezione "WARGEAR OPTIONS") a righe con descrizione e costo. Normalizzo lo scaglione in un codice.
  const codiceScaglione = (testo) => {
    const t = testoSemplice(testo).toUpperCase();
    if (/^YOUR UNIT COSTS$/.test(t)) return 'unica';
    if (/1ST TO 2ND/.test(t)) return '1-2';
    if (/1ST TO 3RD/.test(t)) return '1-3';
    if (/^YOUR 1ST UNIT/.test(t)) return '1';
    if (/^YOUR 2ND \+/.test(t)) return '2+';
    if (/^YOUR 3RD \+/.test(t)) return '3+';
    if (/^YOUR 4TH \+/.test(t)) return '4+';
    return t.toLowerCase();
  };
  const punti = [];
  let scaglione = 'unica';
  let sezioneOpzioni = false;
  let ultimoId = null;
  const nonClassificati = [];
  for (const c of tab.Datasheets_models_cost) {
    const id = idNumerico(c.datasheet_id);
    if (id !== ultimoId) {
      ultimoId = id;
      scaglione = 'unica';
      sezioneOpzioni = false;
    }
    const descrizione = testoSemplice(c.description);
    if (!c.cost.trim()) {
      sezioneOpzioni = /WARGEAR OPTIONS/i.test(descrizione);
      scaglione = sezioneOpzioni ? scaglione : codiceScaglione(c.description);
      continue;
    }
    // "10 models", ma anche "10 Gretchin" o "1 Sword Brother, 4 Neophytes, 5 Initiates" (somma dei numeri).
    const parti = descrizione.split(/\s*,\s*/);
    const taglia = parti.every((p) => /^\d+\s+\S/.test(p)) ? parti.reduce((t, p) => t + Number(p.match(/^\d+/)[0]), 0) : null;
    if (taglia && !sezioneOpzioni) {
      punti.push([id, nomeScheda(id), scaglione, 'unita', String(taglia), c.cost.trim(), descrizione]);
    } else {
      if (!sezioneOpzioni && !/^(per |\+)/i.test(descrizione)) nonClassificati.push(`${id} ${nomeScheda(id)}: «${descrizione}»`);
      punti.push([id, nomeScheda(id), scaglione, 'opzione', '', c.cost.trim(), descrizione]);
    }
  }
  if (nonClassificati.length) avvisi.push(`Righe di costo non riconosciute (trattate come opzioni): ${nonClassificati.length}, es. ${nonClassificati.slice(0, 3).join(' ; ')}`);
  extra['punti.csv'] = [['datasheet_id', 'name', 'scaglione', 'tipo', 'modelli', 'punti', 'descrizione'], punti];

  extra['composizione.csv'] = [
    ['datasheet_id', 'name', 'line', 'descrizione', 'modello', 'min', 'max'],
    tab.Datasheets_unit_composition.map((c) => {
      const d = testoSemplice(c.description);
      const m = d.match(/^(\d+)(?:\s*-\s*(\d+))?\s+(.+?)\s+models?\b/i);
      return [idNumerico(c.datasheet_id), nomeScheda(c.datasheet_id), c.line, d, m ? m[3] : '', m ? m[1] : '', m ? (m[2] ?? m[1]) : ''];
    }),
  ];

  extra['opzioni.csv'] = [
    ['datasheet_id', 'name', 'line', 'descrizione'],
    tab.Datasheets_options.map((o) => [idNumerico(o.datasheet_id), nomeScheda(o.datasheet_id), o.line, testoSemplice(o.description)]),
  ];

  extra['leader.csv'] = [
    ['leader_id', 'leader', 'attached_id', 'attached'],
    tab.Datasheets_leader.map((l) => [idNumerico(l.leader_id), nomeScheda(l.leader_id), idNumerico(l.attached_id), nomeScheda(l.attached_id)]),
  ];

  extra['keywords.csv'] = [
    ['datasheet_id', 'name', 'keyword', 'model', 'is_faction_keyword'],
    tab.Datasheets_keywords.map((k) => [idNumerico(k.datasheet_id), nomeScheda(k.datasheet_id), k.keyword, k.model, k.is_faction_keyword]),
  ];

  // Abilità comuni (Core, Faction...): il testo sta una volta sola in abilita_comuni.csv e le righe di
  // abilita.csv le richiamano con ability_id; le abilità proprie di una scheda hanno il testo in riga.
  const abilitaGlobali = new Map(tab.Abilities.map((a) => [a.id, a]));
  const senzaIntestazione = (html) => html.replace(/<div class="abNameWrap">.*?<div class="abIcon"><\/div><\/div>/s, '');
  extra['abilita_comuni.csv'] = [
    ['ability_id', 'ability', 'fac', 'legend', 'descrizione'],
    tab.Abilities.map((a) => [a.id, a.name, a.faction_id, testoSemplice(a.legend), testoSemplice(senzaIntestazione(a.description))]),
  ];
  extra['abilita.csv'] = [
    ['datasheet_id', 'name', 'line', 'model', 'ability_id', 'ability', 'type', 'parameter', 'descrizione'],
    tab.Datasheets_abilities.map((a) => [
      idNumerico(a.datasheet_id),
      nomeScheda(a.datasheet_id),
      a.line,
      a.model,
      a.ability_id,
      a.name || (a.ability_id ? abilitaGlobali.get(a.ability_id)?.name : '') || '',
      a.type,
      a.parameter,
      testoSemplice(a.description),
    ]),
  ];

  const nomeDistaccamento = new Map(tab.Detachments.map((d) => [d.id, d.name]));
  extra['distaccamenti.csv'] = [
    ['id', 'fac', 'faction', 'name', 'type', 'dp', 'force_disposition'],
    tab.Detachments.map((d) => [d.id, d.faction_id, fazioni.get(d.faction_id) ?? '', d.name, d.type, d.dp, d.force_disposition]),
  ];

  extra['potenziamenti.csv'] = [
    ['id', 'fac', 'faction', 'name', 'cost', 'detachment_id', 'detachment', 'upgrade', 'restrizione', 'descrizione'],
    tab.Enhancements.map((e) => [
      e.id,
      e.faction_id,
      fazioni.get(e.faction_id) ?? '',
      e.name,
      e.cost,
      e.detachment_id,
      e.detachment || nomeDistaccamento.get(e.detachment_id) || '',
      e.upgrade,
      testoSemplice(e.support_leader),
      testoSemplice(e.description),
    ]),
  ];

  return { info, wargear, extra, avvisi, discordanti };
}

// Legge un file esistente dalla radice del repo (per le fazioni mancanti e per il confronto).
function leggiVecchio(nome) {
  try {
    return leggiTabella(fs.readFileSync(path.join(RADICE, nome), 'utf8'));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Controlli, confronto con i file attuali, scrittura

function controlli(tab) {
  const richieste = {
    Datasheets: ['id', 'name', 'faction_id'],
    Datasheets_models: ['datasheet_id', 'line', 'name', 'M', 'T', 'Sv', 'inv_sv', 'inv_sv_descr', 'W', 'Ld', 'OC', 'base_size'],
    Datasheets_wargear: ['datasheet_id', 'line', 'line_in_wargear', 'dice', 'name', 'description', 'range', 'type', 'A', 'BS_WS', 'S', 'AP', 'D'],
    Datasheets_models_cost: ['datasheet_id', 'line', 'description', 'cost'],
    Factions: ['id', 'name'],
  };
  for (const [nome, colonne] of Object.entries(richieste)) {
    const presenti = Object.keys(tab[nome][0] || {});
    const mancanti = colonne.filter((c) => !presenti.includes(c));
    if (mancanti.length) throw new Error(`${nome}.csv: colonne mancanti ${mancanti.join(', ')} (formato cambiato?)`);
  }
  if (tab.Datasheets.length < 1000 || tab.Datasheets_models.length < 1000 || tab.Datasheets_wargear.length < 5000) {
    throw new Error(
      `Dati troppo scarsi (schede ${tab.Datasheets.length}, modelli ${tab.Datasheets_models.length}, armi ${tab.Datasheets_wargear.length}): non scrivo nulla`,
    );
  }
}

// Confronta con la copia attualmente nel repo (cartella `attuale`), anche se si scrive altrove con --out.
function confronta(nomeFile, nuovoTesto, cartellaAttuale, colonnaNome) {
  const file = path.join(cartellaAttuale, nomeFile);
  const elenco = (t) => t.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const nRighe = elenco(nuovoTesto).length - 1;
  if (!fs.existsSync(file)) return `  ${nomeFile}: nuovo (${nRighe} righe)`;
  const vecchie = new Set(elenco(fs.readFileSync(file, 'utf8')));
  const nuove = new Set(elenco(nuovoTesto));
  const aggiunte = [...nuove].filter((r) => !vecchie.has(r));
  const rimosse = [...vecchie].filter((r) => !nuove.has(r));
  let testo = `  ${nomeFile}: ${nRighe} righe (${aggiunte.length} nuove/modificate, ${rimosse.length} tolte/modificate)`;
  if (colonnaNome !== undefined && aggiunte.length + rimosse.length > 0) {
    const nomi = (lista) => [...new Set(lista.map((r) => r.split('|')[colonnaNome]))].slice(0, 8).join(', ');
    testo += `\n      nuove/modificate: ${nomi(aggiunte)}\n      tolte/modificate: ${nomi(rimosse)}`;
  }
  return testo;
}

async function main() {
  const opzioni = leggiArgomenti(process.argv.slice(2));
  if (opzioni.aiuto) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((r) => r.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const richiesta = opzioni.sorgente ? normalizzaSorgente(opzioni.sorgente) : null;
  if (opzioni.sorgente && !richiesta) {
    console.error(`Indirizzo non valido: «${opzioni.sorgente}». Serve qualcosa come ${SORGENTE_PREDEFINITA}`);
    process.exit(1);
  }
  const sorgente = richiesta || sorgenteSalvata() || SORGENTE_PREDEFINITA;
  console.log(`Sorgente: ${sorgente}${opzioni.cache ? ' (da cache locale)' : ''}`);

  const testi = await ottieniTabelle(sorgente, opzioni.cache);
  const tab = Object.fromEntries(Object.entries(testi).map(([nome, testo]) => [nome, leggiTabella(testo)]));
  controlli(tab);
  const ultimoAggiornamento = tab.Last_update[0]?.last_update?.trim() || '';
  console.log(`Ultimo aggiornamento dei dati su Wahapedia: ${ultimoAggiornamento || 'sconosciuto'}`);

  const { info, wargear, extra, avvisi, discordanti } = costruisciTutto(tab);

  const principali = {
    'info.csv': costruisciCsv(['datasheet_id', 'line', 'name', 'MOV', 'RES', 'TS', 'TS+', 'Note', 'W', 'Ld', 'OC', 'base_size', 'fac', 'faction'], info),
    'Datasheets_wargear.csv': costruisciCsv(
      ['datasheet_id', 'name', 'line', 'line_in_wargear', 'dice', 'name', 'description', 'range', 'type', 'A', 'BS_WS', 'S', 'AP', 'D'],
      wargear,
    ),
  };

  console.log(`\nSchede: ${tab.Datasheets.length} | profili in info.csv: ${info.length} | righe armi: ${wargear.length}`);
  console.log('\nDifferenze rispetto ai file attuali:');
  console.log(confronta('info.csv', principali['info.csv'], RADICE, 2));
  console.log(confronta('Datasheets_wargear.csv', principali['Datasheets_wargear.csv'], RADICE, 1));
  const cartellaExtra = path.join(opzioni.out, CARTELLA_EXTRA);
  fs.mkdirSync(cartellaExtra, { recursive: true });
  const testiExtra = {};
  for (const [nome, [intestazione, righe]] of Object.entries(extra)) {
    testiExtra[nome] = costruisciCsv(intestazione, righe);
    console.log(confronta(nome, testiExtra[nome], path.join(RADICE, CARTELLA_EXTRA)));
  }

  if (avvisi.length) console.log(`\nAvvisi:\n${avvisi.map((a) => `  - ${a}`).join('\n')}`);
  if (discordanti.length) {
    console.log(`\nCorrezioni manuali delle basette che ora differiscono da Wahapedia (controlla se vanno ancora tenute in tools/wahapedia-basette.json):\n${discordanti.map((a) => `  - ${a}`).join('\n')}`);
  }
  const senzaBase = info.filter((r) => !r[11]).length;
  console.log(`\nProfili senza dimensione basetta: ${senzaBase} su ${info.length} (nell'app diventano un rettangolo 100×50 mm provvisorio).`);

  // Tutto è andato a buon fine: ora si scrive.
  fs.mkdirSync(opzioni.out, { recursive: true });
  for (const [nome, testo] of Object.entries(principali)) fs.writeFileSync(path.join(opzioni.out, nome), testo);
  for (const [nome, testo] of Object.entries(testiExtra)) fs.writeFileSync(path.join(cartellaExtra, nome), testo);
  if (opzioni.out === RADICE && !opzioni.cache) {
    fs.writeFileSync(FILE_SORGENTE, `${JSON.stringify({ sorgente, ultimoAggiornamento }, null, 2)}\n`);
  }
  console.log(`\nScritti in ${opzioni.out}: info.csv, Datasheets_wargear.csv e ${Object.keys(testiExtra).length} file in ${CARTELLA_EXTRA}/`);
  console.log('Prossimi passi: controlla le differenze, poi git add / commit / push, e «⟳ Aggiorna dati» nella mappa.');
}

main().catch((e) => {
  console.error(`\nErrore: ${e.message}`);
  process.exit(1);
});
