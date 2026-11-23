import { Router, Response } from 'express';
import { getDbPool, sql } from '../db';
import { authApprovedOwner, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/v1/products (List products for authenticated approved owner)
router.get('/', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { activeOnly, category } = req.query;
    const p = await getDbPool();

    let query = `
      SELECT ProductID, ProductName, Price, Category, ImageUrl, IsActive, CreatedAt, UpdatedAt
      FROM Products
      WHERE UserID = @uid
    `;

    const request = p.request().input('uid', sql.Int, req.user?.userId);

    if (activeOnly === 'true') {
      query += ` AND IsActive = 1`;
    }

    if (category && typeof category === 'string' && category !== 'All') {
      query += ` AND Category = @cat`;
      request.input('cat', sql.NVarChar, category);
    }

    query += ` ORDER BY CreatedAt DESC`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err: any) {
    console.error('[PRODUCTS_GET_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch products.' } });
  }
});

// POST /api/v1/products (Add product)
router.post('/', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { productName, price, category, imageUrl } = req.body;

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
      .input('cat', sql.NVarChar, category ? category.trim() : 'General')
      .input('img', sql.NVarChar, imageUrl?.trim() || null)
      .query(`
        INSERT INTO Products (UserID, ProductName, Price, Category, ImageUrl, IsActive)
        OUTPUT INSERTED.ProductID, INSERTED.ProductName, INSERTED.Price, INSERTED.Category, INSERTED.ImageUrl, INSERTED.IsActive, INSERTED.CreatedAt
        VALUES (@uid, @name, @price, @cat, @img, 1);
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
    const { productName, price, category, imageUrl, isActive } = req.body;

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
      .input('cat', sql.NVarChar, category !== undefined ? (category ? category.trim() : 'General') : null)
      .input('img', sql.NVarChar, imageUrl !== undefined ? imageUrl : null)
      .input('active', sql.Bit, isActive !== undefined ? (isActive ? 1 : 0) : null)
      .query(`
        UPDATE Products
        SET ProductName = ISNULL(@name, ProductName),
            Price = ISNULL(@price, Price),
            Category = ISNULL(@cat, Category),
            ImageUrl = CASE WHEN @img IS NOT NULL THEN @img ELSE ImageUrl END,
            IsActive = ISNULL(@active, IsActive),
            UpdatedAt = SYSUTCDATETIME()
        WHERE ProductID = @pid;
      `);

    const updated = await p.request()
      .input('pid', sql.Int, productId)
      .query(`SELECT ProductID, ProductName, Price, Category, ImageUrl, IsActive, UpdatedAt FROM Products WHERE ProductID = @pid`);

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
        OUTPUT INSERTED.ProductID, INSERTED.ProductName, INSERTED.Price, INSERTED.Category, INSERTED.IsActive
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

// DELETE /api/v1/products/:id (Safe delete: deactivates if historical orders exist, or deletes if never ordered)
router.delete('/:id', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const p = await getDbPool();

    const check = await p.request()
      .input('pid', sql.Int, productId)
      .input('uid', sql.Int, req.user?.userId)
      .query(`SELECT ProductID FROM Products WHERE ProductID = @pid AND UserID = @uid`);

    if (check.recordset.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found.' } });
      return;
    }

    // Check if in OrderItems
    const orderCheck = await p.request()
      .input('pid', sql.Int, productId)
      .query(`SELECT TOP 1 ItemID FROM OrderItems WHERE ProductID = @pid`);

    if (orderCheck.recordset.length > 0) {
      // Historical orders exist! Deactivate instead of physical deletion
      await p.request()
        .input('pid', sql.Int, productId)
        .query(`UPDATE Products SET IsActive = 0, UpdatedAt = SYSUTCDATETIME() WHERE ProductID = @pid`);
      res.json({ message: 'Product deactivated to preserve historical sales records.' });
    } else {
      // Safe to physically remove
      await p.request()
        .input('pid', sql.Int, productId)
        .query(`DELETE FROM Products WHERE ProductID = @pid`);
      res.json({ message: 'Product deleted permanently.' });
    }
  } catch (err: any) {
    console.error('[PRODUCT_DELETE_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to delete product.' } });
  }
});

export default router;
