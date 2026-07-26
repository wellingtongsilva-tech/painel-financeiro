/*
 * Parsers de extrato bancário (arquivo exportado pelo banco).
 * Suporta OFX (padrão Money/1.x, SGML) e CSV (formatos BR, com presets por
 * banco). Saída normalizada: { date:'YYYY-MM-DD', amount>0, type:'entrada'|
 * 'saida', description, import_key }.
 *
 * Bancos-alvo: Caixa, PagBank, PicPay, InfinitePay. Caixa/PagBank exportam
 * OFX; PicPay/InfinitePay normalmente CSV. O CSV é auto-mapeado por cabeçalho
 * e tolera vírgula decimal, ponto de milhar e colunas débito/crédito separadas.
 */

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function detectFormat(text) {
  return /<OFX|<STMTTRN|OFXHEADER/i.test(text) ? 'ofx' : 'csv';
}

// ---------- OFX ----------
export function parseOFX(text) {
  const out = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const seg = raw.split(/<\/STMTTRN>/i)[0];
    const get = (tag) => {
      const m = seg.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i'));
      return m ? m[1].trim() : '';
    };
    const amt = parseFloat(get('TRNAMT').replace(',', '.'));
    if (!isFinite(amt) || amt === 0) continue;
    const dt = get('DTPOSTED').replace(/[^\d]/g, '');
    if (dt.length < 8) continue;
    const date = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const desc = (get('MEMO') || get('NAME') || get('CHECKNUM') || 'Lançamento').trim();
    const fitid = get('FITID');
    out.push({
      date,
      amount: Math.abs(amt),
      type: amt < 0 ? 'saida' : 'entrada',
      description: desc || 'Lançamento',
      import_key: fitid ? 'ofx:' + fitid : 'h:' + hash(date + amt + desc),
    });
  }
  return out;
}

// ---------- CSV ----------
function splitCsv(line, delim) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseDate(s) {
  s = String(s || '').trim();
  let m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{2})\/(\d{2})\/(\d{2})(?!\d)/); if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function parseBRNumber(s) {
  if (s == null) return null;
  let t = String(s).replace(/[^\d.,\-]/g, '').trim();
  if (!t || t === '-') return null;
  const neg = /-/.test(t);
  t = t.replace(/-/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');       // 1.234,56 -> 1234.56
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');  // 1.234.567 -> 1234567
  const n = parseFloat(t);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  // delimitador: ; costuma vencer no BR
  const semi = (lines[0].match(/;/g) || []).length;
  const comma = (lines[0].match(/,/g) || []).length;
  const delim = semi >= comma ? ';' : ',';
  const rows = lines.map((l) => splitCsv(l, delim));
  // acha a linha de cabeçalho (a que menciona "data"/"date")
  let hi = rows.findIndex((r) => r.some((c) => /\b(data|date)\b/i.test(c)));
  if (hi < 0) hi = 0;
  const header = rows[hi].map((h) => h.toLowerCase());
  const col = (keys) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  const iDate = col(['data', 'date']);
  const iDesc = col(['históric', 'historic', 'descri', 'lançament', 'lancament', 'memo', 'estabelec', 'description', 'title', 'titulo', 'título', 'moviment', 'detalhe']);
  const iVal = col(['valor', 'value', 'montante', 'amount', 'vlr', 'líquido', 'liquido']);
  const iDeb = col(['débito', 'debito', 'debit']);
  const iCred = col(['crédito', 'credito', 'credit']);
  const iType = col(['tipo', 'type', 'd/c', 'natureza', 'entrada/saída', 'operação', 'operacao']);
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length < 2) continue;
    const date = parseDate(iDate >= 0 ? cells[iDate] : cells.find((c) => parseDate(c)) || '');
    if (!date) continue;
    let amount = null, type = null;
    if (iVal >= 0 && cells[iVal] != null && cells[iVal] !== '') {
      const v = parseBRNumber(cells[iVal]);
      if (v == null) continue;
      if (iType >= 0 && cells[iType]) {
        const t = cells[iType].toLowerCase();
        type = /(d|déb|debit|saíd|saida|paga|-)/.test(t) ? 'saida' : 'entrada';
        amount = Math.abs(v);
      } else { type = v < 0 ? 'saida' : 'entrada'; amount = Math.abs(v); }
    } else if (iDeb >= 0 || iCred >= 0) {
      const deb = iDeb >= 0 ? parseBRNumber(cells[iDeb]) : null;
      const cred = iCred >= 0 ? parseBRNumber(cells[iCred]) : null;
      if (deb && Math.abs(deb) > 0) { type = 'saida'; amount = Math.abs(deb); }
      else if (cred && Math.abs(cred) > 0) { type = 'entrada'; amount = Math.abs(cred); }
      else continue;
    } else continue;
    if (amount == null || !(amount > 0)) continue;
    const desc = (iDesc >= 0 ? cells[iDesc] : '').trim() || 'Lançamento';
    out.push({ date, amount, type, description: desc, import_key: 'h:' + hash(date + amount + type + desc) });
  }
  return out;
}

export function parseStatement(text, format) {
  const fmt = format === 'ofx' || format === 'csv' ? format : detectFormat(text);
  const items = fmt === 'ofx' ? parseOFX(text) : parseCSV(text);
  return { format: fmt, items };
}
