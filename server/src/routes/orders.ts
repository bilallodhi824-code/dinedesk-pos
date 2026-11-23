import { Router, Response } from 'express';
import { getDbPool, sql, sqlDriver } from '../db';
import { authApprovedOwner, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/v1/orders/checkout (Atomic idempotent transactional checkout)
router.post('/checkout', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { idempotencyKey, paymentMethod, items, cashReceived, changeDue } = req.body;

    if (!idempotencyKey) {
      res.status(400).json({ error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'An idempotency key is required.' } });
      return;
    }

    if (!paymentMethod || !['Cash', 'JazzCash', 'EasyPaisa'].includes(paymentMethod)) {
      res.status(400).json({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Payment method must be Cash, JazzCash, or EasyPaisa.' } });
      return;
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: { code: 'EMPTY_CART', message: 'Cart cannot be empty.' } });
      return;
    }

    const p = await getDbPool();
    const userId = req.user?.userId;

    // 1. Idempotency Check: if this exact key was already processed, return existing order
    const existing = await p.request()
      .input('key', sql.VarChar, idempotencyKey)
      .input('uid', sql.Int, userId)
      .query(`
        SELECT o.OrderID, o.OrderNo, o.TotalAmount, o.PaymentMethod, o.OrderStatus, o.OrderDate, o.CashReceived, o.ChangeDue
        FROM Orders o
        WHERE o.IdempotencyKey = @key AND o.UserID = @uid
      `);

    if (existing.recordset.length > 0) {
      const ord = existing.recordset[0];
      const itemsRes = await p.request()
        .input('oid', sql.Int, ord.OrderID)
        .query(`SELECT ItemID, ProductID, ProductNameSnapshot, Qty, UnitPrice, SubTotal FROM OrderItems WHERE OrderID = @oid`);

      res.status(200).json({
        message: 'Order already processed (idempotent response).',
        order: {
          ...ord,
          cartName: req.user?.cartName,
          ownerName: req.user?.ownerName,
          items: itemsRes.recordset,
        },
      });
      return;
    }

    // 2. Extract and validate products authoritatively from DB
    const productIds = items.map((i: any) => parseInt(i.productId, 10)).filter((id: number) => !isNaN(id));
    if (productIds.length !== items.length) {
      res.status(400).json({ error: { code: 'INVALID_ITEMS', message: 'Invalid product IDs provided.' } });
      return;
    }

    // Fetch active products for this owner
    const prodReq = p.request().input('uid', sql.Int, userId);
    productIds.forEach((id: number, idx: number) => {
      prodReq.input(`pid${idx}`, sql.Int, id);
    });
    const idPlaceholders = productIds.map((_: any, idx: number) => `@pid${idx}`).join(',');

    const productsResult = await prodReq.query(`
      SELECT ProductID, ProductName, Price, IsActive 
      FROM Products 
      WHERE UserID = @uid AND ProductID IN (${idPlaceholders})
    `);

    const productMap = new Map<number, any>();
    for (const prod of productsResult.recordset) {
      productMap.set(prod.ProductID, prod);
    }

    // Check all products exist, are active, and calculate authoritative totals
    let grandTotal = 0;
    const validatedItems: Array<{
      productId: number;
      name: string;
      qty: number;
      unitPrice: number;
      subTotal: number;
    }> = [];

    for (const item of items) {
      const pid = parseInt(item.productId, 10);
      const qty = parseInt(item.quantity, 10);

      if (isNaN(qty) || qty <= 0) {
        res.status(400).json({ error: { code: 'INVALID_QUANTITY', message: `Quantity for product #${pid} must be at least 1.` } });
        return;
      }

      const dbProduct = productMap.get(pid);
      if (!dbProduct) {
        res.status(400).json({ error: { code: 'PRODUCT_NOT_FOUND', message: `Product #${pid} not found or does not belong to your cart.` } });
        return;
      }

      if (!dbProduct.IsActive) {
        res.status(400).json({ error: { code: 'PRODUCT_INACTIVE', message: `Product "${dbProduct.ProductName}" is currently deactivated.` } });
        return;
      }

      const unitPrice = Number(dbProduct.Price);
      const subTotal = unitPrice * qty;
      grandTotal += subTotal;

      validatedItems.push({
        productId: pid,
        name: dbProduct.ProductName,
        qty,
        unitPrice,
        subTotal,
      });
    }

    // 3. Generate sequential OrderNo (e.g. #000101, #000102)
    const countRes = await p.request()
      .input('uid', sql.Int, userId)
      .query(`SELECT COUNT(*) as cnt FROM Orders WHERE UserID = @uid`);
    const nextSeq = (countRes.recordset[0]?.cnt || 0) + 1;
    const orderNo = `#${String(100 + nextSeq).padStart(6, '0')}`;

    // Tender calculation
    const numCashReceived = paymentMethod === 'Cash' && cashReceived !== undefined ? Number(cashReceived) : null;
    const numChangeDue = paymentMethod === 'Cash' && numCashReceived !== null ? Math.max(0, numCashReceived - grandTotal) : null;

    // 4. Atomic Transaction: Insert Order and OrderItems
    const tx = new sqlDriver.Transaction(p);
    await tx.begin();

    try {
      const orderInsert = await new sqlDriver.Request(tx)
        .input('uid', sql.Int, userId)
        .input('orderNo', sql.VarChar, orderNo)
        .input('total', sql.Decimal(18, 2), grandTotal)
        .input('method', sql.VarChar, paymentMethod)
        .input('key', sql.VarChar, idempotencyKey)
        .input('cashRec', sql.Decimal(18, 2), numCashReceived)
        .input('chg', sql.Decimal(18, 2), numChangeDue)
        .query(`
          INSERT INTO Orders (UserID, OrderNo, TotalAmount, PaymentMethod, OrderStatus, IdempotencyKey, CashReceived, ChangeDue)
          OUTPUT INSERTED.OrderID, INSERTED.OrderNo, INSERTED.TotalAmount, INSERTED.PaymentMethod, INSERTED.OrderStatus, INSERTED.OrderDate, INSERTED.CashReceived, INSERTED.ChangeDue
          VALUES (@uid, @orderNo, @total, @method, 'Completed', @key, @cashRec, @chg);
        `);

      const createdOrder = orderInsert.recordset[0];
      const createdItems: any[] = [];

      for (const it of validatedItems) {
        const itemInsert = await new sqlDriver.Request(tx)
          .input('oid', sql.Int, createdOrder.OrderID)
          .input('pid', sql.Int, it.productId)
          .input('snap', sql.NVarChar, it.name)
          .input('qty', sql.Int, it.qty)
          .input('price', sql.Decimal(18, 2), it.unitPrice)
          .input('sub', sql.Decimal(18, 2), it.subTotal)
          .query(`
            INSERT INTO OrderItems (OrderID, ProductID, ProductNameSnapshot, Qty, UnitPrice, SubTotal)
            OUTPUT INSERTED.ItemID, INSERTED.ProductID, INSERTED.ProductNameSnapshot, INSERTED.Qty, INSERTED.UnitPrice, INSERTED.SubTotal
            VALUES (@oid, @pid, @snap, @qty, @price, @sub);
          `);
        createdItems.push(itemInsert.recordset[0]);
      }

      await tx.commit();

      res.status(201).json({
        message: 'Order checkout successful.',
        order: {
          ...createdOrder,
          cartName: req.user?.cartName,
          ownerName: req.user?.ownerName,
          items: createdItems,
        },
      });
    } catch (txErr) {
      await tx.rollback();
      throw txErr;
    }
  } catch (err: any) {
    console.error('[CHECKOUT_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Checkout failed.' } });
  }
});

// GET /api/v1/orders (Order history for owner)
router.get('/', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { method, search } = req.query;
    const p = await getDbPool();

    let query = `
      SELECT o.OrderID, o.OrderNo, o.TotalAmount, o.PaymentMethod, o.OrderStatus, o.OrderDate, o.CashReceived, o.ChangeDue,
             (SELECT COUNT(*) FROM OrderItems i WHERE i.OrderID = o.OrderID) as TotalItems
      FROM Orders o
      WHERE o.UserID = @uid
    `;

    const request = p.request().input('uid', sql.Int, req.user?.userId);

    if (method && typeof method === 'string' && method !== 'All') {
      query += ` AND o.PaymentMethod = @method`;
      request.input('method', sql.VarChar, method);
    }

    if (search && typeof search === 'string' && search.trim()) {
      query += ` AND o.OrderNo LIKE @search`;
      request.input('search', sql.VarChar, `%${search.trim()}%`);
    }

    query += ` ORDER BY o.OrderDate DESC`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err: any) {
    console.error('[ORDERS_LIST_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch orders.' } });
  }
});

// GET /api/v1/orders/:id (Order detail for receipt reprint)
router.get('/:id', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const p = await getDbPool();

    const orderRes = await p.request()
      .input('oid', sql.Int, orderId)
      .input('uid', sql.Int, req.user?.userId)
      .query(`
        SELECT o.OrderID, o.OrderNo, o.TotalAmount, o.PaymentMethod, o.OrderStatus, o.OrderDate, o.CashReceived, o.ChangeDue
        FROM Orders o
        WHERE o.OrderID = @oid AND o.UserID = @uid
      `);

    if (orderRes.recordset.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found.' } });
      return;
    }

    const itemsRes = await p.request()
      .input('oid', sql.Int, orderId)
      .query(`
        SELECT ItemID, ProductID, ProductNameSnapshot, Qty, UnitPrice, SubTotal
        FROM OrderItems
        WHERE OrderID = @oid
      `);

    res.json({
      ...orderRes.recordset[0],
      cartName: req.user?.cartName,
      ownerName: req.user?.ownerName,
      items: itemsRes.recordset,
    });
  } catch (err: any) {
    console.error('[ORDER_DETAIL_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch order details.' } });
  }
});

export default router;
