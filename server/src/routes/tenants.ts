import { Router, Request, Response } from 'express';
import { getDbPool } from '../db';
import sql from 'mssql';

const router = Router();

// GET /api/tenants
router.get('/', async (_req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request().query('SELECT * FROM Tenants');
    const tenants = result.recordset.map((row: any) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      plan: row.plan,
      status: row.status,
      branches: Number(row.branches),
      version: row.version,
      sync: Number(row.sync),
      licenseDays: Number(row.licenseDays),
    }));
    res.json(tenants);
  } catch (err) {
    console.error('Error fetching tenants:', err);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// POST /api/tenants
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, city, plan, status, branches, version, sync, licenseDays } = req.body;
    const id = req.body.id || 't' + Date.now();
    const p = await getDbPool();
    const r = p.request();
    r.input('id', sql.NVarChar(50), id);
    r.input('name', sql.NVarChar(200), name || 'New Restaurant');
    r.input('city', sql.NVarChar(100), city || 'Karachi');
    r.input('plan', sql.NVarChar(50), plan || 'Starter');
    r.input('status', sql.NVarChar(50), status || 'active');
    r.input('branches', sql.Int, Number(branches) || 1);
    r.input('version', sql.NVarChar(50), version || '2.4.1');
    r.input('sync', sql.Int, Number(sync) || 0);
    r.input('licenseDays', sql.Int, Number(licenseDays) || 30);

    await r.query(`
      INSERT INTO Tenants (id, name, city, [plan], status, branches, version, sync, licenseDays)
      VALUES (@id, @name, @city, @plan, @status, @branches, @version, @sync, @licenseDays)
    `);

    res.status(201).json({ id, name, city, plan, status, branches: Number(branches) || 1, version, sync: 0, licenseDays: Number(licenseDays) || 30 });
  } catch (err) {
    console.error('Error creating tenant:', err);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

// PUT /api/tenants/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const p = await getDbPool();
    const check = await p.request().input('id', sql.NVarChar(50), id).query('SELECT * FROM Tenants WHERE id = @id');
    if (!check.recordset.length) return res.status(404).json({ error: 'Tenant not found' });

    const curr = check.recordset[0];
    const { name, city, plan, status, branches, version, sync, licenseDays } = req.body;

    const r = p.request();
    r.input('id', sql.NVarChar(50), id);
    r.input('name', sql.NVarChar(200), name !== undefined ? name : curr.name);
    r.input('city', sql.NVarChar(100), city !== undefined ? city : curr.city);
    r.input('plan', sql.NVarChar(50), plan !== undefined ? plan : curr.plan);
    r.input('status', sql.NVarChar(50), status !== undefined ? status : curr.status);
    r.input('branches', sql.Int, branches !== undefined ? Number(branches) : curr.branches);
    r.input('version', sql.NVarChar(50), version !== undefined ? version : curr.version);
    r.input('sync', sql.Int, sync !== undefined ? Number(sync) : curr.sync);
    r.input('licenseDays', sql.Int, licenseDays !== undefined ? Number(licenseDays) : curr.licenseDays);

    await r.query(`
      UPDATE Tenants
      SET name = @name,
          city = @city,
          [plan] = @plan,
          status = @status,
          branches = @branches,
          version = @version,
          sync = @sync,
          licenseDays = @licenseDays
      WHERE id = @id
    `);

    res.json({
      id,
      name: name !== undefined ? name : curr.name,
      city: city !== undefined ? city : curr.city,
      plan: plan !== undefined ? plan : curr.plan,
      status: status !== undefined ? status : curr.status,
      branches: branches !== undefined ? Number(branches) : curr.branches,
      version: version !== undefined ? version : curr.version,
      sync: sync !== undefined ? Number(sync) : curr.sync,
      licenseDays: licenseDays !== undefined ? Number(licenseDays) : curr.licenseDays,
    });
  } catch (err) {
    console.error('Error updating tenant:', err);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

export default router;
