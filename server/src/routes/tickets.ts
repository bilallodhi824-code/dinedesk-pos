import { Router, Request, Response } from 'express';
import { getDbPool } from '../db';
import sql from 'mssql';

const router = Router();

// GET /api/tickets
router.get('/', async (_req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request().query('SELECT * FROM Tickets ORDER BY createdAt DESC');
    const tickets = result.recordset.map((row: any) => ({
      id: row.id,
      tid: row.tid,
      title: row.title,
      detail: row.detail,
      sev: row.sev,
      status: row.status,
      at: Number(row.createdAt),
      src: row.src,
    }));
    res.json(tickets);
  } catch (err) {
    console.error('Error fetching tickets:', err);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// POST /api/tickets
router.post('/', async (req: Request, res: Response) => {
  try {
    const { tid, title, detail, sev, status, src } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const p = await getDbPool();
    let ticketId = req.body.id;
    if (!ticketId) {
      const sysRes = await p.request().query('SELECT nextTicket FROM SystemState WHERE id = 1');
      if (sysRes.recordset.length) {
        const nextTicket = sysRes.recordset[0].nextTicket;
        ticketId = 'TCK-' + nextTicket;
        await p.request().input('nextTicket', sql.Int, nextTicket + 1).query('UPDATE SystemState SET nextTicket = @nextTicket WHERE id = 1');
      } else {
        ticketId = 'TCK-' + Math.floor(1000 + Math.random() * 9000);
      }
    }

    const at = Date.now();
    const r = p.request();
    r.input('id', sql.NVarChar(50), ticketId);
    r.input('tid', sql.NVarChar(50), tid || 't1');
    r.input('title', sql.NVarChar(255), title.trim());
    r.input('detail', sql.NVarChar(sql.MAX), detail?.trim() || 'No details provided.');
    r.input('sev', sql.NVarChar(50), sev || 'normal');
    r.input('status', sql.NVarChar(50), status || 'open');
    r.input('createdAt', sql.BigInt, at);
    r.input('src', sql.NVarChar(100), src || 'POS report');

    await r.query(`
      INSERT INTO Tickets (id, tid, title, detail, sev, status, createdAt, src)
      VALUES (@id, @tid, @title, @detail, @sev, @status, @createdAt, @src)
    `);

    res.status(201).json({
      id: ticketId,
      tid: tid || 't1',
      title: title.trim(),
      detail: detail?.trim() || 'No details provided.',
      sev: sev || 'normal',
      status: status || 'open',
      at,
      src: src || 'POS report',
    });
  } catch (err) {
    console.error('Error creating ticket:', err);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// PATCH /api/tickets/:id/status
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });

    const p = await getDbPool();
    const r = p.request();
    r.input('id', sql.NVarChar(50), id);
    r.input('status', sql.NVarChar(50), status);
    await r.query('UPDATE Tickets SET status = @status WHERE id = @id');

    res.json({ ok: true, id, status });
  } catch (err) {
    console.error('Error updating ticket status:', err);
    res.status(500).json({ error: 'Failed to update ticket status' });
  }
});

export default router;
