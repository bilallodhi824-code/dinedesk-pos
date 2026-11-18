import { Router, Request, Response } from 'express';
import { getDbPool, seedIfEmpty } from '../db';
import sql from 'mssql';

const router = Router();

// GET /api/system
router.get('/system', async (_req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request().query('SELECT * FROM SystemState WHERE id = 1');
    if (!result.recordset.length) {
      return res.status(404).json({ error: 'System state not found' });
    }
    const row = result.recordset[0];
    res.json({
      flags: {
        wallet: Boolean(row.wallet),
        delivery: Boolean(row.delivery),
        discount: Boolean(row.discount),
      },
      maint: row.maint,
      maintMsg: row.maintMsg,
      gatewayDown: Boolean(row.gatewayDown),
      nextNo: Number(row.nextNo),
      nextTicket: Number(row.nextTicket),
    });
  } catch (err) {
    console.error('Error fetching system state:', err);
    res.status(500).json({ error: 'Failed to fetch system state' });
  }
});

// PUT /api/system
router.put('/system', async (req: Request, res: Response) => {
  try {
    const { flags, maint, maintMsg, gatewayDown } = req.body;
    const p = await getDbPool();

    const currRes = await p.request().query('SELECT * FROM SystemState WHERE id = 1');
    const curr = currRes.recordset[0] || {};

    const wallet = flags?.wallet !== undefined ? (flags.wallet ? 1 : 0) : curr.wallet;
    const delivery = flags?.delivery !== undefined ? (flags.delivery ? 1 : 0) : curr.delivery;
    const discount = flags?.discount !== undefined ? (flags.discount ? 1 : 0) : curr.discount;
    const newMaint = maint !== undefined ? maint : curr.maint;
    const newMsg = maintMsg !== undefined ? maintMsg : curr.maintMsg;
    const newGwDown = gatewayDown !== undefined ? (gatewayDown ? 1 : 0) : curr.gatewayDown;

    const r = p.request();
    r.input('wallet', sql.Bit, wallet);
    r.input('delivery', sql.Bit, delivery);
    r.input('discount', sql.Bit, discount);
    r.input('maint', sql.NVarChar(50), newMaint);
    r.input('maintMsg', sql.NVarChar(500), newMsg);
    r.input('gatewayDown', sql.Bit, newGwDown);

    await r.query(`
      UPDATE SystemState
      SET wallet = @wallet,
          delivery = @delivery,
          discount = @discount,
          maint = @maint,
          maintMsg = @maintMsg,
          gatewayDown = @gatewayDown
      WHERE id = 1
    `);

    res.json({
      flags: {
        wallet: Boolean(wallet),
        delivery: Boolean(delivery),
        discount: Boolean(discount),
      },
      maint: newMaint,
      maintMsg: newMsg,
      gatewayDown: Boolean(newGwDown),
    });
  } catch (err) {
    console.error('Error updating system state:', err);
    res.status(500).json({ error: 'Failed to update system state' });
  }
});

// GET /api/audit
router.get('/audit', async (_req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request().query('SELECT * FROM AuditLogs ORDER BY createdAt DESC');
    const logs = result.recordset.map((row: any) => ({
      at: Number(row.createdAt),
      actor: row.actor,
      text: row.text,
    }));
    res.json(logs);
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// POST /api/audit
router.post('/audit', async (req: Request, res: Response) => {
  try {
    const { actor, text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const at = Date.now();
    const p = await getDbPool();
    const r = p.request();
    r.input('createdAt', sql.BigInt, at);
    r.input('actor', sql.NVarChar(100), actor || 'system');
    r.input('text', sql.NVarChar(500), text);

    await r.query('INSERT INTO AuditLogs (createdAt, actor, text) VALUES (@createdAt, @actor, @text)');
    res.status(201).json({ at, actor: actor || 'system', text });
  } catch (err) {
    console.error('Error adding audit entry:', err);
    res.status(500).json({ error: 'Failed to add audit entry' });
  }
});

// POST /api/reset (Re-seed database)
router.post('/reset', async (_req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    await p.request().query(`
      DELETE FROM OrderLines;
      DELETE FROM Orders;
      DELETE FROM MenuItems;
      DELETE FROM Settings;
      DELETE FROM Tenants;
      DELETE FROM Tickets;
      DELETE FROM AuditLogs;
      DELETE FROM SystemState;
    `);
    await seedIfEmpty(p);
    res.json({ ok: true, message: 'Database reset to seed data' });
  } catch (err) {
    console.error('Error resetting database:', err);
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

export default router;
