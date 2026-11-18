import React, { useState, useMemo, useEffect, useRef, createContext, useContext } from 'react';
import './styles.css';
import { api } from './api';

/* =====================================================================
   DineDesk POS - sample build (React + TypeScript)
   Placeholder brand name: change BRAND below.
   Panels: Restaurant (user) panel and Developer (admin) panel.
   Payments go through the PaymentProvider interface, so a real gateway
   (Stripe, Safepay, PayFast, ...) replaces `sandbox` without touching the UI.
   ===================================================================== */

const BRAND = 'DineDesk';

/* ------------------------------ types ------------------------------ */
type Role = 'user' | 'admin';
type OrderType = 'dine-in' | 'takeaway' | 'delivery';
type Method = 'cash' | 'card' | 'wallet';
type Status = 'new' | 'preparing' | 'ready' | 'served';
type Maint = 'off' | 'notice' | 'readonly';
type Tone = 'good' | 'warn' | 'bad' | 'info' | 'mute';

interface MenuItem { id: string; name: string; price: number; cat: string; available: boolean }
interface Line { id: string; name: string; price: number; qty: number; note: string }
interface Pay { method: Method; ref?: string; last4?: string; tendered?: number; change?: number }
interface Order {
  no: number; type: OrderType; table: string; customer: string; lines: Line[];
  discountPct: number; taxPct: number; svcPct: number;
  sub: number; discount: number; service: number; tax: number; total: number;
  status: Status; paid: boolean; pay?: Pay; at: number; cashier: string;
}
interface Settings {
  name: string; address: string; phone: string; tax: number; service: number; footer: string;
  autoPrint: boolean; printer: string; paper: '80' | '58';
}
interface Tenant {
  id: string; name: string; city: string; plan: 'Starter' | 'Pro' | 'Chain';
  status: 'active' | 'trial' | 'suspended'; branches: number; version: string; sync: number; licenseDays: number;
}
interface Ticket {
  id: string; tid: string; title: string; detail: string;
  sev: 'critical' | 'high' | 'normal'; status: 'open' | 'progress' | 'resolved'; at: number; src: string;
}
interface Flags { wallet: boolean; delivery: boolean; discount: boolean }
interface AuditEntry { at: number; actor: string; text: string }
interface State {
  session: null | { role: Role; name: string };
  menu: MenuItem[]; orders: Order[]; nextNo: number; settings: Settings;
  tenants: Tenant[]; tickets: Ticket[]; nextTicket: number;
  flags: Flags; maint: Maint; maintMsg: string; gatewayDown: boolean; audit: AuditEntry[];
  dbConnected: boolean;
}
interface Ctx {
  S: State; setS: React.Dispatch<React.SetStateAction<State>>;
  toast: (m: string) => void; now: number; enter: (r: Role) => string; audit: (t: string) => void;
  print: (o: Order, which: PrintWhich, okMsg?: string) => Promise<void>;
}

/* ---------------------------- helpers ---------------------------- */
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const money = (n: number) => 'Rs ' + num(n);
const pad2 = (n: number) => String(n).padStart(2, '0');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dateStr = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const timeStr = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
const compact = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'k' : String(v));
function ago(t: number, now: number) {
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.floor(h / 24) + ' d ago';
}
const typeLabel = (o: { type: OrderType; table: string }) =>
  o.type === 'dine-in' ? 'Dine-in ' + o.table : cap(o.type);

function calc(lines: Line[], discountPct: number, type: OrderType, s: Settings) {
  const sub = lines.reduce((a, l) => a + l.price * l.qty, 0);
  const discount = Math.round((sub * discountPct) / 100);
  const base = sub - discount;
  const service = type === 'dine-in' ? Math.round((base * s.service) / 100) : 0;
  const tax = Math.round(((base + service) * s.tax) / 100);
  return { sub, discount, service, tax, total: base + service + tax };
}

function useNow(ms = 30000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setN(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

function copyText(text: string, done: () => void, fail: () => void) {
  try { navigator.clipboard.writeText(text).then(done, fail); } catch { fail(); }
}

/* --------------------------- payment layer --------------------------- */
interface PayReq {
  amount: number; method: Method;
  card?: { name: string; number: string; expiry: string; cvc: string };
  wallet?: { phone: string };
}
interface PayRes { ok: boolean; ref?: string; last4?: string; error?: string }
interface PaymentProvider { name: string; charge(req: PayReq): Promise<PayRes> }

const gatewayState = { down: false };

function luhn(n: string) {
  let sum = 0; let alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return n.length > 0 && sum % 10 === 0;
}

/* Sandbox adapter. A real gateway implements the same `charge` contract. */
const sandbox: PaymentProvider = {
  name: 'Sandbox Gateway',
  async charge(req) {
    await new Promise(r => setTimeout(r, 1300));
    if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, error: 'No internet connection. Take cash, or try again when the connection is back.' };
    if (gatewayState.down) return { ok: false, error: 'Payment gateway is unreachable (503). Try again, or take cash.' };
    const ref = 'SBX-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    if (req.method === 'card' && req.card) {
      const n = req.card.number.replace(/\s/g, '');
      if (!luhn(n)) return { ok: false, error: 'This card number is not valid.' };
      if (n === '4000000000000002') return { ok: false, error: 'Card declined by the issuing bank.' };
      if (n === '4000000000009995') return { ok: false, error: 'Insufficient funds on this card.' };
      return { ok: true, ref, last4: n.slice(-4) };
    }
    if (req.method === 'wallet' && req.wallet) {
      if (req.wallet.phone.endsWith('0000')) return { ok: false, error: 'The wallet request was rejected.' };
      return { ok: true, ref };
    }
    return { ok: false, error: 'Unsupported payment method.' };
  },
};

/* ------------------------------ seed data ------------------------------ */
const CATS = ['Starters', 'BBQ & Grill', 'Karahi & Curries', 'Rice & Bread', 'Drinks', 'Desserts'];
const RAW_MENU: [string, number, number, boolean?][] = [
  ['Chicken Samosa (3 pcs)', 250, 0], ['Dahi Bhallay', 320, 0], ['Chana Chaat', 280, 0], ['Hot Wings (6 pcs)', 690, 0],
  ['Chicken Tikka (Leg)', 480, 1], ['Seekh Kabab (4 pcs)', 780, 1], ['Malai Boti', 950, 1], ['Beef Bihari Boti', 1150, 1], ['Mutton Chops (4 pcs)', 1850, 1, false],
  ['Chicken Karahi (Half)', 1650, 2], ['Chicken Karahi (Full)', 3100, 2], ['Mutton Karahi (Half)', 2450, 2], ['Nihari', 1250, 2], ['Daal Mash', 650, 2], ['Haleem', 700, 2, false],
  ['Chicken Biryani', 650, 3], ['Plain Rice', 300, 3], ['Naan', 70, 3], ['Garlic Naan', 120, 3], ['Roghni Naan', 110, 3], ['Paratha', 90, 3],
  ['Mint Margarita', 350, 4], ['Sweet Lassi', 300, 4], ['Soft Drink (345 ml)', 120, 4], ['Mineral Water', 100, 4], ['Doodh Patti Chai', 180, 4], ['Kashmiri Chai', 280, 4],
  ['Gulab Jamun (2 pcs)', 250, 5], ['Kheer', 280, 5], ['Gajar Halwa', 350, 5],
];
const MENU0: MenuItem[] = RAW_MENU.map((m, i) => ({
  id: 'm' + (i + 1), name: m[0], price: m[1], cat: CATS[m[2]], available: m[3] !== false,
}));
const TABLES = Array.from({ length: 12 }, (_, i) => 'T' + (i + 1));
const PRICE = { Starter: 6000, Pro: 12000, Chain: 30000 };
const NEXT: Record<Status, Status> = { new: 'preparing', preparing: 'ready', ready: 'served', served: 'served' };
const ACT: Record<Status, string> = { new: 'Start preparing', preparing: 'Mark ready', ready: 'Mark served', served: '' };

const SETTINGS0: Settings = {
  name: 'Karachi Tandoor House', address: 'Shop 14, Clifton Block 5, Karachi', phone: '021-0000-0000',
  tax: 13, service: 5, footer: 'Thank you for dining with us!',
  autoPrint: typeof window !== 'undefined' && !!window.posPrint, printer: '', paper: '80',
};

function seedOrders(now: number, menu: MenuItem[], s: Settings): Order[] {
  let seed = 11;
  const r = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pool = menu.filter(m => m.available);
  const statuses: Status[] = ['new', 'new', 'preparing', 'preparing', 'ready'];
  const raw: Order[] = [];
  for (let i = 0; i < 40; i++) {
    const active = i < 5;
    const mins = active ? 3 + i * 7 : 40 + (((i - 5) * 53) % 650);
    const type: OrderType = r() < 0.62 ? 'dine-in' : r() < 0.6 ? 'takeaway' : 'delivery';
    const picked: Line[] = [];
    const n = 2 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const m = pool[Math.floor(r() * pool.length)];
      if (!picked.find(l => l.id === m.id)) picked.push({ id: m.id, name: m.name, price: m.price, qty: 1 + Math.floor(r() * 3), note: '' });
    }
    const discountPct = r() < 0.12 ? 10 : 0;
    const t = calc(picked, discountPct, type, s);
    const paid = active ? i % 2 === 1 : true;
    const x = r();
    const method: Method = x < 0.45 ? 'cash' : x < 0.85 ? 'card' : 'wallet';
    const ref = method === 'cash' ? undefined : 'SBX-' + Math.floor(r() * 1e6).toString(36).toUpperCase().padStart(5, '0');
    raw.push({
      no: 0, type, table: type === 'dine-in' ? 'T' + (1 + Math.floor(r() * 12)) : '', customer: '', lines: picked,
      discountPct, taxPct: s.tax, svcPct: s.service, ...t,
      status: active ? statuses[i] : 'served', paid,
      pay: paid ? { method, ref, last4: method === 'card' ? String(1000 + Math.floor(r() * 8999)) : undefined } : undefined,
      at: now - mins * 60000, cashier: r() < 0.7 ? 'Ayesha' : 'Hamza',
    });
  }
  raw.sort((a, b) => a.at - b.at).forEach((o, i) => { o.no = 1001 + i; });
  return raw.reverse();
}

const TENANTS0: Tenant[] = [
  { id: 't1', name: 'Karachi Tandoor House', city: 'Karachi', plan: 'Pro', status: 'active', branches: 2, version: '2.4.1', sync: 2, licenseDays: 212 },
  { id: 't2', name: 'Lahore Chai Point', city: 'Lahore', plan: 'Starter', status: 'active', branches: 1, version: '2.4.1', sync: 5, licenseDays: 41 },
  { id: 't3', name: 'Gulberg Grill Co.', city: 'Lahore', plan: 'Chain', status: 'active', branches: 5, version: '2.4.0', sync: 1, licenseDays: 318 },
  { id: 't4', name: 'Burns Road Kitchen', city: 'Karachi', plan: 'Pro', status: 'active', branches: 1, version: '2.4.1', sync: 9, licenseDays: 12 },
  { id: 't5', name: 'Saddar Biryani Corner', city: 'Karachi', plan: 'Starter', status: 'trial', branches: 1, version: '2.4.1', sync: 14, licenseDays: 6 },
  { id: 't6', name: 'Hill Cafe Islamabad', city: 'Islamabad', plan: 'Pro', status: 'active', branches: 2, version: '2.4.1', sync: 3, licenseDays: 96 },
  { id: 't7', name: 'Rabri House Hyderabad', city: 'Hyderabad', plan: 'Starter', status: 'suspended', branches: 1, version: '2.3.8', sync: 20160, licenseDays: -18 },
];

function seedTickets(now: number): Ticket[] {
  const m = 60000;
  return [
    { id: 'TCK-2041', tid: 't5', title: 'Cannot sign in on the new tablet', detail: 'Cashier gets "invalid session" after the first login.', sev: 'normal', status: 'resolved', at: now - 2880 * m, src: 'Email' },
    { id: 'TCK-2040', tid: 't4', title: 'Add a "Family deals" menu category', detail: 'Wants bundles with a fixed price shown as one line.', sev: 'normal', status: 'open', at: now - 600 * m, src: 'POS report' },
    { id: 'TCK-2039', tid: 't3', title: 'Card payments time out at peak hours', detail: 'About 1 in 8 card charges fails with a timeout between 8 and 10 pm.', sev: 'critical', status: 'open', at: now - 190 * m, src: 'Monitoring' },
    { id: 'TCK-2038', tid: 't2', title: 'Printer prints a blank slip after update', detail: 'Customer receipt is blank on the 80 mm printer, kitchen copy is fine.', sev: 'high', status: 'progress', at: now - 1500 * m, src: 'POS report' },
    { id: 'TCK-2036', tid: 't6', title: 'Daily report shows the wrong tax total', detail: 'Tax column excludes service charge on dine-in orders.', sev: 'high', status: 'resolved', at: now - 5760 * m, src: 'POS report' },
  ];
}

function seedAudit(now: number): AuditEntry[] {
  const m = 60000;
  return [
    { at: now - 300 * m, actor: 'dev@dinedesk.io', text: 'Released v2.4.1 to all restaurants' },
    { at: now - 1900 * m, actor: 'dev@dinedesk.io', text: 'Extended license for Burns Road Kitchen by 30 days' },
    { at: now - 8000 * m, actor: 'system', text: 'Suspended Rabri House Hyderabad: license expired' },
  ];
}

function initState(): State {
  const now = Date.now();
  const menu = MENU0.map(m => ({ ...m }));
  const orders = seedOrders(now, menu, SETTINGS0);
  return {
    session: null, menu, orders, nextNo: 1001 + orders.length, settings: { ...SETTINGS0 },
    tenants: TENANTS0.map(t => ({ ...t })), tickets: seedTickets(now), nextTicket: 2042,
    flags: { wallet: true, delivery: true, discount: true },
    maint: 'off', maintMsg: 'Scheduled maintenance tonight 03:00 to 03:30. Billing stays available.',
    gatewayDown: false, audit: seedAudit(now),
    dbConnected: false,
  };
}

/* Everything is saved on this computer (localStorage inside the desktop app), so the app
   works with no internet and keeps its data after a restart. */
const STORE_KEY = 'dinedesk.pos.v1';
function loadState(): State {
  const base = initState();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<State>;
    return {
      ...base, ...saved, session: null, dbConnected: false,
      settings: { ...base.settings, ...(saved.settings || {}) },
      flags: { ...base.flags, ...(saved.flags || {}) },
    };
  } catch { return base; }
}
function saveState(s: State) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, session: null, orders: s.orders.slice(0, 1500) }));
  } catch { /* storage full or blocked: the app keeps working for this session */ }
}

function sampleOrder(s: Settings): Order {
  const lines: Line[] = [
    { id: 'x1', name: 'Chicken Karahi (Half)', price: 1650, qty: 1, note: 'Less oil' },
    { id: 'x2', name: 'Garlic Naan', price: 120, qty: 4, note: '' },
    { id: 'x3', name: 'Mint Margarita', price: 350, qty: 2, note: 'No ice' },
    { id: 'x4', name: 'Gulab Jamun (2 pcs)', price: 250, qty: 1, note: '' },
  ];
  const t = calc(lines, 10, 'dine-in', s);
  return {
    no: 1042, type: 'dine-in', table: 'T7', customer: '', lines, discountPct: 10, taxPct: s.tax, svcPct: s.service, ...t,
    status: 'new', paid: true, pay: { method: 'card', ref: 'SBX-8F2K9Q', last4: '4242' }, at: Date.now(), cashier: 'Ayesha',
  };
}

/* ------------------------------ slips ------------------------------ */
interface Row { k: string; a?: string; b?: string; q?: number; bold?: boolean }
const W = 32;
const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
const lr = (a: string, b: string) => a + ' '.repeat(Math.max(1, W - a.length - b.length)) + b;

function customerRows(o: Order, s: Settings): Row[] {
  const r: Row[] = [
    { k: 'title', a: s.name.toUpperCase() },
    { k: 'c', a: s.address },
    { k: 'c', a: 'Tel ' + s.phone },
    { k: 'rule' },
    { k: 'lr', a: 'Order #' + o.no, b: typeLabel(o) },
    { k: 'lr', a: dateStr(o.at), b: timeStr(o.at) },
    { k: 'lr', a: 'Cashier', b: o.cashier },
  ];
  if (o.customer) r.push({ k: 'lr', a: 'Customer', b: o.customer });
  r.push({ k: 'rule' }, { k: 'head', a: 'Item', b: 'Amount' });
  o.lines.forEach(l => {
    r.push({ k: 'item', a: l.name, q: l.qty, b: num(l.price * l.qty) });
    if (l.qty > 1) r.push({ k: 'note', a: '    @ ' + num(l.price) + ' each' });
  });
  r.push({ k: 'rule' }, { k: 'lr', a: 'Subtotal', b: num(o.sub) });
  if (o.discount) r.push({ k: 'lr', a: 'Discount (' + o.discountPct + '%)', b: '-' + num(o.discount) });
  if (o.service) r.push({ k: 'lr', a: 'Service charge (' + o.svcPct + '%)', b: num(o.service) });
  r.push({ k: 'lr', a: 'Sales tax (' + o.taxPct + '%)', b: num(o.tax) });
  r.push({ k: 'rule2' }, { k: 'total', a: 'TOTAL', b: money(o.total) }, { k: 'rule2' });
  if (o.paid && o.pay) {
    const p = o.pay;
    if (p.method === 'cash') {
      r.push({ k: 'lr', a: 'Paid by CASH', b: '' });
      if (p.tendered !== undefined) r.push({ k: 'lr', a: 'Received', b: num(p.tendered) }, { k: 'lr', a: 'Change', b: num(p.change || 0) });
    } else if (p.method === 'card') {
      r.push({ k: 'lr', a: 'Paid by CARD', b: '**** ' + (p.last4 || '') });
    } else {
      r.push({ k: 'lr', a: 'Paid by WALLET', b: '' });
    }
    if (p.ref) r.push({ k: 'lr', a: 'Ref', b: p.ref });
  } else {
    r.push({ k: 'c', a: '** UNPAID - PROVISIONAL BILL **', bold: true });
  }
  r.push({ k: 'gap' }, { k: 'c', a: s.footer }, { k: 'c', a: 'Powered by ' + BRAND });
  return r;
}

function kitchenRows(o: Order): Row[] {
  const qty = o.lines.reduce((a, l) => a + l.qty, 0);
  const r: Row[] = [
    { k: 'title', a: 'KITCHEN COPY' },
    { k: 'rule2' },
    { k: 'hero', a: '#' + o.no },
    { k: 'tag', a: o.type === 'dine-in' ? 'DINE-IN  TABLE ' + o.table : o.type.toUpperCase() },
    { k: 'lr', a: timeStr(o.at), b: o.cashier },
  ];
  if (o.customer) r.push({ k: 'lr', a: 'Customer', b: o.customer });
  r.push({ k: 'rule2' });
  o.lines.forEach(l => {
    r.push({ k: 'big', a: l.qty + ' x ' + l.name.toUpperCase() });
    if (l.note) r.push({ k: 'note', a: '>> ' + l.note });
  });
  r.push(
    { k: 'rule2' },
    { k: 'lr', a: 'Total items', b: String(qty) },
    { k: 'gap' },
    { k: 'c', a: '--- OWNER INFO ---' },
    { k: 'lr', a: 'Bill total', b: money(o.total) },
    { k: 'lr', a: 'Status', b: o.paid && o.pay ? 'PAID ' + o.pay.method.toUpperCase() : 'UNPAID' },
  );
  if (o.pay && o.pay.ref) r.push({ k: 'lr', a: 'Txn ref', b: o.pay.ref });
  return r;
}

function toText(rows: Row[]) {
  return rows.map(r => {
    switch (r.k) {
      case 'rule': return '-'.repeat(W);
      case 'rule2': return '='.repeat(W);
      case 'gap': return '';
      case 'title': case 'c': case 'tag': case 'hero': return ctr(r.a || '');
      case 'lr': case 'head': case 'total': return lr(r.a || '', r.b || '');
      case 'item': return lr(r.q + 'x ' + r.a, r.b || '');
      default: return r.a || '';
    }
  }).join('\n');
}

/* ------------------------------ printing ------------------------------ */
/* In the desktop app, window.posPrint is provided by electron/preload.cjs and prints with no
   dialog. In a plain browser the same slips go through the browser print dialog instead. */
type PrintWhich = 'customer' | 'kitchen' | 'both';
interface PrinterInfo { name: string; isDefault: boolean }
interface PrintResult { ok: boolean; error?: string }
interface PrintBridge {
  isDesktop: boolean;
  listPrinters(): Promise<PrinterInfo[]>;
  printHtml(html: string, opts: { printer: string; widthMm: number }): Promise<PrintResult>;
}
declare global { interface Window { posPrint?: PrintBridge } }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rowHtml(r: Row): string {
  const a = esc(r.a || '');
  const b = esc(r.b || '');
  switch (r.k) {
    case 'rule': return '<div class="rule"></div>';
    case 'rule2': return '<div class="rule2"></div>';
    case 'gap': return '<div class="gap"></div>';
    case 'title': return '<div class="title">' + a + '</div>';
    case 'hero': return '<div class="hero">' + a + '</div>';
    case 'tag': return '<div class="tag">' + a + '</div>';
    case 'c': return '<div class="c' + (r.bold ? ' b' : '') + '">' + a + '</div>';
    case 'lr': return '<div class="lr"><span>' + a + '</span><span>' + b + '</span></div>';
    case 'head': return '<div class="lr head"><span>' + a + '</span><span>' + b + '</span></div>';
    case 'total': return '<div class="lr total"><span>' + a + '</span><span>' + b + '</span></div>';
    case 'item': return '<div class="item"><span>' + (r.q || 0) + 'x</span><span>' + a + '</span><span class="m">' + b + '</span></div>';
    case 'big': return '<div class="big">' + a + '</div>';
    default: return '<div class="note">' + a + '</div>';
  }
}

/* Plain black-on-white page sized for a thermal roll (72 mm printable on an 80 mm roll). */
function slipHtml(rows: Row[], kind: 'customer' | 'kitchen', paper: '80' | '58'): string {
  const narrow = paper === '58';
  const w = narrow ? 48 : 72;
  const fs = narrow ? 11 : 12;
  const css = `
@page{size:${paper}mm auto;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{width:${w}mm;margin:0 auto;padding:3mm 0 8mm;font:${fs}px/1.45 "Courier New",Consolas,monospace}
.title{text-align:center;font-weight:700;font-size:${fs + 1}px;letter-spacing:.04em}
.c{text-align:center}.c.b{font-weight:700;margin-top:4px}
.rule{margin:6px 0;border-top:1px dashed #000}
.rule2{height:4px;margin:6px 0;border-top:1px solid #000;border-bottom:1px solid #000}
.gap{height:8px}
.lr{display:flex;justify-content:space-between;gap:8px}
.lr span:last-child{text-align:right;white-space:nowrap}
.head{font-size:${fs - 1}px;text-transform:uppercase}
.total{font-size:${fs + 3}px;font-weight:700}
.item{display:grid;grid-template-columns:2.4em minmax(0,1fr) auto;gap:4px}
.item .m{text-align:right}
.note{white-space:pre-wrap}
.hero{text-align:center;font-size:${fs + 24}px;font-weight:700;line-height:1.1}
.tag{text-align:center;font-weight:700;letter-spacing:.05em;margin-bottom:4px}
.big{margin-top:6px;font-size:${fs + 3}px;font-weight:700;line-height:1.3}
.big + .note{padding-left:1.5em;font-weight:700}`;
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + kind + ' slip</title><style>' + css + '</style></head><body>'
    + rows.map(rowHtml).join('') + '</body></html>';
}

function sendToPrinter(html: string, s: Settings): Promise<PrintResult> {
  const bridge = window.posPrint;
  if (bridge) {
    return bridge.printHtml(html, { printer: s.printer, widthMm: s.paper === '58' ? 58 : 80 })
      .catch((): PrintResult => ({ ok: false, error: 'The print service did not respond.' }));
  }
  return new Promise<PrintResult>(resolve => {
    try {
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(f);
      const doc = f.contentDocument;
      const win = f.contentWindow;
      if (!doc || !win) { f.remove(); resolve({ ok: false, error: 'Printing is not available in this window.' }); return; }
      doc.open(); doc.write(html); doc.close();
      window.setTimeout(() => {
        try { win.focus(); win.print(); resolve({ ok: true }); }
        catch { resolve({ ok: false, error: 'The browser blocked printing.' }); }
        window.setTimeout(() => f.remove(), 2000);
      }, 250);
    } catch { resolve({ ok: false, error: 'Printing is not available in this window.' }); }
  });
}

/* Kitchen copy first so the chef can start, then the customer receipt. Two jobs so the cutter separates them. */
async function printOrder(o: Order, s: Settings, which: PrintWhich): Promise<PrintResult> {
  const jobs: [Row[], 'customer' | 'kitchen'][] = [];
  if (which !== 'customer') jobs.push([kitchenRows(o), 'kitchen']);
  if (which !== 'kitchen') jobs.push([customerRows(o, s), 'customer']);
  for (const j of jobs) {
    const res = await sendToPrinter(slipHtml(j[0], j[1], s.paper), s);
    if (!res.ok) return res;
  }
  return { ok: true };
}

function Slip({ rows, kind }: { rows: Row[]; kind: 'customer' | 'kitchen' }) {
  return (
    <div className={'slip ' + kind}>
      {rows.map((r, i) => {
        switch (r.k) {
          case 'rule': return <div key={i} className="sl-rule" />;
          case 'rule2': return <div key={i} className="sl-rule2" />;
          case 'gap': return <div key={i} className="sl-gap" />;
          case 'title': return <div key={i} className="sl-title">{r.a}</div>;
          case 'hero': return <div key={i} className="sl-hero">{r.a}</div>;
          case 'tag': return <div key={i} className="sl-tag">{r.a}</div>;
          case 'c': return <div key={i} className={'sl-c' + (r.bold ? ' b' : '')}>{r.a}</div>;
          case 'lr': return <div key={i} className="sl-lr"><span>{r.a}</span><span>{r.b}</span></div>;
          case 'head': return <div key={i} className="sl-lr sl-head"><span>{r.a}</span><span>{r.b}</span></div>;
          case 'total': return <div key={i} className="sl-lr sl-total"><span>{r.a}</span><span>{r.b}</span></div>;
          case 'item': return <div key={i} className="sl-item"><span className="q">{r.q}x</span><span className="n">{r.a}</span><span className="m">{r.b}</span></div>;
          case 'big': return <div key={i} className="sl-big">{r.a}</div>;
          case 'note': return <div key={i} className="sl-note">{r.a}</div>;
          default: return null;
        }
      })}
    </div>
  );
}

/* ---------------------------- tiny UI kit ---------------------------- */
const ICONS: Record<string, JSX.Element> = {
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  book: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM8 7h8M8 11h6" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  sliders: <g><path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h10M18 18h2" /><circle cx="14" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></g>,
  lifebuoy: <g><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" /></g>,
  grid: <g><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></g>,
  store: <path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 6 0 2.5 2.5 0 0 0 5 0M10 20v-6h4v6" />,
  ticket: <path d="M3 8a2 2 0 0 0 0 8v2h18v-2a2 2 0 0 1 0-8V6H3v2zM13 6v12" />,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5z" />,
  logout: <path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" />,
  swap: <path d="M7 7h12l-3-3M17 17H5l3 3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  card: <g><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></g>,
  cash: <g><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /></g>,
  wallet: <g><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /><circle cx="16" cy="13.5" r="1.2" /></g>,
  search: <g><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></g>,
  alert: <path d="M12 4l9 16H3L12 4zM12 10v4M12 17v.01" />,
  note: <path d="M5 4h14v12l-4 4H5V4zM15 20v-4h4M8 9h8M8 13h4" />,
};
function Icon({ n, s = 18 }: { n: string; s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[n]}
    </svg>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={'pill ' + tone}>{children}</span>;
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={'sw' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map(o => (
        <button type="button" key={o[0]} className={value === o[0] ? 'on' : ''} aria-pressed={value === o[0]} onClick={() => onChange(o[0])}>{o[1]}</button>
      ))}
    </div>
  );
}

function Modal({ title, sub, onClose, wide, children, foot }: {
  title: string; sub?: string; onClose: () => void; wide?: boolean; children: React.ReactNode; foot?: React.ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h">
          <div><h2>{title}</h2>{sub && <span className="muted">{sub}</span>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon n="x" /></button>
        </div>
        <div className="modal-b">{children}</div>
        {foot && <div className="modal-f">{foot}</div>}
      </div>
    </div>
  );
}

function Bars({ data, fmt }: { data: { label: string; v: number; hi?: boolean }[]; fmt: (v: number) => string }) {
  const max = Math.max(1, ...data.map(d => d.v));
  return (
    <div className="bars" role="img" aria-label="Bar chart">
      {data.map((d, i) => (
        <div className="bar-col" key={i} title={d.label + ': ' + fmt(d.v)}>
          <span className="bar-v">{d.v ? fmt(d.v) : ''}</span>
          <div className="bar-track"><div className={'bar' + (d.hi ? ' hi' : '')} style={{ height: Math.max(d.v ? 3 : 0, (d.v / max) * 100) + '%' }} /></div>
          <span className="bar-l">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function HRow({ label, v, max, right }: { label: string; v: number; max: number; right: string }) {
  return (
    <div className="hrow">
      <span className="hrow-l">{label}</span>
      <div className="hrow-t"><div className="hrow-b" style={{ width: Math.max(2, (v / Math.max(1, max)) * 100) + '%' }} /></div>
      <span className="hrow-r">{right}</span>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="kpi">
      <span className="kpi-l">{label}</span>
      <b className={'kpi-v' + (tone ? ' t-' + tone : '')}>{value}</b>
      {sub && <span className="kpi-s">{sub}</span>}
    </div>
  );
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
const useApp = () => useContext(AppCtx);

/* ============================== root ============================== */
export default function App() {
  const [S, setS] = useState<State>(loadState);
  const [toastMsg, setToast] = useState('');
  const tRef = useRef(0);
  const now = useNow();
  gatewayState.down = S.gatewayDown;

  useEffect(() => {
    // Sync with MSSQL Express backend
    api.fetchInitialState().then(serverState => {
      if (serverState) {
        setS(prev => ({
          ...prev,
          dbConnected: true,
          menu: serverState.menu && serverState.menu.length > 0 ? serverState.menu : prev.menu,
          orders: serverState.orders && serverState.orders.length > 0 ? serverState.orders : prev.orders,
          settings: serverState.settings ? serverState.settings : prev.settings,
          tenants: serverState.tenants && serverState.tenants.length > 0 ? serverState.tenants : prev.tenants,
          tickets: serverState.tickets && serverState.tickets.length > 0 ? serverState.tickets : prev.tickets,
          flags: serverState.flags ? serverState.flags : prev.flags,
          maint: (serverState.maint as Maint) || prev.maint,
          maintMsg: serverState.maintMsg || prev.maintMsg,
          gatewayDown: serverState.gatewayDown !== undefined ? serverState.gatewayDown : prev.gatewayDown,
          nextNo: serverState.nextNo || prev.nextNo,
          nextTicket: serverState.nextTicket || prev.nextTicket,
          audit: serverState.audit && serverState.audit.length > 0 ? serverState.audit : prev.audit,
        }));
      }
    }).catch(err => {
      console.warn('Backend not reachable:', err);
    });
  }, []);

  useEffect(() => { saveState(S); }, [S]);

  const toast = (m: string) => {
    setToast(m);
    window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setToast(''), 2800);
  };
  const audit = (text: string) => {
    api.postAudit('dev@dinedesk.io', text);
    setS(s => ({ ...s, audit: [{ at: Date.now(), actor: 'dev@dinedesk.io', text }, ...s.audit].slice(0, 30) }));
  };
  const enter = (role: Role): string => {
    if (role === 'user' && S.tenants[0].status === 'suspended')
      return 'This restaurant account is suspended. Please contact ' + BRAND + ' support.';
    setS(s => ({ ...s, session: { role, name: role === 'user' ? 'Ayesha' : 'Dev Team' } }));
    return '';
  };

  const print = async (o: Order, which: PrintWhich, okMsg?: string) => {
    const res = await printOrder(o, S.settings, which);
    toast(res.ok ? okMsg || 'Sent to the printer' : 'Could not print: ' + (res.error || 'unknown error'));
  };

  const ctx: Ctx = { S, setS, toast, now, enter, audit, print };
  return (
    <AppCtx.Provider value={ctx}>
      {!S.session ? <Login /> : S.session.role === 'user' ? <UserApp /> : <AdminApp />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </AppCtx.Provider>
  );
}

/* ============================== login ============================== */
function Login() {
  const { S, enter } = useApp();
  const [role, setRole] = useState<Role>('user');
  const [email, setEmail] = useState('owner@tandoorhouse.pk');
  const [pw, setPw] = useState('demo1234');
  const [err, setErr] = useState('');
  const pick = (r: Role) => {
    setRole(r); setErr('');
    setEmail(r === 'user' ? 'owner@tandoorhouse.pk' : 'dev@dinedesk.io');
    setPw(r === 'user' ? 'demo1234' : 'admin1234');
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !pw) { setErr('Enter your email and password.'); return; }
    setErr(enter(role));
  };
  const sample = useMemo(() => sampleOrder(S.settings), [S.settings]);
  return (
    <div className="login">
      <section className="login-art">
        <div className="brand"><span className="brand-mark" />{BRAND}</div>
        <h1>One order.<br />Two slips.<br />No shouting across the kitchen.</h1>
        <p>Every order prints a priced receipt for the guest and a large-type ticket for the chef and owner.</p>
        <div className="login-slips" aria-hidden="true">
          <Slip rows={customerRows(sample, S.settings)} kind="customer" />
          <Slip rows={kitchenRows(sample)} kind="kitchen" />
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={submit} noValidate>
          <h2>Sign in</h2>
          <p className="muted">Choose the panel you want to open. Demo credentials are filled in.</p>
          <Seg value={role} onChange={pick} options={[['user', 'Restaurant panel'], ['admin', 'Developer admin']]} />
          <div className="field"><label htmlFor="em">Email</label><input id="em" className="in" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="in" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" /></div>
          {err && <div className="alert bad" role="alert"><Icon n="alert" />{err}</div>}
          <button className="btn primary wide" type="submit">Open {role === 'user' ? 'restaurant' : 'admin'} panel</button>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '0.8rem', color: S.dbConnected ? '#10b981' : '#94a3b8' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: S.dbConnected ? '#10b981' : '#64748b' }} />
            {S.dbConnected ? 'Database: MSSQL (DineDeskDB Connected)' : 'Database: Local Storage (Vercel / Cloud Ready)'}
          </div>
          <p className="fine">{role === 'user' ? 'For restaurant owners, managers and cashiers.' : 'For the software team: tenants, support tickets, releases and maintenance.'}</p>
        </form>
      </section>
    </div>
  );
}

/* ============================== shell ============================== */
interface NavItem { k: string; label: string; icon: string; badge?: number }
function Shell({ admin, nav, view, setView, title, sub, children }: {
  admin: boolean; nav: NavItem[]; view: string; setView: (v: string) => void; title: string; sub: string; children: React.ReactNode;
}) {
  const { S, setS, enter, toast } = useApp();
  const online = useOnline();
  const tenant = S.tenants[0];
  const switchPanel = () => {
    const e = enter(admin ? 'user' : 'admin');
    if (e) toast(e);
  };
  return (
    <div className={'shell' + (admin ? ' admin' : '')}>
      <aside className="rail">
        <div className="brand"><span className="brand-mark" />{BRAND}{admin && <em>Admin</em>}</div>
        <nav className="nav" aria-label="Main">
          {nav.map(n => (
            <button key={n.k} className={'nav-btn' + (view === n.k ? ' on' : '')} aria-current={view === n.k ? 'page' : undefined} onClick={() => setView(n.k)}>
              <Icon n={n.icon} /><span>{n.label}</span>{!!n.badge && <i className="badge">{n.badge}</i>}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          {admin ? <><b>Developer console</b><span>All restaurants</span></> : <><b>{tenant.name}</b><span>{tenant.city} · {tenant.plan} plan</span></>}
        </div>
      </aside>
      <main className="work">
        {!admin && S.maint !== 'off' && (
          <div className="banner" role="status"><Icon n="wrench" /><span>{S.maintMsg}</span>{S.maint === 'readonly' && <Pill tone="warn">New orders paused</Pill>}</div>
        )}
        <header className="topbar">
          <div className="topbar-title-wrap">
            <div className="mobile-brand-row">
              <span className="brand-mark" />
              <b>{BRAND}</b>
              {admin && <em>Admin</em>}
            </div>
            <h1>{title}</h1>
            <span className="muted">{sub}</span>
          </div>
          <div className="top-actions">
            <Pill tone={S.dbConnected ? 'good' : 'info'}>{S.dbConnected ? 'MSSQL DB' : 'Local DB'}</Pill>
            <Pill tone={online ? 'good' : 'warn'}>{online ? 'Online' : 'Offline'}</Pill>
            <button className="btn ghost sm" onClick={switchPanel} title={admin ? 'Restaurant panel' : 'Admin panel'}>
              <Icon n="swap" s={14} />
              <span className="hide-on-mobile">{admin ? 'Restaurant' : 'Admin'}</span>
            </button>
            <button className="btn ghost sm" onClick={() => setS(s => ({ ...s, session: null }))} title="Sign out">
              <Icon n="logout" s={14} />
              <span className="hide-on-mobile">Sign out</span>
            </button>
          </div>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}

/* ============================ restaurant panel ============================ */
type UView = 'pos' | 'orders' | 'menu' | 'reports' | 'support' | 'settings';
function UserApp() {
  const { S, now } = useApp();
  const [view, setView] = useState<UView>('pos');
  const [slipNo, setSlipNo] = useState<number | null>(null);
  const slipOrder = slipNo === null ? undefined : S.orders.find(o => o.no === slipNo);
  const active = S.orders.filter(o => o.status !== 'served').length;
  const nav: NavItem[] = [
    { k: 'pos', label: 'New order', icon: 'receipt' },
    { k: 'orders', label: 'Orders', icon: 'list', badge: active },
    { k: 'menu', label: 'Menu', icon: 'book' },
    { k: 'reports', label: 'Reports', icon: 'chart' },
    { k: 'support', label: 'Support', icon: 'lifebuoy' },
    { k: 'settings', label: 'Settings', icon: 'sliders' },
  ];
  const titles: Record<UView, [string, string]> = {
    pos: ['New order', 'Tap items to build the bill'],
    orders: ['Orders', 'Kitchen board and order history'],
    menu: ['Menu', 'Prices and availability'],
    reports: ['Reports', 'Sales for the last 12 hours'],
    support: ['Support', 'Report a problem to the ' + BRAND + ' team'],
    settings: ['Settings', 'Receipt details and tax'],
  };
  void now;
  return (
    <Shell admin={false} nav={nav} view={view} setView={v => setView(v as UView)} title={titles[view][0]} sub={titles[view][1]}>
      {view === 'pos' && <Pos showSlips={setSlipNo} />}
      {view === 'orders' && <Orders showSlips={setSlipNo} />}
      {view === 'menu' && <MenuManager />}
      {view === 'reports' && <Reports />}
      {view === 'support' && <Support />}
      {view === 'settings' && <SettingsView />}
      {slipOrder && <SlipsModal order={slipOrder} onClose={() => setSlipNo(null)} />}
    </Shell>
  );
}

/* ------------------------------- POS ------------------------------- */
function CartRow({ l, onQty, onNote }: { l: Line; onQty: (d: number) => void; onNote: (v: string) => void }) {
  const [open, setOpen] = useState(!!l.note);
  return (
    <div className="cline">
      <div className="cline-top">
        <div className="cline-name"><b>{l.name}</b><span className="muted">{num(l.price)} each</span></div>
        <div className="step">
          <button aria-label={'Remove one ' + l.name} onClick={() => onQty(-1)}><Icon n="minus" s={14} /></button>
          <span>{l.qty}</span>
          <button aria-label={'Add one ' + l.name} onClick={() => onQty(1)}><Icon n="plus" s={14} /></button>
        </div>
        <b className="cline-amt">{num(l.price * l.qty)}</b>
      </div>
      {open
        ? <input className="in sm" aria-label={'Kitchen note for ' + l.name} placeholder="Note for the kitchen (e.g. no chillies)" value={l.note} onChange={e => onNote(e.target.value)} />
        : <button className="link sm" onClick={() => setOpen(true)}>Add kitchen note</button>}
    </div>
  );
}

function Pos({ showSlips }: { showSlips: (no: number) => void }) {
  const { S, setS, toast, print } = useApp();
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Line[]>([]);
  const [type, setType] = useState<OrderType>('dine-in');
  const [table, setTable] = useState('T1');
  const [customer, setCustomer] = useState('');
  const [disc, setDisc] = useState(0);
  const [pay, setPay] = useState(false);
  const [mobileTab, setMobileTab] = useState<'menu' | 'bill'>('menu');
  const readOnly = S.maint === 'readonly';
  const dpct = S.flags.discount ? disc : 0;
  const T = calc(cart, dpct, type, S.settings);
  const cartQty = cart.reduce((a, l) => a + l.qty, 0);
  const items = S.menu.filter(m => (cat === 'All' || m.cat === cat) && m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const busy = (t: string) => S.orders.some(o => o.type === 'dine-in' && o.table === t && (o.status !== 'served' || !o.paid));
  const typeOpts: [OrderType, string][] = [['dine-in', 'Dine-in'], ['takeaway', 'Takeaway']];
  if (S.flags.delivery) typeOpts.push(['delivery', 'Delivery']);

  const add = (m: MenuItem) => {
    if (!m.available) return;
    setCart(c => c.find(l => l.id === m.id)
      ? c.map(l => (l.id === m.id ? { ...l, qty: l.qty + 1 } : l))
      : [...c, { id: m.id, name: m.name, price: m.price, qty: 1, note: '' }]);
  };
  const qty = (id: string, d: number) => setCart(c => c.map(l => (l.id === id ? { ...l, qty: l.qty + d } : l)).filter(l => l.qty > 0));
  const note = (id: string, v: string) => setCart(c => c.map(l => (l.id === id ? { ...l, note: v } : l)));

  const create = (info?: Pay): Order => {
    const o: Order = {
      no: S.nextNo, type, table: type === 'dine-in' ? table : '', customer: customer.trim(), lines: cart,
      discountPct: dpct, taxPct: S.settings.tax, svcPct: S.settings.service, ...T,
      status: 'new', paid: !!info, pay: info, at: Date.now(), cashier: S.session ? S.session.name : 'Cashier',
    };
    api.createOrder(o);
    setS(s => ({ ...s, orders: [o, ...s.orders], nextNo: s.nextNo + 1 }));
    setCart([]); setCustomer(''); setDisc(0);
    setMobileTab('menu');
    return o;
  };
  const sendKitchen = () => {
    const o = create();
    showSlips(o.no);
    if (S.settings.autoPrint) void print(o, 'kitchen', 'Order #' + o.no + ' sent to the kitchen and printed');
    else toast('Order #' + o.no + ' sent to the kitchen');
  };

  return (
    <div className={'pos' + (mobileTab === 'bill' ? ' show-bill' : ' show-menu')}>
      <div className="pos-mobile-nav">
        <button
          type="button"
          className={'pmn-btn' + (mobileTab === 'menu' ? ' on' : '')}
          onClick={() => setMobileTab('menu')}
        >
          <Icon n="book" s={15} />
          <span>Menu ({items.length})</span>
        </button>
        <button
          type="button"
          className={'pmn-btn' + (mobileTab === 'bill' ? ' on' : '')}
          onClick={() => setMobileTab('bill')}
        >
          <Icon n="receipt" s={15} />
          <span>Bill {cartQty > 0 ? `(${money(T.total)})` : ''}</span>
          {cartQty > 0 && <i className="pmn-badge">{cartQty}</i>}
        </button>
      </div>

      <section className="pos-menu">
        <div className="pos-tools">
          <label className="search"><Icon n="search" /><input id="item-search" type="search" placeholder="Search menu" value={q} onChange={e => setQ(e.target.value)} /></label>
          <div className="chips">
            {['All', ...CATS].map(c => <button key={c} className={'chip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>{c}</button>)}
          </div>
        </div>
        <div className="tiles">
          {items.map(m => {
            const n = cart.find(l => l.id === m.id)?.qty || 0;
            return (
              <button key={m.id} className={'tile' + (n ? ' has' : '')} disabled={!m.available} onClick={() => add(m)}>
                <span className="tile-cat">{m.cat}</span>
                <span className="tile-name">{m.name}</span>
                <span className="tile-price">{num(m.price)}</span>
                {n > 0 && <span className="tile-qty">{n}</span>}
                {!m.available && <span className="tile-off">Sold out</span>}
              </button>
            );
          })}
          {items.length === 0 && <p className="empty">No menu items match "{q}".</p>}
        </div>

        {cartQty > 0 && mobileTab === 'menu' && (
          <div className="mobile-cart-float" onClick={() => setMobileTab('bill')}>
            <div className="mcf-left">
              <span className="mcf-count">{cartQty} {cartQty === 1 ? 'item' : 'items'}</span>
              <span className="mcf-total">{money(T.total)}</span>
            </div>
            <div className="mcf-right">
              <span>View Bill & Pay</span>
              <Icon n="receipt" s={16} />
            </div>
          </div>
        )}
      </section>

      <aside className="bill">
        <div className="bill-mobile-back">
          <button type="button" className="btn sm ghost" onClick={() => setMobileTab('menu')}>
            ← Back to Menu
          </button>
        </div>
        <div className="bill-h">
          <div><h2>Current bill</h2><span className="muted">Order #{S.nextNo}</span></div>
          {cart.length > 0 && <button className="link" onClick={() => setCart([])}>Clear</button>}
        </div>
        <Seg value={type} onChange={setType} options={typeOpts} />
        {type === 'dine-in' && (
          <div className="field">
            <label>Table <span className="muted">(dot = occupied)</span></label>
            <div className="tables">
              {TABLES.map(t => <button key={t} className={'tbl' + (table === t ? ' on' : '') + (busy(t) ? ' busy' : '')} aria-pressed={table === t} onClick={() => setTable(t)}>{t.slice(1)}</button>)}
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="cust">{type === 'delivery' ? 'Customer name and phone' : 'Customer name (optional)'}</label>
          <input id="cust" className="in" value={customer} onChange={e => setCustomer(e.target.value)} />
        </div>
        <div className="lines">
          {cart.length === 0
            ? <div className="empty-bill"><Icon n="receipt" s={28} /><p>Tap menu items to start a bill.</p></div>
            : cart.map(l => <CartRow key={l.id} l={l} onQty={d => qty(l.id, d)} onNote={v => note(l.id, v)} />)}
        </div>
        <dl className="totals">
          <div><dt>Subtotal</dt><dd>{num(T.sub)}</dd></div>
          {S.flags.discount && (
            <div><dt>Discount <select id="disc" aria-label="Discount percent" value={disc} onChange={e => setDisc(Number(e.target.value))}>{[0, 5, 10, 15, 20].map(p => <option key={p} value={p}>{p}%</option>)}</select></dt><dd>{T.discount ? '-' + num(T.discount) : '0'}</dd></div>
          )}
          {T.service > 0 && <div><dt>Service charge ({S.settings.service}%)</dt><dd>{num(T.service)}</dd></div>}
          <div><dt>Sales tax ({S.settings.tax}%)</dt><dd>{num(T.tax)}</dd></div>
          <div className="grand"><dt>Total</dt><dd>{money(T.total)}</dd></div>
        </dl>
        <div className="bill-actions">
          <button className="btn" disabled={!cart.length || readOnly} onClick={sendKitchen}>Send to kitchen</button>
          <button className="btn primary" disabled={!cart.length || readOnly} onClick={() => setPay(true)}>Charge {money(T.total)}</button>
        </div>
        {readOnly && <p className="note-warn">Maintenance mode is on. New orders and payments are paused.</p>}
      </aside>

      {pay && (
        <PaymentModal
          amount={T.total}
          label={'Order #' + S.nextNo + ' · ' + (type === 'dine-in' ? 'Table ' + table.slice(1) : cap(type))}
          onClose={() => setPay(false)}
          onPaid={info => {
            const o = create(info);
            setPay(false);
            showSlips(o.no);
            if (S.settings.autoPrint) void print(o, 'both', 'Payment received for #' + o.no + '. Slips printed');
            else toast('Payment received for #' + o.no);
          }}
        />
      )}
    </div>
  );
}

/* --------------------------- payment modal --------------------------- */
function PaymentModal({ amount, label, onClose, onPaid }: { amount: number; label: string; onClose: () => void; onPaid: (p: Pay) => void }) {
  const { S } = useApp();
  const online = useOnline();
  const [m, setM] = useState<Method>('cash');
  const [tendered, setTendered] = useState('');
  const [card, setCard] = useState({ name: '', number: '', expiry: '', cvc: '' });
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const due = amount;
  const tn = Number(tendered) || 0;
  const quick = Array.from(new Set([due, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000, Math.ceil((due + 1) / 5000) * 5000])).sort((a, b) => a - b);
  const methods: [Method, string, string][] = [['cash', 'Cash', 'cash'], ['card', 'Card', 'card']];
  if (S.flags.wallet) methods.push(['wallet', 'Mobile wallet', 'wallet']);

  const run = async (req: PayReq) => {
    setBusy(true); setErr('');
    const res = await sandbox.charge(req);
    setBusy(false);
    if (res.ok) onPaid({ method: req.method, ref: res.ref, last4: res.last4 });
    else setErr(res.error || 'Payment failed.');
  };
  const payCard = () => {
    const n = card.number.replace(/\s/g, '');
    if (!card.name.trim()) return setErr('Enter the name on the card.');
    if (n.length < 13 || n.length > 19) return setErr('Enter the full card number.');
    const parts = card.expiry.split('/');
    const mi = Number(parts[0]); const yy = parts[1] || '';
    if (!(mi >= 1 && mi <= 12) || yy.length !== 2) return setErr('Enter the expiry as MM/YY.');
    if (new Date(2000 + Number(yy), mi, 1).getTime() <= Date.now()) return setErr('This card has expired.');
    if (!/^\d{3,4}$/.test(card.cvc)) return setErr('Enter the 3 or 4 digit security code.');
    return run({ amount: due, method: 'card', card });
  };
  const payWallet = () => {
    if (!/^03\d{9}$/.test(phone.replace(/\D/g, ''))) return setErr('Enter an 11 digit mobile number starting with 03.');
    return run({ amount: due, method: 'wallet', wallet: { phone: phone.replace(/\D/g, '') } });
  };
  const fmtCard = (v: string) => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  const fmtExp = (v: string) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; };

  return (
    <Modal title="Take payment" sub={label} onClose={busy ? () => undefined : onClose}>
      <div className="pay-amt"><span>Amount due</span><b>{money(due)}</b></div>
      <div className="paytabs" role="tablist">
        {methods.map(x => (
          <button key={x[0]} role="tab" aria-selected={m === x[0]} className={m === x[0] ? 'on' : ''} disabled={busy || (!online && x[0] !== 'cash')} onClick={() => { setM(x[0]); setErr(''); }}>
            <Icon n={x[2]} />{x[1]}
          </button>
        ))}
      </div>
      {!online && <div className="hint">No internet. Card and wallet need the payment gateway, so only cash works until the connection returns.</div>}
      {m === 'cash' && (
        <div className="pay-body">
          <div className="field"><label htmlFor="tend">Cash received</label>
            <input id="tend" className="in big" inputMode="numeric" value={tendered} onChange={e => setTendered(e.target.value.replace(/\D/g, ''))} placeholder={String(due)} /></div>
          <div className="chips">{quick.map(v => <button key={v} className="chip" onClick={() => setTendered(String(v))}>{v === due ? 'Exact' : num(v)}</button>)}</div>
          <div className={'change' + (tn >= due ? ' ok' : '')}><span>{tn >= due ? 'Change to return' : 'Short by'}</span><b>{money(Math.abs(tn - due))}</b></div>
          <button className="btn primary wide" disabled={tn < due} onClick={() => onPaid({ method: 'cash', tendered: tn, change: tn - due })}>Confirm cash payment</button>
        </div>
      )}
      {m === 'card' && (
        <div className="pay-body">
          <div className="hint">Sandbox gateway. Approved test card: 4242 4242 4242 4242, any future expiry, any code. 4000 0000 0000 0002 simulates a decline.</div>
          <div className="field"><label htmlFor="cn">Name on card</label><input id="cn" className="in" value={card.name} onChange={e => setCard({ ...card, name: e.target.value })} autoComplete="off" /></div>
          <div className="field"><label htmlFor="cc">Card number</label><input id="cc" className="in mono" inputMode="numeric" placeholder="0000 0000 0000 0000" value={card.number} onChange={e => setCard({ ...card, number: fmtCard(e.target.value) })} autoComplete="off" /></div>
          <div className="two">
            <div className="field"><label htmlFor="ce">Expiry</label><input id="ce" className="in mono" inputMode="numeric" placeholder="MM/YY" value={card.expiry} onChange={e => setCard({ ...card, expiry: fmtExp(e.target.value) })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="cv">Security code</label><input id="cv" className="in mono" inputMode="numeric" placeholder="123" maxLength={4} value={card.cvc} onChange={e => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '') })} autoComplete="off" /></div>
          </div>
          <button className="btn primary wide" disabled={busy} onClick={payCard}>{busy ? 'Contacting gateway…' : 'Pay ' + money(due)}</button>
        </div>
      )}
      {m === 'wallet' && (
        <div className="pay-body">
          <div className="hint">Sends a payment request to the customer's wallet app. In the sandbox, any number works; one ending in 0000 is rejected.</div>
          <div className="field"><label htmlFor="ph">Customer mobile number</label><input id="ph" className="in mono" inputMode="tel" placeholder="03XX XXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} /></div>
          <button className="btn primary wide" disabled={busy} onClick={payWallet}>{busy ? 'Waiting for approval…' : 'Request ' + money(due)}</button>
        </div>
      )}
      {err && <div className="alert bad" role="alert"><Icon n="alert" />{err}</div>}
    </Modal>
  );
}

/* ---------------------------- slips modal ---------------------------- */
function SlipsModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const { S, toast, print } = useApp();
  const c = customerRows(order, S.settings);
  const k = kitchenRows(order);
  const copy = (rows: Row[], label: string) => copyText(toText(rows), () => toast(label + ' copied as text'), () => toast('Copy is not available in this view'));
  return (
    <Modal wide title={'Order #' + order.no} sub={typeLabel(order) + ' · ' + (order.paid ? 'Paid' : 'Unpaid')} onClose={onClose}
      foot={<><button className="btn" onClick={() => print(order, 'both')}><Icon n="receipt" s={16} />Print both slips</button><button className="btn primary" onClick={onClose}>Done</button></>}>
      <div className="slips">
        <figure>
          <figcaption><b>Customer receipt</b><span className="muted">Priced, with tax and payment</span></figcaption>
          <Slip rows={c} kind="customer" />
          <div className="slip-actions">
            <button className="btn sm primary" onClick={() => print(order, 'customer')}>Print receipt</button>
            <button className="btn sm" onClick={() => copy(c, 'Customer receipt')}>Copy text</button>
          </div>
        </figure>
        <figure>
          <figcaption><b>Kitchen and owner copy</b><span className="muted">Large type items, owner totals below</span></figcaption>
          <Slip rows={k} kind="kitchen" />
          <div className="slip-actions">
            <button className="btn sm primary" onClick={() => print(order, 'kitchen')}>Print kitchen copy</button>
            <button className="btn sm" onClick={() => copy(k, 'Kitchen copy')}>Copy text</button>
          </div>
        </figure>
      </div>
    </Modal>
  );
}

/* ------------------------------ orders ------------------------------ */
function Orders({ showSlips }: { showSlips: (no: number) => void }) {
  const { S, setS, now, toast, print } = useApp();
  const [tab, setTab] = useState<'board' | 'history'>('board');
  const [statusTab, setStatusTab] = useState<'all' | Status>('all');
  const [payNo, setPayNo] = useState<number | null>(null);
  const payOrder = payNo === null ? undefined : S.orders.find(o => o.no === payNo);
  const cols: [Status, string][] = [['new', 'New'], ['preparing', 'Preparing'], ['ready', 'Ready to serve']];
  const advance = (no: number) => {
    const o = S.orders.find(x => x.no === no);
    if (o) api.updateOrderStatus(no, NEXT[o.status]);
    setS(s => ({ ...s, orders: s.orders.map(o => (o.no === no ? { ...o, status: NEXT[o.status] } : o)) }));
  };

  const filteredCols = cols.filter(([st]) => statusTab === 'all' || statusTab === st);

  return (
    <div className="stack">
      <Seg value={tab} onChange={setTab} options={[['board', 'Kitchen board'], ['history', 'History']]} />
      {tab === 'board' && (
        <>
          <div className="board-mobile-filter">
            <Seg
              value={statusTab}
              onChange={setStatusTab}
              options={[
                ['all', 'All (' + S.orders.filter(o => o.status !== 'served').length + ')'],
                ['new', 'New (' + S.orders.filter(o => o.status === 'new').length + ')'],
                ['preparing', 'Prep (' + S.orders.filter(o => o.status === 'preparing').length + ')'],
                ['ready', 'Ready (' + S.orders.filter(o => o.status === 'ready').length + ')'],
              ]}
            />
          </div>
          <div className="board">
            {filteredCols.map(([st, title]) => {
              const list = S.orders.filter(o => o.status === st).sort((a, b) => a.at - b.at);
              return (
                <section key={st} className="col">
                  <h3>{title}<span>{list.length}</span></h3>
                  {list.length === 0 && <p className="empty sm">Nothing here.</p>}
                  {list.map(o => {
                    const late = st !== 'ready' && (now - o.at) / 60000 > 25;
                    return (
                      <article key={o.no} className={'ocard ' + st}>
                        <header><b>#{o.no}</b><span>{typeLabel(o)}</span><span className="ago">{ago(o.at, now)}</span></header>
                        <ul>{o.lines.map((l, i) => <li key={i}><b>{l.qty}×</b> {l.name}{l.note && <em>{l.note}</em>}</li>)}</ul>
                        <footer>
                          <Pill tone={o.paid ? 'good' : 'warn'}>{o.paid ? 'Paid' : 'Unpaid'}</Pill>
                          {late && <Pill tone="bad">Late</Pill>}
                          <span className="grow" />
                          <button className="btn sm ghost" onClick={() => showSlips(o.no)}>Slips</button>
                          {!o.paid && <button className="btn sm" onClick={() => setPayNo(o.no)}>Pay</button>}
                          <button className="btn sm primary" onClick={() => advance(o.no)}>{ACT[st]}</button>
                        </footer>
                      </article>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </>
      )}
      {tab === 'history' && (
        <div className="card flush">
          <div className="tablewrap">
            <table>
              <thead><tr><th>Order</th><th>Time</th><th>Type</th><th className="r">Items</th><th className="r">Total</th><th>Payment</th><th>Status</th><th /></tr></thead>
              <tbody>
                {S.orders.slice(0, 30).map(o => (
                  <tr key={o.no}>
                    <td className="mono">#{o.no}</td><td>{timeStr(o.at)}</td><td>{typeLabel(o)}</td>
                    <td className="r">{o.lines.reduce((a, l) => a + l.qty, 0)}</td><td className="r">{num(o.total)}</td>
                    <td>{o.paid && o.pay ? <Pill tone="good">{cap(o.pay.method)}</Pill> : <Pill tone="warn">Unpaid</Pill>}</td>
                    <td><Pill tone={o.status === 'served' ? 'mute' : 'info'}>{cap(o.status)}</Pill></td>
                    <td className="r"><button className="btn sm ghost" onClick={() => showSlips(o.no)}>Slips</button>{!o.paid && <button className="btn sm" onClick={() => setPayNo(o.no)}>Pay</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {payOrder && (
        <PaymentModal amount={payOrder.total} label={'Order #' + payOrder.no + ' · ' + typeLabel(payOrder)} onClose={() => setPayNo(null)}
          onPaid={info => {
            api.payOrder(payOrder.no, info);
            setS(s => ({ ...s, orders: s.orders.map(o => (o.no === payOrder.no ? { ...o, paid: true, pay: info } : o)) }));
            setPayNo(null);
            showSlips(payOrder.no);
            if (S.settings.autoPrint) void print({ ...payOrder, paid: true, pay: info }, 'customer', 'Payment received for #' + payOrder.no + '. Receipt printed');
            else toast('Payment received for #' + payOrder.no);
          }} />
      )}
    </div>
  );
}

/* --------------------------- menu manager --------------------------- */
function MenuManager() {
  const { S, setS, toast } = useApp();
  const [q, setQ] = useState('');
  const [nm, setNm] = useState('');
  const [np, setNp] = useState('');
  const [nc, setNc] = useState(CATS[0]);
  const list = S.menu.filter(m => m.name.toLowerCase().includes(q.trim().toLowerCase()) || m.cat.toLowerCase().includes(q.trim().toLowerCase()));
  const upd = (id: string, p: Partial<MenuItem>) => {
    api.updateMenuItem(id, p);
    setS(s => ({ ...s, menu: s.menu.map(m => (m.id === id ? { ...m, ...p } : m)) }));
  };
  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(np);
    if (!nm.trim() || !(price > 0)) { toast('Enter an item name and a price above zero'); return; }
    const newItem: MenuItem = { id: 'm' + (S.menu.length + 1 + Date.now() % 1000), name: nm.trim(), price, cat: nc, available: true };
    api.createMenuItem(newItem);
    setS(s => ({ ...s, menu: [...s.menu, newItem] }));
    setNm(''); setNp(''); toast(nm.trim() + ' added to the menu');
  };
  return (
    <div className="stack">
      <form className="card add-item" onSubmit={addItem}>
        <div className="field grow2"><label htmlFor="nm">New item</label><input id="nm" className="in" value={nm} onChange={e => setNm(e.target.value)} placeholder="e.g. Reshmi Kabab (4 pcs)" /></div>
        <div className="field"><label htmlFor="nc">Category</label><select id="nc" className="in" value={nc} onChange={e => setNc(e.target.value)}>{CATS.map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor="np">Price (Rs)</label><input id="np" className="in" inputMode="numeric" value={np} onChange={e => setNp(e.target.value.replace(/\D/g, ''))} /></div>
        <button className="btn primary" type="submit"><Icon n="plus" s={16} />Add</button>
      </form>
      <div className="card flush">
        <div className="card-tools"><label className="search"><Icon n="search" /><input id="menu-search" type="search" placeholder="Search items or categories" value={q} onChange={e => setQ(e.target.value)} /></label><span className="muted">{list.length} items</span></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Item</th><th>Category</th><th className="r">Price (Rs)</th><th>Available</th></tr></thead>
            <tbody>
              {list.map(m => (
                <tr key={m.id}>
                  <td>{m.name}</td><td className="muted">{m.cat}</td>
                  <td className="r"><input key={m.id + ':' + m.price} className="in sm price" inputMode="numeric" aria-label={'Price of ' + m.name} defaultValue={m.price} onBlur={e => upd(m.id, { price: Math.max(0, Number(e.target.value) || 0) })} /></td>
                  <td><Switch on={m.available} label={'Available: ' + m.name} onChange={v => upd(m.id, { available: v })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ reports ------------------------------ */
function Reports() {
  const { S, now } = useApp();
  const d = new Date(now); d.setMinutes(0, 0, 0);
  const endHour = d.getTime();
  const win = endHour - 11 * 3600000;
  const inWin = S.orders.filter(o => o.at >= win);
  const paid = inWin.filter(o => o.paid);
  const collected = paid.reduce((a, o) => a + o.total, 0);
  const taxTotal = paid.reduce((a, o) => a + o.tax, 0);
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const start = win + i * 3600000;
    const v = paid.filter(o => o.at >= start && o.at < start + 3600000).reduce((a, o) => a + o.total, 0);
    return { label: pad2(new Date(start).getHours()), v, hi: i === 11 };
  });
  const methods: Method[] = ['cash', 'card', 'wallet'];
  const mix = methods.map(m => ({ m, v: paid.filter(o => o.pay && o.pay.method === m).reduce((a, o) => a + o.total, 0), n: paid.filter(o => o.pay && o.pay.method === m).length }));
  const itemMap: Record<string, { q: number; v: number }> = {};
  inWin.forEach(o => o.lines.forEach(l => { const e = itemMap[l.name] || (itemMap[l.name] = { q: 0, v: 0 }); e.q += l.qty; e.v += l.qty * l.price; }));
  const top = Object.keys(itemMap).map(n => ({ n, ...itemMap[n] })).sort((a, b) => b.q - a.q).slice(0, 6);
  const types: OrderType[] = ['dine-in', 'takeaway', 'delivery'];
  const split = types.map(t => ({ t, n: inWin.filter(o => o.type === t).length }));
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Collected" value={money(collected)} sub={paid.length + ' paid orders'} />
        <Kpi label="Orders" value={String(inWin.length)} sub={inWin.length - paid.length + ' not paid yet'} />
        <Kpi label="Average bill" value={money(paid.length ? collected / paid.length : 0)} />
        <Kpi label="Tax collected" value={money(taxTotal)} sub={'at ' + S.settings.tax + '%'} />
      </div>
      <div className="card">
        <div className="card-h"><h3>Sales by hour</h3><span className="muted">Rs, last 12 hours · sample data</span></div>
        <Bars data={buckets} fmt={compact} />
      </div>
      <div className="grid3">
        <div className="card"><div className="card-h"><h3>Payment methods</h3></div>
          {mix.map(x => <HRow key={x.m} label={cap(x.m)} v={x.v} max={collected} right={money(x.v)} />)}
        </div>
        <div className="card"><div className="card-h"><h3>Top items</h3></div>
          {top.map(x => <HRow key={x.n} label={x.n} v={x.q} max={top[0] ? top[0].q : 1} right={x.q + ' sold'} />)}
        </div>
        <div className="card"><div className="card-h"><h3>Order types</h3></div>
          {split.map(x => <HRow key={x.t} label={cap(x.t)} v={x.n} max={inWin.length} right={String(x.n)} />)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ support ------------------------------ */
function Support() {
  const { S, setS, now, toast } = useApp();
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [sev, setSev] = useState<Ticket['sev']>('normal');
  const mine = S.tickets.filter(t => t.tid === 't1');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast('Add a short title so the team knows what broke'); return; }
    const t: Ticket = { id: 'TCK-' + S.nextTicket, tid: 't1', title: title.trim(), detail: detail.trim() || 'No details provided.', sev, status: 'open', at: Date.now(), src: 'POS report' };
    api.createTicket(t);
    setS(s => ({ ...s, tickets: [t, ...s.tickets], nextTicket: s.nextTicket + 1 }));
    setTitle(''); setDetail(''); setSev('normal'); toast('Sent as ' + t.id + '. The team can see it now.');
  };
  return (
    <div className="grid2">
      <form className="card" onSubmit={submit}>
        <div className="card-h"><h3>Report a problem</h3></div>
        <div className="field"><label htmlFor="tt">What went wrong?</label><input id="tt" className="in" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Kitchen slip did not print" /></div>
        <div className="field"><label htmlFor="td">Details</label><textarea id="td" className="in" rows={4} value={detail} onChange={e => setDetail(e.target.value)} placeholder="What were you doing? Which order or table?" /></div>
        <div className="field"><label>How urgent is it?</label>
          <Seg value={sev} onChange={setSev} options={[['normal', 'Can wait'], ['high', 'Slowing us down'], ['critical', 'Cannot take orders']]} /></div>
        <button className="btn primary" type="submit">Send to support</button>
      </form>
      <div className="card flush">
        <div className="card-h pad"><h3>Your tickets</h3></div>
        <ul className="tlist">
          {mine.length === 0 && <li className="empty sm">No tickets yet.</li>}
          {mine.map(t => (
            <li key={t.id}>
              <div><b>{t.title}</b><span className="muted">{t.id} · {ago(t.at, now)}</span></div>
              <Pill tone={t.status === 'resolved' ? 'good' : t.status === 'progress' ? 'info' : 'warn'}>{t.status === 'progress' ? 'In progress' : cap(t.status)}</Pill>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ----------------------------- settings ----------------------------- */
function SettingsView() {
  const { S, setS } = useApp();
  const s = S.settings;
  const set = (p: Partial<Settings>) => {
    api.updateSettings({ ...s, ...p });
    setS(st => ({ ...st, settings: { ...st.settings, ...p } }));
  };
  const sample = useMemo(() => sampleOrder(s), [s]);
  const pct = (v: string) => Math.min(30, Math.max(0, Number(v.replace(/[^\d.]/g, '')) || 0));
  return (
    <div className="grid2">
      <div className="stack">
      <div className="card">
        <div className="card-h"><h3>Receipt details</h3></div>
        <div className="field"><label htmlFor="sn">Restaurant name</label><input id="sn" className="in" value={s.name} onChange={e => set({ name: e.target.value })} /></div>
        <div className="field"><label htmlFor="sa">Address</label><input id="sa" className="in" value={s.address} onChange={e => set({ address: e.target.value })} /></div>
        <div className="field"><label htmlFor="sp">Phone</label><input id="sp" className="in" value={s.phone} onChange={e => set({ phone: e.target.value })} /></div>
        <div className="field"><label htmlFor="sf">Footer message</label><input id="sf" className="in" value={s.footer} onChange={e => set({ footer: e.target.value })} /></div>
        <div className="two">
          <div className="field"><label htmlFor="st">Sales tax (%)</label><input id="st" className="in" inputMode="decimal" value={s.tax} onChange={e => set({ tax: pct(e.target.value) })} /></div>
          <div className="field"><label htmlFor="ss">Dine-in service charge (%)</label><input id="ss" className="in" inputMode="decimal" value={s.service} onChange={e => set({ service: pct(e.target.value) })} /></div>
        </div>
        <p className="muted fine">Changes apply to new orders. Orders already placed keep the rates they were billed with.</p>
      </div>
      <PrintingCard />
      <DataCard />
      </div>
      <div className="preview">
        <span className="muted">Live receipt preview</span>
        <Slip rows={customerRows(sample, s)} kind="customer" />
      </div>
    </div>
  );
}

function PrintingCard() {
  const { S, setS, print } = useApp();
  const s = S.settings;
  const bridge = window.posPrint;
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge.listPrinters().then(l => { if (alive) setPrinters(l); }).catch(() => undefined);
    return () => { alive = false; };
  }, [bridge]);
  const set = (p: Partial<Settings>) => {
    api.updateSettings({ ...s, ...p });
    setS(st => ({ ...st, settings: { ...st.settings, ...p } }));
  };
  const def = printers.find(p => p.isDefault);
  return (
    <div className="card">
      <div className="card-h"><h3>Printing</h3><Pill tone={bridge ? 'good' : 'mute'}>{bridge ? 'Desktop app' : 'Browser'}</Pill></div>
      <div className="field"><label>Paper width</label>
        <Seg value={s.paper} onChange={v => set({ paper: v })} options={[['80', '80 mm roll'], ['58', '58 mm roll']]} /></div>
      {bridge ? (
        <div className="field"><label htmlFor="pr">Receipt printer</label>
          <select id="pr" className="in" value={s.printer} onChange={e => set({ printer: e.target.value })}>
            <option value="">{'System default' + (def ? ' (' + def.name + ')' : '')}</option>
            {printers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select></div>
      ) : (
        <p className="muted fine">Running in a browser, so slips open the normal print dialog. The desktop app prints straight to the receipt printer with no dialog.</p>
      )}
      <div className="setrow"><div><b>Print automatically</b><span className="muted">Kitchen copy when an order is sent. Both slips when it is paid.</span></div>
        <Switch on={s.autoPrint} label="Print automatically" onChange={v => set({ autoPrint: v })} /></div>
      <button className="btn" onClick={() => print(sampleOrder(s), 'both', 'Test slips sent to the printer')}>Print test slips</button>
    </div>
  );
}

function DataCard() {
  const { setS, toast } = useApp();
  const [sure, setSure] = useState(false);
  return (
    <div className="card">
      <div className="card-h"><h3>Data on this computer</h3></div>
      <p className="muted fine">Orders, menu and settings are saved on this computer and work with no internet. Card and wallet payments need internet. Cash does not.</p>
      {sure ? (
        <div className="row-gap">
          <button className="btn danger" onClick={() => {
            api.resetDatabase();
            setS(s => ({ ...initState(), session: s.session, dbConnected: true }));
            setSure(false);
            toast('Sample data restored and synced with MSSQL');
          }}>Erase and restore sample data</button>
          <button className="btn ghost" onClick={() => setSure(false)}>Cancel</button>
        </div>
      ) : <button className="btn" onClick={() => setSure(true)}>Reset to sample data</button>}
    </div>
  );
}

/* ============================== admin panel ============================== */
type AView = 'overview' | 'restaurants' | 'tickets' | 'maintenance';
function AdminApp() {
  const { S } = useApp();
  const [view, setView] = useState<AView>('overview');
  const openT = S.tickets.filter(t => t.status !== 'resolved').length;
  const nav: NavItem[] = [
    { k: 'overview', label: 'Overview', icon: 'grid' },
    { k: 'restaurants', label: 'Restaurants', icon: 'store' },
    { k: 'tickets', label: 'Support tickets', icon: 'ticket', badge: openT },
    { k: 'maintenance', label: 'Maintenance', icon: 'wrench' },
  ];
  const titles: Record<AView, [string, string]> = {
    overview: ['Overview', 'Health of every restaurant on ' + BRAND],
    restaurants: ['Restaurants', 'Licenses, versions and access'],
    tickets: ['Support tickets', 'Bugs and requests from restaurants'],
    maintenance: ['Maintenance', 'Maintenance mode, gateway, feature flags and audit log'],
  };
  return (
    <Shell admin nav={nav} view={view} setView={v => setView(v as AView)} title={titles[view][0]} sub={titles[view][1]}>
      {view === 'overview' && <AdminOverview go={setView} />}
      {view === 'restaurants' && <AdminTenants />}
      {view === 'tickets' && <AdminTickets />}
      {view === 'maintenance' && <AdminMaintenance />}
    </Shell>
  );
}

const sevTone = (s: Ticket['sev']): Tone => (s === 'critical' ? 'bad' : s === 'high' ? 'warn' : 'mute');
const tStatusLabel = (s: Ticket['status']) => (s === 'progress' ? 'In progress' : cap(s));

function AdminOverview({ go }: { go: (v: AView) => void }) {
  const { S } = useApp();
  const mrr = S.tenants.filter(t => t.status === 'active').reduce((a, t) => a + PRICE[t.plan], 0);
  const activeN = S.tenants.filter(t => t.status === 'active').length;
  const openT = S.tickets.filter(t => t.status !== 'resolved');
  const crit = openT.filter(t => t.sev === 'critical');
  const today = 1180 + S.orders.length;
  const days = [812, 905, 870, 960, 1104, 1210, 1156, 934, 998, 1020, 1088, 1190, 1245];
  const data = [...days, today].map((v, i, a) => ({ label: i === a.length - 1 ? 'Today' : String(i + 1), v, hi: i === a.length - 1 }));
  const attn: { tone: Tone; text: string; go?: AView }[] = [];
  if (S.gatewayDown) attn.push({ tone: 'bad', text: 'Payment gateway outage is being simulated', go: 'maintenance' });
  crit.forEach(t => attn.push({ tone: 'bad', text: t.id + ': ' + t.title, go: 'tickets' }));
  S.tenants.filter(t => t.status === 'suspended').forEach(t => attn.push({ tone: 'bad', text: t.name + ' is suspended', go: 'restaurants' }));
  S.tenants.filter(t => t.licenseDays > 0 && t.licenseDays <= 14).forEach(t => attn.push({ tone: 'warn', text: t.name + ': license ends in ' + t.licenseDays + ' days', go: 'restaurants' }));
  if (S.maint !== 'off') attn.push({ tone: 'warn', text: 'Maintenance mode is on for all restaurants', go: 'maintenance' });
  const health: [string, Tone, string][] = [
    ['Sync API', 'good', 'Operational'], ['Database', 'good', 'Operational'],
    [sandbox.name, S.gatewayDown ? 'bad' : 'good', S.gatewayDown ? 'Outage' : 'Operational'],
    ['Receipt printing service', 'good', 'Operational'],
  ];
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Active restaurants" value={String(activeN)} sub={S.tenants.length + ' total, ' + S.tenants.filter(t => t.status === 'trial').length + ' on trial'} />
        <Kpi label="Monthly recurring revenue" value={money(mrr)} />
        <Kpi label="Orders today" value={num(today)} sub="across all restaurants" />
        <Kpi label="Open tickets" value={String(openT.length)} sub={crit.length + ' critical'} tone={crit.length ? 'bad' : undefined} />
      </div>
      <div className="grid2 wide-left">
        <div className="card">
          <div className="card-h"><h3>Orders per day</h3><span className="muted">Last 14 days · sample data</span></div>
          <Bars data={data} fmt={compact} />
        </div>
        <div className="card">
          <div className="card-h"><h3>Needs attention</h3></div>
          {attn.length === 0 ? <p className="empty sm">All clear.</p> : (
            <ul className="attn">{attn.map((a, i) => (
              <li key={i}><Pill tone={a.tone}>{a.tone === 'bad' ? 'Urgent' : 'Soon'}</Pill><span>{a.text}</span>{a.go && <button className="link sm" onClick={() => go(a.go as AView)}>Open</button>}</li>
            ))}</ul>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h3>System status</h3></div>
        <ul className="health">{health.map(h => <li key={h[0]}><span>{h[0]}</span><Pill tone={h[1]}>{h[2]}</Pill></li>)}</ul>
      </div>
    </div>
  );
}

function AdminTenants() {
  const { S, setS, now, audit } = useApp();
  const upd = (id: string, p: Partial<Tenant>) => {
    api.updateTenant(id, p);
    setS(s => ({ ...s, tenants: s.tenants.map(t => (t.id === id ? { ...t, ...p } : t)) }));
  };
  return (
    <div className="card flush">
      <div className="tablewrap">
        <table>
          <thead><tr><th>Restaurant</th><th>Plan</th><th>Status</th><th className="r">Branches</th><th>Version</th><th>Last sync</th><th>License</th><th /></tr></thead>
          <tbody>
            {S.tenants.map(t => (
              <tr key={t.id}>
                <td><b>{t.name}</b><div className="muted">{t.city}</div></td>
                <td>{t.plan}<div className="muted">{money(PRICE[t.plan])} / month</div></td>
                <td><Pill tone={t.status === 'active' ? 'good' : t.status === 'trial' ? 'info' : 'bad'}>{cap(t.status)}</Pill></td>
                <td className="r">{t.branches}</td>
                <td className="mono">{t.version}</td>
                <td>{ago(now - t.sync * 60000, now)}</td>
                <td><Pill tone={t.licenseDays <= 0 ? 'bad' : t.licenseDays <= 14 ? 'warn' : 'mute'}>{t.licenseDays > 0 ? t.licenseDays + ' days' : 'Expired ' + -t.licenseDays + ' d ago'}</Pill></td>
                <td className="r nowrap">
                  <button className="btn sm ghost" onClick={() => { upd(t.id, { licenseDays: Math.max(0, t.licenseDays) + 30 }); audit('Extended license for ' + t.name + ' by 30 days'); }}>+30 days</button>
                  {t.status === 'suspended'
                    ? <button className="btn sm" onClick={() => { upd(t.id, { status: 'active', licenseDays: t.licenseDays > 0 ? t.licenseDays : 30 }); audit('Reactivated ' + t.name); }}>Activate</button>
                    : <button className="btn sm danger" onClick={() => { upd(t.id, { status: 'suspended' }); audit('Suspended ' + t.name); }}>Suspend</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted fine pad">Suspending a restaurant blocks its staff at the next sign-in. Try it, then open the restaurant panel.</p>
    </div>
  );
}

function AdminTickets() {
  const { S, setS, now, audit } = useApp();
  const [f, setF] = useState<'all' | Ticket['status']>('all');
  const list = S.tickets.filter(t => f === 'all' || t.status === f);
  const name = (id: string) => (S.tenants.find(t => t.id === id) || { name: id }).name;
  const setStatus = (t: Ticket, status: Ticket['status']) => {
    api.updateTicketStatus(t.id, status);
    setS(s => ({ ...s, tickets: s.tickets.map(x => (x.id === t.id ? { ...x, status } : x)) }));
    audit(t.id + ' marked ' + tStatusLabel(status).toLowerCase());
  };
  return (
    <div className="stack">
      <Seg value={f} onChange={setF} options={[['all', 'All'], ['open', 'Open'], ['progress', 'In progress'], ['resolved', 'Resolved']]} />
      <div className="card flush">
        <div className="tablewrap">
          <table>
            <thead><tr><th>Ticket</th><th>Restaurant</th><th>Severity</th><th>Source</th><th>Opened</th><th>Status</th></tr></thead>
            <tbody>
              {list.map(t => (
                <tr key={t.id}>
                  <td className="tcell"><b>{t.title}</b><div className="muted">{t.id} · {t.detail}</div></td>
                  <td>{name(t.tid)}</td>
                  <td><Pill tone={sevTone(t.sev)}>{cap(t.sev)}</Pill></td>
                  <td className="muted">{t.src}</td>
                  <td>{ago(t.at, now)}</td>
                  <td><select className="in sm" aria-label={'Status of ' + t.id} value={t.status} onChange={e => setStatus(t, e.target.value as Ticket['status'])}>
                    <option value="open">Open</option><option value="progress">In progress</option><option value="resolved">Resolved</option>
                  </select></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="empty sm">No tickets in this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminMaintenance() {
  const { S, setS, now, audit } = useApp();
  const versions: Record<string, number> = {};
  S.tenants.forEach(t => { versions[t.version] = (versions[t.version] || 0) + 1; });
  const flagRows: [keyof Flags, string, string][] = [
    ['wallet', 'Mobile wallet payments', 'Shows the wallet option at checkout.'],
    ['delivery', 'Delivery orders', 'Adds Delivery next to Dine-in and Takeaway.'],
    ['discount', 'Discounts', 'Shows the discount selector on the bill.'],
  ];
  const setMaint = (m: Maint) => {
    api.updateSystem({ maint: m });
    setS(s => ({ ...s, maint: m }));
    audit('Maintenance mode set to ' + (m === 'off' ? 'off' : m === 'notice' ? 'notice only' : 'read-only'));
  };
  return (
    <div className="grid2">
      <div className="card">
        <div className="card-h"><h3>Maintenance mode</h3><Pill tone={S.maint === 'off' ? 'good' : 'warn'}>{S.maint === 'off' ? 'Off' : S.maint === 'notice' ? 'Notice' : 'Read-only'}</Pill></div>
        <Seg value={S.maint} onChange={setMaint} options={[['off', 'Off'], ['notice', 'Notice only'], ['readonly', 'Read-only']]} />
        <div className="field"><label htmlFor="mm">Message shown to restaurants</label>
          <textarea id="mm" className="in" rows={3} value={S.maintMsg} onChange={e => {
            const msg = e.target.value;
            api.updateSystem({ maintMsg: msg });
            setS(s => ({ ...s, maintMsg: msg }));
          }} /></div>
        <p className="muted fine">Notice shows a banner. Read-only also pauses new orders and payments. Open the restaurant panel to see it.</p>
      </div>
      <div className="card">
        <div className="card-h"><h3>Payment gateway</h3><Pill tone={S.gatewayDown ? 'bad' : 'good'}>{S.gatewayDown ? 'Outage' : 'Operational'}</Pill></div>
        <div className="setrow"><div><b>{sandbox.name}</b><span className="muted">Provider adapter in use. Real gateways plug into the same interface.</span></div></div>
        <div className="setrow"><div><b>Simulate an outage</b><span className="muted">Card and wallet payments fail with a clear error. Cash keeps working.</span></div>
          <Switch on={S.gatewayDown} label="Simulate gateway outage" onChange={v => {
            api.updateSystem({ gatewayDown: v });
            setS(s => ({ ...s, gatewayDown: v }));
            audit(v ? 'Started gateway outage simulation' : 'Ended gateway outage simulation');
          }} /></div>
      </div>
      <div className="card">
        <div className="card-h"><h3>Feature flags</h3><span className="muted">Apply to all restaurants</span></div>
        {flagRows.map(f => (
          <div className="setrow" key={f[0]}>
            <div><b>{f[1]}</b><span className="muted">{f[2]}</span></div>
            <Switch on={S.flags[f[0]]} label={f[1]} onChange={v => {
              const updatedFlags = { ...S.flags, [f[0]]: v };
              api.updateSystem({ flags: updatedFlags });
              setS(s => ({ ...s, flags: updatedFlags }));
              audit((v ? 'Enabled ' : 'Disabled ') + f[1].toLowerCase());
            }} />
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-h"><h3>Versions in the field</h3></div>
        {Object.keys(versions).sort().reverse().map(v => <HRow key={v} label={'v' + v} v={versions[v]} max={S.tenants.length} right={versions[v] + (versions[v] === 1 ? ' restaurant' : ' restaurants')} />)}
        <h3 className="sub-h">Audit log</h3>
        <ul className="audit">{S.audit.slice(0, 8).map((a, i) => <li key={i}><span className="muted">{ago(a.at, now)}</span><span>{a.text}</span><span className="muted mono">{a.actor}</span></li>)}</ul>
      </div>
    </div>
  );
}
