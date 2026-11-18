import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';

let sqlDriver: any = sql;
try {
  sqlDriver = require('mssql/msnodesqlv8');
} catch {
  sqlDriver = sql;
}

export { sql, sqlDriver };

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const server = process.env.DB_SERVER || '.\\SQLEXPRESS';
const database = process.env.DB_NAME || 'DineDeskDB';
const driver = process.env.DB_DRIVER || 'ODBC Driver 18 for SQL Server';
const trustCert = process.env.DB_TRUST_SERVER_CERTIFICATE || 'yes';
const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;

let connectionString = '';
if (user && password) {
  connectionString = `Driver={${driver}};Server=${server};Database=${database};Uid=${user};Pwd=${password};TrustServerCertificate=${trustCert};`;
} else {
  connectionString = `Driver={${driver}};Server=${server};Database=${database};Trusted_Connection=yes;TrustServerCertificate=${trustCert};`;
}

let pool: sql.ConnectionPool | null = null;

export async function getDbPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }
  try {
    const p = await new sqlDriver.ConnectionPool({ connectionString } as any).connect();
    pool = p;
    console.log(`[MSSQL] Connected successfully to ${server}/${database}`);
    return p;
  } catch (err) {
    console.error('[MSSQL] Connection error:', err);
    throw err;
  }
}

export async function initDb(): Promise<void> {
  const p = await getDbPool();

  // Create tables if not exist
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MenuItems')
    CREATE TABLE MenuItems (
      id NVARCHAR(50) PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      cat NVARCHAR(100) NOT NULL,
      available BIT NOT NULL DEFAULT 1
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Settings')
    CREATE TABLE Settings (
      id INT PRIMARY KEY DEFAULT 1,
      name NVARCHAR(200) NOT NULL,
      address NVARCHAR(500) NOT NULL,
      phone NVARCHAR(50) NOT NULL,
      tax DECIMAL(5, 2) NOT NULL DEFAULT 13,
      service DECIMAL(5, 2) NOT NULL DEFAULT 5,
      footer NVARCHAR(500) NOT NULL,
      autoPrint BIT NOT NULL DEFAULT 0,
      printer NVARCHAR(200) NOT NULL DEFAULT '',
      paper NVARCHAR(10) NOT NULL DEFAULT '80'
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
    CREATE TABLE Orders (
      no INT PRIMARY KEY,
      type NVARCHAR(20) NOT NULL,
      [table] NVARCHAR(50) NOT NULL DEFAULT '',
      customer NVARCHAR(200) NOT NULL DEFAULT '',
      discountPct DECIMAL(5, 2) NOT NULL DEFAULT 0,
      taxPct DECIMAL(5, 2) NOT NULL DEFAULT 0,
      svcPct DECIMAL(5, 2) NOT NULL DEFAULT 0,
      sub DECIMAL(10, 2) NOT NULL DEFAULT 0,
      discount DECIMAL(10, 2) NOT NULL DEFAULT 0,
      service DECIMAL(10, 2) NOT NULL DEFAULT 0,
      tax DECIMAL(10, 2) NOT NULL DEFAULT 0,
      total DECIMAL(10, 2) NOT NULL DEFAULT 0,
      status NVARCHAR(20) NOT NULL DEFAULT 'new',
      paid BIT NOT NULL DEFAULT 0,
      payMethod NVARCHAR(20) NULL,
      payRef NVARCHAR(100) NULL,
      payLast4 NVARCHAR(10) NULL,
      payTendered DECIMAL(10, 2) NULL,
      payChange DECIMAL(10, 2) NULL,
      createdAt BIGINT NOT NULL,
      cashier NVARCHAR(100) NOT NULL
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderLines')
    CREATE TABLE OrderLines (
      id INT IDENTITY(1,1) PRIMARY KEY,
      orderNo INT NOT NULL FOREIGN KEY REFERENCES Orders(no) ON DELETE CASCADE,
      lineId NVARCHAR(50) NOT NULL,
      name NVARCHAR(200) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      qty INT NOT NULL,
      note NVARCHAR(500) NOT NULL DEFAULT ''
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Tenants')
    CREATE TABLE Tenants (
      id NVARCHAR(50) PRIMARY KEY,
      name NVARCHAR(200) NOT NULL,
      city NVARCHAR(100) NOT NULL,
      [plan] NVARCHAR(50) NOT NULL,
      status NVARCHAR(50) NOT NULL,
      branches INT NOT NULL DEFAULT 1,
      version NVARCHAR(50) NOT NULL DEFAULT '2.4.1',
      sync INT NOT NULL DEFAULT 0,
      licenseDays INT NOT NULL DEFAULT 30
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Tickets')
    CREATE TABLE Tickets (
      id NVARCHAR(50) PRIMARY KEY,
      tid NVARCHAR(50) NOT NULL,
      title NVARCHAR(255) NOT NULL,
      detail NVARCHAR(MAX) NOT NULL,
      sev NVARCHAR(50) NOT NULL DEFAULT 'normal',
      status NVARCHAR(50) NOT NULL DEFAULT 'open',
      createdAt BIGINT NOT NULL,
      src NVARCHAR(100) NOT NULL DEFAULT 'POS report'
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditLogs')
    CREATE TABLE AuditLogs (
      id INT IDENTITY(1,1) PRIMARY KEY,
      createdAt BIGINT NOT NULL,
      actor NVARCHAR(100) NOT NULL,
      text NVARCHAR(500) NOT NULL
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SystemState')
    CREATE TABLE SystemState (
      id INT PRIMARY KEY DEFAULT 1,
      wallet BIT NOT NULL DEFAULT 1,
      delivery BIT NOT NULL DEFAULT 1,
      discount BIT NOT NULL DEFAULT 1,
      maint NVARCHAR(50) NOT NULL DEFAULT 'off',
      maintMsg NVARCHAR(500) NOT NULL DEFAULT '',
      gatewayDown BIT NOT NULL DEFAULT 0,
      nextNo INT NOT NULL DEFAULT 1045,
      nextTicket INT NOT NULL DEFAULT 2045
    );
  `);

  // Check if we need to seed
  await seedIfEmpty(p);
}

const RAW_MENU: [string, number, string, boolean][] = [
  ['Chicken Samosa (3 pcs)', 250, 'Starters', true],
  ['Dahi Bhallay', 320, 'Starters', true],
  ['Chana Chaat', 280, 'Starters', true],
  ['Hot Wings (6 pcs)', 690, 'Starters', true],
  ['Chicken Tikka (Leg)', 480, 'BBQ & Grill', true],
  ['Seekh Kabab (4 pcs)', 780, 'BBQ & Grill', true],
  ['Malai Boti', 950, 'BBQ & Grill', true],
  ['Beef Bihari Boti', 1150, 'BBQ & Grill', true],
  ['Mutton Chops (4 pcs)', 1850, 'BBQ & Grill', false],
  ['Chicken Karahi (Half)', 1650, 'Karahi & Curries', true],
  ['Chicken Karahi (Full)', 3100, 'Karahi & Curries', true],
  ['Mutton Karahi (Half)', 2450, 'Karahi & Curries', true],
  ['Nihari', 1250, 'Karahi & Curries', true],
  ['Daal Mash', 650, 'Karahi & Curries', true],
  ['Haleem', 700, 'Karahi & Curries', false],
  ['Chicken Biryani', 650, 'Rice & Bread', true],
  ['Plain Rice', 300, 'Rice & Bread', true],
  ['Naan', 70, 'Rice & Bread', true],
  ['Garlic Naan', 120, 'Rice & Bread', true],
  ['Roghni Naan', 110, 'Rice & Bread', true],
  ['Paratha', 90, 'Rice & Bread', true],
  ['Mint Margarita', 350, 'Drinks', true],
  ['Sweet Lassi', 300, 'Drinks', true],
  ['Soft Drink (345 ml)', 120, 'Drinks', true],
  ['Mineral Water', 100, 'Drinks', true],
  ['Doodh Patti Chai', 180, 'Drinks', true],
  ['Kashmiri Chai', 280, 'Drinks', true],
  ['Gulab Jamun (2 pcs)', 250, 'Desserts', true],
  ['Kheer', 280, 'Desserts', true],
  ['Gajar Halwa', 350, 'Desserts', true],
];

export async function seedIfEmpty(p: sql.ConnectionPool): Promise<void> {
  const menuCountRes = await p.request().query('SELECT COUNT(*) as cnt FROM MenuItems');
  if (menuCountRes.recordset[0].cnt === 0) {
    console.log('[MSSQL] Seeding initial menu items...');
    for (let i = 0; i < RAW_MENU.length; i++) {
      const [name, price, cat, available] = RAW_MENU[i];
      const id = 'm' + (i + 1);
      const req = p.request();
      req.input('id', sql.NVarChar(50), id);
      req.input('name', sql.NVarChar(200), name);
      req.input('price', sql.Decimal(10, 2), price);
      req.input('cat', sql.NVarChar(100), cat);
      req.input('available', sql.Bit, available ? 1 : 0);
      await req.query(`INSERT INTO MenuItems (id, name, price, cat, available) VALUES (@id, @name, @price, @cat, @available)`);
    }
  }

  const setCntRes = await p.request().query('SELECT COUNT(*) as cnt FROM Settings');
  if (setCntRes.recordset[0].cnt === 0) {
    console.log('[MSSQL] Seeding initial settings...');
    await p.request().query(`
      INSERT INTO Settings (id, name, address, phone, tax, service, footer, autoPrint, printer, paper)
      VALUES (1, 'Karachi Tandoor House', 'Shop 14, Clifton Block 5, Karachi', '021-0000-0000', 13, 5, 'Thank you for dining with us!', 0, '', '80')
    `);
  }

  const sysCntRes = await p.request().query('SELECT COUNT(*) as cnt FROM SystemState');
  if (sysCntRes.recordset[0].cnt === 0) {
    console.log('[MSSQL] Seeding initial system state...');
    await p.request().query(`
      INSERT INTO SystemState (id, wallet, delivery, discount, maint, maintMsg, gatewayDown, nextNo, nextTicket)
      VALUES (1, 1, 1, 1, 'off', 'Scheduled maintenance tonight 03:00 to 03:30. Billing stays available.', 0, 1045, 2045)
    `);
  }

  const tenCntRes = await p.request().query('SELECT COUNT(*) as cnt FROM Tenants');
  if (tenCntRes.recordset[0].cnt === 0) {
    console.log('[MSSQL] Seeding initial tenants...');
    const tenants = [
      ['t1', 'Karachi Tandoor House', 'Karachi', 'Pro', 'active', 2, '2.4.1', 2, 212],
      ['t2', 'Lahore Chai Point', 'Lahore', 'Starter', 'active', 1, '2.4.1', 5, 41],
      ['t3', 'Gulberg Grill Co.', 'Lahore', 'Chain', 'active', 5, '2.4.0', 1, 318],
      ['t4', 'Burns Road Kitchen', 'Karachi', 'Pro', 'active', 1, '2.4.1', 9, 12],
      ['t5', 'Saddar Biryani Corner', 'Karachi', 'Starter', 'trial', 1, '2.4.1', 14, 6],
      ['t6', 'Hill Cafe Islamabad', 'Islamabad', 'Pro', 'active', 2, '2.4.1', 3, 96],
      ['t7', 'Rabri House Hyderabad', 'Hyderabad', 'Starter', 'suspended', 1, '2.3.8', 20160, -18],
    ];
    for (const t of tenants) {
      const req = p.request();
      req.input('id', sql.NVarChar(50), t[0]);
      req.input('name', sql.NVarChar(200), t[1]);
      req.input('city', sql.NVarChar(100), t[2]);
      req.input('plan', sql.NVarChar(50), t[3]);
      req.input('status', sql.NVarChar(50), t[4]);
      req.input('branches', sql.Int, t[5]);
      req.input('version', sql.NVarChar(50), t[6]);
      req.input('sync', sql.Int, t[7]);
      req.input('licenseDays', sql.Int, t[8]);
      await req.query(`INSERT INTO Tenants (id, name, city, [plan], status, branches, version, sync, licenseDays)
        VALUES (@id, @name, @city, @plan, @status, @branches, @version, @sync, @licenseDays)`);
    }
  }

  const tckCntRes = await p.request().query('SELECT COUNT(*) as cnt FROM Tickets');
  if (tckCntRes.recordset[0].cnt === 0) {
    console.log('[MSSQL] Seeding initial tickets...');
    const now = Date.now();
    const m = 60000;
    const tickets = [
      ['TCK-2041', 't5', 'Cannot sign in on the new tablet', 'Cashier gets "invalid session" after the first login.', 'normal', 'resolved', now - 2880 * m, 'Email'],
      ['TCK-2040', 't4', 'Add a "Family deals" menu category', 'Wants bundles with a fixed price shown as one line.', 'normal', 'open', now - 600 * m, 'POS report'],
      ['TCK-2039', 't3', 'Card payments time out at peak hours', 'About 1 in 8 card charges fails with a timeout between 8 and 10 pm.', 'critical', 'open', now - 190 * m, 'Monitoring'],
      ['TCK-2038', 't2', 'Printer prints a blank slip after update', 'Customer receipt is blank on the 80 mm printer, kitchen copy is fine.', 'high', 'progress', now - 1500 * m, 'POS report'],
      ['TCK-2036', 't6', 'Daily report shows the wrong tax total', 'Tax column excludes service charge on dine-in orders.', 'high', 'resolved', now - 5760 * m, 'POS report'],
    ];
    for (const tk of tickets) {
      const req = p.request();
      req.input('id', sql.NVarChar(50), tk[0]);
      req.input('tid', sql.NVarChar(50), tk[1]);
      req.input('title', sql.NVarChar(255), tk[2]);
      req.input('detail', sql.NVarChar(sql.MAX), tk[3]);
      req.input('sev', sql.NVarChar(50), tk[4]);
      req.input('status', sql.NVarChar(50), tk[5]);
      req.input('createdAt', sql.BigInt, tk[6]);
      req.input('src', sql.NVarChar(100), tk[7]);
      await req.query(`INSERT INTO Tickets (id, tid, title, detail, sev, status, createdAt, src)
        VALUES (@id, @tid, @title, @detail, @sev, @status, @createdAt, @src)`);
    }
  }

  const audCntRes = await p.request().query('SELECT COUNT(*) as cnt FROM AuditLogs');
  if (audCntRes.recordset[0].cnt === 0) {
    console.log('[MSSQL] Seeding initial audit logs...');
    const now = Date.now();
    const m = 60000;
    const audits = [
      [now - 300 * m, 'dev@dinedesk.io', 'Released v2.4.1 to all restaurants'],
      [now - 1900 * m, 'dev@dinedesk.io', 'Extended license for Burns Road Kitchen by 30 days'],
      [now - 8000 * m, 'system', 'Suspended Rabri House Hyderabad: license expired'],
    ];
    for (const a of audits) {
      const req = p.request();
      req.input('createdAt', sql.BigInt, a[0]);
      req.input('actor', sql.NVarChar(100), a[1]);
      req.input('text', sql.NVarChar(500), a[2]);
      await req.query(`INSERT INTO AuditLogs (createdAt, actor, text) VALUES (@createdAt, @actor, @text)`);
    }
  }

  const ordCntRes = await p.request().query('SELECT COUNT(*) as cnt FROM Orders');
  if (ordCntRes.recordset[0].cnt === 0) {
    console.log('[MSSQL] Seeding sample orders...');
    const now = Date.now();
    // Seed sample orders
    await seedOrdersHelper(p, now);
  }
}

async function seedOrdersHelper(p: sql.ConnectionPool, now: number): Promise<void> {
  const menuRes = await p.request().query('SELECT * FROM MenuItems WHERE available = 1');
  const pool = menuRes.recordset;
  if (!pool.length) return;

  let seed = 11;
  const r = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const statuses = ['new', 'new', 'preparing', 'preparing', 'ready'];

  for (let i = 0; i < 40; i++) {
    const orderNo = 1001 + i;
    const active = i < 5;
    const mins = active ? 3 + i * 7 : 40 + (((i - 5) * 53) % 650);
    const type = r() < 0.62 ? 'dine-in' : r() < 0.6 ? 'takeaway' : 'delivery';
    const table = type === 'dine-in' ? 'T' + (1 + Math.floor(r() * 12)) : '';
    const numLines = 2 + Math.floor(r() * 4);
    const lines: Array<{ id: string; name: string; price: number; qty: number; note: string }> = [];

    for (let k = 0; k < numLines; k++) {
      const m = pool[Math.floor(r() * pool.length)];
      if (!lines.find(l => l.id === m.id)) {
        lines.push({ id: m.id, name: m.name, price: Number(m.price), qty: 1 + Math.floor(r() * 3), note: '' });
      }
    }

    const discountPct = r() < 0.12 ? 10 : 0;
    const sub = lines.reduce((a, l) => a + l.price * l.qty, 0);
    const discount = Math.round((sub * discountPct) / 100);
    const base = sub - discount;
    const service = type === 'dine-in' ? Math.round((base * 5) / 100) : 0;
    const tax = Math.round(((base + service) * 13) / 100);
    const total = base + service + tax;

    const paid = active ? i % 2 === 1 : true;
    const x = r();
    const method = x < 0.45 ? 'cash' : x < 0.85 ? 'card' : 'wallet';
    const ref = method === 'cash' ? null : 'SBX-' + Math.floor(r() * 1e6).toString(36).toUpperCase().padStart(5, '0');
    const last4 = method === 'card' ? String(1000 + Math.floor(r() * 8999)) : null;
    const status = active ? statuses[i] : 'served';
    const createdAt = now - mins * 60000;
    const cashier = r() < 0.7 ? 'Ayesha' : 'Hamza';

    const req = p.request();
    req.input('no', sql.Int, orderNo);
    req.input('type', sql.NVarChar(20), type);
    req.input('table', sql.NVarChar(50), table);
    req.input('customer', sql.NVarChar(200), '');
    req.input('discountPct', sql.Decimal(5, 2), discountPct);
    req.input('taxPct', sql.Decimal(5, 2), 13);
    req.input('svcPct', sql.Decimal(5, 2), 5);
    req.input('sub', sql.Decimal(10, 2), sub);
    req.input('discount', sql.Decimal(10, 2), discount);
    req.input('service', sql.Decimal(10, 2), service);
    req.input('tax', sql.Decimal(10, 2), tax);
    req.input('total', sql.Decimal(10, 2), total);
    req.input('status', sql.NVarChar(20), status);
    req.input('paid', sql.Bit, paid ? 1 : 0);
    req.input('payMethod', sql.NVarChar(20), paid ? method : null);
    req.input('payRef', sql.NVarChar(100), paid ? ref : null);
    req.input('payLast4', sql.NVarChar(10), paid ? last4 : null);
    req.input('payTendered', sql.Decimal(10, 2), null);
    req.input('payChange', sql.Decimal(10, 2), null);
    req.input('createdAt', sql.BigInt, createdAt);
    req.input('cashier', sql.NVarChar(100), cashier);

    await req.query(`
      INSERT INTO Orders (no, type, [table], customer, discountPct, taxPct, svcPct, sub, discount, service, tax, total, status, paid, payMethod, payRef, payLast4, payTendered, payChange, createdAt, cashier)
      VALUES (@no, @type, @table, @customer, @discountPct, @taxPct, @svcPct, @sub, @discount, @service, @tax, @total, @status, @paid, @payMethod, @payRef, @payLast4, @payTendered, @payChange, @createdAt, @cashier)
    `);

    for (const line of lines) {
      const lineReq = p.request();
      lineReq.input('orderNo', sql.Int, orderNo);
      lineReq.input('lineId', sql.NVarChar(50), line.id);
      lineReq.input('name', sql.NVarChar(200), line.name);
      lineReq.input('price', sql.Decimal(10, 2), line.price);
      lineReq.input('qty', sql.Int, line.qty);
      lineReq.input('note', sql.NVarChar(500), line.note);
      await lineReq.query(`
        INSERT INTO OrderLines (orderNo, lineId, name, price, qty, note)
        VALUES (@orderNo, @lineId, @name, @price, @qty, @note)
      `);
    }
  }

  // Update nextNo in SystemState
  await p.request().query(`UPDATE SystemState SET nextNo = 1045 WHERE id = 1`);
}

export default {
  getDbPool,
  initDb,
};
