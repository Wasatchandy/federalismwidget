// scripts/sync.js
import fs from 'node:fs/promises';

const SHEET_TSV_URL = process.env.SHEET_TSV_URL;
const TYPES = new Set(['judicial','legislative','executive','agency','state','local']);

function parseTSV(tsv){
  const lines = tsv.trim().split(/\r?\n/);
  const headers = lines.shift().split('\t').map(h => h.trim().toLowerCase());
  return lines.map(l => {
    const cols = l.split('\t');
    const obj = {};
    headers.forEach((h,i)=> obj[h] = (cols[i] ?? '').trim());
    return obj;
  });
}

function toItems(rows){
  return rows
    .filter(r => r.title || r.date || r.body)
    .map(r => {
      const sources = [r.source1, r.source2, r.source3].filter(Boolean);
      return {
        title: (r.title||'').trim(),
        date: (r.date||'').trim(),
        body: (r.body||'').trim(),
        sources,
        type: (r.type||'').trim().toLowerCase(),
        stage: (r.stage||'').trim() || undefined
      };
    });
}

function validateItem(it){
  const errs = [];
  const titleWords = (it.title||'').split(/\s+/).filter(Boolean);
  if (!it.title) errs.push('missing title');
  if (titleWords.length > 5) errs.push('title > 5 words');
  const sentences = (it.body||'').split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/).filter(Boolean);
  if (sentences.length !== 2) errs.push('body not exactly 2 sentences');
  if (!Array.isArray(it.sources) || it.sources.length < 2) errs.push('need ≥2 sources');
  if (!TYPES.has(it.type)) errs.push(`invalid type: ${it.type}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) errs.push('date not YYYY-MM-DD');
  return errs;
}

const keyOf = it => `${(it.title||'').trim()}__${(it.date||'').trim()}`;

function dedupeMerge(oldItems, newItems){
  const map = new Map();
  for (const i of oldItems) map.set(keyOf(i), i);
  for (const i of newItems) map.set(keyOf(i), i);
  return Array.from(map.values()).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
}

async function run(){
  if(!SHEET_TSV_URL) throw new Error('Missing SHEET_TSV_URL');
  const res = await fetch(SHEET_TSV_URL, { cache: 'no-store' });
  if(!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const tsv = await res.text();

  const incoming = toItems(parseTSV(tsv));

  const errors = [];
  for (const it of incoming){
    const e = validateItem(it);
    if (e.length) errors.push({ key: keyOf(it), errors: e });
  }
  if (errors.length){
    console.error('Validation errors:\n' + errors.map(e=>` - ${e.key}: ${e.errors.join('; ')}`).join('\n'));
    process.exit(1);
  }

  const raw = await fs.readFile('data/feed.json','utf8').catch(()=> '[]');
  const current = JSON.parse(raw);

  const merged = dedupeMerge(current, incoming);
  await fs.writeFile('data/feed.json', JSON.stringify(merged, null, 2));
  console.log(`Synced ${incoming.length} rows. Feed now has ${merged.length} items.`);
}

await run();
