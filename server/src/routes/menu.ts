import { Router, Request, Response } from 'express';
import { getDbPool } from '../db';
import sql from 'mssql/msnodesqlv8';

const router = Router();

// GET /api/menu
router.get('/', async (_req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request().query('SELECT id, name, price, cat, available FROM MenuItems ORDER BY cat, name');
    const menu = result.recordset.map(row => ({
      id: row.id,
      name: row.name,
      price: Number(row.price),
      cat: row.cat,
      available: Boolean(row.available),
    }));
    res.json(menu);
  } catch (err) {
    console.error('Error fetching menu:', err);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
});

// POST /api/menu
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, price, cat, available } = req.body;
    if (!name || price === undefined || !cat) {
      return res.status(400).json({ error: 'Name, price and category are required' });
    }
    const id = 'm' + Date.now();
    const p = await getDbPool();
    const r = p.request();
    r.input('id', sql.NVarChar(50), id);
    r.input('name', sql.NVarChar(200), name);
    r.input('price', sql.Decimal(10, 2), Number(price));
    r.input('cat', sql.NVarChar(100), cat);
    r.input('available', sql.Bit, available !== false ? 1 : 0);

    await r.query('INSERT INTO MenuItems (id, name, price, cat, available) VALUES (@id, @name, @price, @cat, @available)');
    res.status(201).json({ id, name, price: Number(price), cat, available: available !== false });
  } catch (err) {
    console.error('Error adding menu item:', err);
    res.status(500).json({ error: 'Failed to add menu item' });
  }
});

// PUT /api/menu/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, price, cat, available } = req.body;
    const p = await getDbPool();

    // Check existing
    const check = await p.request().input('id', sql.NVarChar(50), id).query('SELECT * FROM MenuItems WHERE id = @id');
    if (!check.recordset.length) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    const current = check.recordset[0];

    const newName = name !== undefined ? name : current.name;
    const newPrice = price !== undefined ? Number(price) : Number(current.price);
    const newCat = cat !== undefined ? cat : current.cat;
    const newAvail = available !== undefined ? (available ? 1 : 0) : (current.available ? 1 : 0);

    const r = p.request();
    r.input('id', sql.NVarChar(50), id);
    r.input('name', sql.NVarChar(200), newName);
    r.input('price', sql.Decimal(10, 2), newPrice);
    r.input('cat', sql.NVarChar(100), newCat);
    r.input('available', sql.Bit, newAvail);

    await r.query('UPDATE MenuItems SET name = @name, price = @price, cat = @cat, available = @available WHERE id = @id');
    res.json({ id, name: newName, price: newPrice, cat: newCat, available: Boolean(newAvail) });
  } catch (err) {
    console.error('Error updating menu item:', err);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

// DELETE /api/menu/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const p = await getDbPool();
    await p.request().input('id', sql.NVarChar(50), id).query('DELETE FROM MenuItems WHERE id = @id');
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting menu item:', err);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

export default router;
