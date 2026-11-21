import { Router, Response } from 'express';
import { getDbPool, sql } from '../db';
import { authApprovedOwner, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/v1/products (List products for authenticated approved owner)
router.get('/', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { activeOnly } = req.query;
    const p = await getDbPool();

    let query = `
      SELECT ProductID, ProductName, Price, ImageUrl, IsActive, CreatedAt, UpdatedAt
      FROM Products
      WHERE UserID = @uid
    `;

    if (activeOnly === 'true') {
      query += ` AND IsActive = 1`;
    }

    query += ` ORDER BY CreatedAt DESC`;

    const result = await p.request()
      .input('uid', sql.Int, req.user?.userId)
      .query(query);

    res.json(result.recordset);
  } catch (err: any) {
    console.error('[PRODUCTS_GET_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch products.' } });
  }
});

// POST /api/v1/products (Add product)
router.post('/', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { productName, price, imageUrl } = req.body;

    if (!productName || price === undefined || price === null) {
      res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'Product name and price are required.' } });
      return;
    }

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice <= 0) {
      res.status(400).json({ error: { code: 'INVALID_PRICE', message: 'Price must be greater than 0 PKR.' } });
      return;
    }

    const p = await getDbPool();
    const result = await p.request()
      .input('uid', sql.Int, req.user?.userId)
      .input('name', sql.NVarChar, productName.trim())
      .input('price', sql.Decimal(18, 2), numPrice)
      .input('img', sql.NVarChar, imageUrl?.trim() || null)
      .query(`
        INSERT INTO Products (UserID, ProductName, Price, ImageUrl, IsActive)
        OUTPUT INSERTED.ProductID, INSERTED.ProductName, INSERTED.Price, INSERTED.ImageUrl, INSERTED.IsActive, INSERTED.CreatedAt
        VALUES (@uid, @name, @price, @img, 1);
      `);

    res.status(201).json(result.recordset[0]);
  } catch (err: any) {
    console.error('[PRODUCT_CREATE_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Failed to create product.' } });
  }
});

// PUT /api/v1/products/:id (Update product)
router.put('/:id', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const { productName, price, imageUrl, isActive } = req.body;

    const p = await getDbPool();

    // Verify ownership
    const check = await p.request()
      .input('pid', sql.Int, productId)
      .input('uid', sql.Int, req.user?.userId)
      .query(`SELECT ProductID FROM Products WHERE ProductID = @pid AND UserID = @uid`);

    if (check.recordset.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found or not owned by you.' } });
      return;
    }

    const numPrice = price !== undefined ? Number(price) : undefined;
    if (numPrice !== undefined && (isNaN(numPrice) || numPrice <= 0)) {
      res.status(400).json({ error: { code: 'INVALID_PRICE', message: 'Price must be greater than 0.' } });
      return;
    }

    await p.request()
      .input('pid', sql.Int, productId)
      .input('name', sql.NVarChar, productName ? productName.trim() : null)
      .input('price', sql.Decimal(18, 2), numPrice !== undefined ? numPrice : null)
      .input('img', sql.NVarChar, imageUrl !== undefined ? imageUrl : null)
      .input('active', sql.Bit, isActive !== undefined ? (isActive ? 1 : 0) : null)
      .query(`
        UPDATE Products
        SET ProductName = ISNULL(@name, ProductName),
            Price = ISNULL(@price, Price),
            ImageUrl = CASE WHEN @img IS NOT NULL THEN @img ELSE ImageUrl END,
            IsActive = ISNULL(@active, IsActive),
            UpdatedAt = SYSUTCDATETIME()
        WHERE ProductID = @pid;
      `);

    const updated = await p.request()
      .input('pid', sql.Int, productId)
      .query(`SELECT ProductID, ProductName, Price, ImageUrl, IsActive, UpdatedAt FROM Products WHERE ProductID = @pid`);

    res.json(updated.recordset[0]);
  } catch (err: any) {
    console.error('[PRODUCT_UPDATE_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Failed to update product.' } });
  }
});

// PATCH /api/v1/products/:id/toggle (Activate / Deactivate product)
router.patch('/:id/toggle', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const p = await getDbPool();

    const result = await p.request()
      .input('pid', sql.Int, productId)
      .input('uid', sql.Int, req.user?.userId)
      .query(`
        UPDATE Products
        SET IsActive = CASE WHEN IsActive = 1 THEN 0 ELSE 1 END,
            UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.ProductID, INSERTED.ProductName, INSERTED.Price, INSERTED.IsActive
        WHERE ProductID = @pid AND UserID = @uid;
      `);

    if (result.recordset.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found.' } });
      return;
    }

    res.json(result.recordset[0]);
  } catch (err: any) {
    console.error('[PRODUCT_TOGGLE_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to toggle product status.' } });
  }
});

export default router;
