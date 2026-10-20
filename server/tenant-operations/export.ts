import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { money } from '../hyl/calculation.js';
import type { Row } from '../hyl/schema.js';
import { csv, signedCents } from './projections.js';
const xml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
// A small, standards-compliant ZIP writer for OOXML. Stored entries avoid compression dependencies.
function crc32(bytes: Buffer) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function xlsx(rows: string[][]) {
  const sheet = rows
    .map(
      (r, i) =>
        `<row r="${i + 1}">${r
          .map((v, j) => {
            let n = j + 1,
              col = '';
            while (n) {
              n--;
              col = String.fromCharCode(65 + (n % 26)) + col;
              n = Math.floor(n / 26);
            }
            return `<c r="${col}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
          })
          .join('')}</row>`,
    )
    .join('');
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  };
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name),
      b = Buffer.from(content),
      crc = crc32(b),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n, b);
    const d = Buffer.alloc(46);
    d.writeUInt32LE(0x02014b50);
    d.writeUInt16LE(20, 4);
    d.writeUInt16LE(20, 6);
    d.writeUInt32LE(crc, 16);
    d.writeUInt32LE(b.length, 20);
    d.writeUInt32LE(b.length, 24);
    d.writeUInt16LE(n.length, 28);
    d.writeUInt32LE(offset, 42);
    central.push(d, n);
    offset += h.length + n.length + b.length;
  }
  const end = Buffer.alloc(22),
    dir = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}
/** Render Chinese using the host's CJK fonts; no Helvetica substitution or missing glyphs. */
export async function pdf(rows: string[][]) {
  const doc = await PDFDocument.create(),
    lines = rows.flatMap((row) => wrapPdfLine(row.join('  |  ')));
  for (let i = 0; i < lines.length; i += 38) {
    const svg = `<svg width="1190" height="1684" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${lines
      .slice(i, i + 38)
      .map(
        (l, n) =>
          `<text x="65" y="${80 + n * 39}" font-family="PingFang SC,Noto Sans CJK SC, sans-serif" font-size="23" fill="black">${xml(l)}</text>`,
      )
      .join('')}</svg>`;
    const image = await doc.embedPng(
      await sharp(Buffer.from(svg)).png().toBuffer(),
    );
    doc
      .addPage([595, 842])
      .drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return doc.save();
}
export function statementRows(
  row: Row,
  payments: { payload: Record<string, unknown> }[],
  labels: Record<string, string>,
  events: unknown[] = [],
) {
  const p = row.payload,
    a = p.amounts as Record<string, string>,
    rows = [
      [labels.title, row.number],
      [labels.merchantName, row.name],
      [labels.status, labels['status_' + row.status] ?? row.status],
      [labels.period, String(p.start), String(p.end)],
    ];
  const contract = p.contract as Record<string, unknown>;
  rows.push([
    labels.contract,
    typeof contract.number === 'string' && contract.number
      ? contract.number
      : String(p.contractId),
    labels[String(contract.method)] ?? String(contract.method),
    labels[String(contract.basis)] ?? String(contract.basis),
    String(contract.rate) + '%',
    String(contract.fixedFee),
    String(contract.minimum),
    String(contract.rent),
  ]);
  for (const k of [
    'turnover',
    'feeBasis',
    'collected',
    'fee',
    'rent',
    'deductions',
    'ownCost',
    'payable',
  ])
    rows.push([labels[k] ?? k, a[k] ?? '0.00']);
  rows.push([labels.revenues]);
  for (const r of (p.revenues as Row[]) ?? [])
    rows.push([
      r.date,
      String(r.payload.source),
      String(r.payload.reference),
      String(r.payload.receipts),
      String(r.payload.refunds),
      String(r.payload.collected),
    ]);
  rows.push([labels.expenses]);
  for (const r of (p.expenses as Row[]) ?? [])
    rows.push([
      r.date,
      String(r.payload.category),
      labels[String(r.payload.responsibility)] ??
        String(r.payload.responsibility),
      String(r.payload.reference),
      String(r.payload.amount),
    ]);
  rows.push([labels.payments]);
  let paid = 0n;
  for (const r of payments) {
    rows.push([
      String(r.payload.date),
      String(r.payload.reference),
      String(r.payload.amount),
    ]);
    paid += signedCents(String(r.payload.amount));
  }
  rows.push([labels.audit]);
  for (const event of events) {
    const e = event as Record<string, unknown>;
    rows.push([
      typeof e.at === 'string' ? e.at : '',
      typeof e.action === 'string' ? (labels[e.action] ?? e.action) : '',
      typeof e.actor === 'string' ? e.actor : '',
      JSON.stringify(e.detail ?? ''),
    ]);
  }
  rows.push(
    [labels.paid, money(paid)],
    [labels.unpaid, money(signedCents(a.payable ?? '0') - paid)],
  );
  return rows;
}
export { csv };

export function wrapPdfLine(value: string) {
  const lines: string[] = [];
  let line = '',
    width = 0;
  for (const c of value) {
    const next = c.codePointAt(0)! > 255 ? 2 : 1;
    if (c === '\n' || width + next > 80) {
      lines.push(line);
      line = '';
      width = 0;
      if (c === '\n') continue;
    }
    line += c;
    width += next;
  }
  lines.push(line);
  return lines;
}
