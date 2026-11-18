import { Router, Request, Response } from 'express';
import { getDbPool } from '../db';
import sql from 'mssql/msnodesqlv8';

const router = Router();

// GET /api/settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request().query('SELECT * FROM Settings WHERE id = 1');
    if (!result.recordset.length) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    const row = result.recordset[0];
    res.json({
      name: row.name,
      address: row.address,
      phone: row.phone,
      tax: Number(row.tax),
      service: Number(row.service),
      footer: row.footer,
      autoPrint: Boolean(row.autoPrint),
      printer: row.printer || '',
      paper: row.paper || '80',
    });
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings
router.put('/', async (req: Request, res: Response) => {
  try {
    const { name, address, phone, tax, service, footer, autoPrint, printer, paper } = req.body;
    const p = await getDbPool();

    const currRes = await p.request().query('SELECT * FROM Settings WHERE id = 1');
    const curr = currRes.recordset[0] || {};

    const updated = {
      name: name !== undefined ? name : curr.name,
      address: address !== undefined ? address : curr.address,
      phone: phone !== undefined ? phone : curr.phone,
      tax: tax !== undefined ? Number(tax) : Number(curr.tax),
      service: service !== undefined ? Number(service) : Number(curr.service),
      footer: footer !== undefined ? footer : curr.footer,
      autoPrint: autoPrint !== undefined ? (autoPrint ? 1 : 0) : (curr.autoPrint ? 1 : 0),
      printer: printer !== undefined ? printer : (curr.printer || ''),
      paper: paper !== undefined ? paper : (curr.paper || '80'),
    };

    const r = p.request();
    r.input('name', sql.NVarChar(200), updated.name);
    r.input('address', sql.NVarChar(500), updated.address);
    r.input('phone', sql.NVarChar(50), updated.phone);
    r.input('tax', sql.Decimal(5, 2), updated.tax);
    r.input('service', sql.Decimal(5, 2), updated.service);
    r.input('footer', sql.NVarChar(500), updated.footer);
    r.input('autoPrint', sql.Bit, updated.autoPrint);
    r.input('printer', sql.NVarChar(200), updated.printer);
    r.input('paper', sql.NVarChar(10), updated.paper);

    await r.query(`
      UPDATE Settings
      SET name = @name,
          address = @address,
          phone = @phone,
          tax = @tax,
          service = @service,
          footer = @footer,
          autoPrint = @autoPrint,
          printer = @printer,
          paper = @paper
      WHERE id = 1
    `);

    res.json({
      name: updated.name,
      address: updated.address,
      phone: updated.phone,
      tax: updated.tax,
      service: updated.service,
      footer: updated.footer,
      autoPrint: Boolean(updated.autoPrint),
      printer: updated.printer,
      paper: updated.paper,
    });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
