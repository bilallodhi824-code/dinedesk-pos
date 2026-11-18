import { Router, Request, Response } from 'express';
import { getDbPool } from '../db';
import sql from 'mssql';

const router = Router();

// GET /api/orders
router.get('/', async (_req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    const ordersRes = await p.request().query('SELECT * FROM Orders ORDER BY no DESC');
    const linesRes = await p.request().query('SELECT * FROM OrderLines');

    const linesByOrder: Record<number, any[]> = {};
    for (const row of linesRes.recordset) {
      if (!linesByOrder[row.orderNo]) linesByOrder[row.orderNo] = [];
      linesByOrder[row.orderNo].push({
        id: row.lineId,
        name: row.name,
        price: Number(row.price),
        qty: Number(row.qty),
        note: row.note || '',
      });
    }

    const orders = ordersRes.recordset.map((row: any) => {
      const paid = Boolean(row.paid);
      const pay = paid && row.payMethod ? {
        method: row.payMethod,
        ref: row.payRef || undefined,
        last4: row.payLast4 || undefined,
        tendered: row.payTendered != null ? Number(row.payTendered) : undefined,
        change: row.payChange != null ? Number(row.payChange) : undefined,
      } : undefined;

      return {
        no: row.no,
        type: row.type,
        table: row.table || '',
        customer: row.customer || '',
        lines: linesByOrder[row.no] || [],
        discountPct: Number(row.discountPct),
        taxPct: Number(row.taxPct),
        svcPct: Number(row.svcPct),
        sub: Number(row.sub),
        discount: Number(row.discount),
        service: Number(row.service),
        tax: Number(row.tax),
        total: Number(row.total),
        status: row.status,
        paid,
        pay,
        at: Number(row.createdAt),
        cashier: row.cashier,
      };
    });

    res.json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// POST /api/orders
router.post('/', async (req: Request, res: Response) => {
  try {
    const p = await getDbPool();
    const {
      type,
      table,
      customer,
      lines,
      discountPct,
      taxPct,
      svcPct,
      sub,
      discount,
      service,
      tax,
      total,
      status,
      paid,
      pay,
      at,
      cashier,
    } = req.body;

    let orderNo = req.body.no;
    if (!orderNo) {
      // Determine next order number atomically from SystemState
      const sysRes = await p.request().query('SELECT nextNo FROM SystemState WHERE id = 1');
      if (sysRes.recordset.length) {
        orderNo = sysRes.recordset[0].nextNo;
        await p.request().input('nextNo', sql.Int, orderNo + 1).query('UPDATE SystemState SET nextNo = @nextNo WHERE id = 1');
      } else {
        const maxRes = await p.request().query('SELECT ISNULL(MAX(no), 1000) as maxNo FROM Orders');
        orderNo = maxRes.recordset[0].maxNo + 1;
      }
    }

    const r = p.request();
    r.input('no', sql.Int, orderNo);
    r.input('type', sql.NVarChar(20), type || 'dine-in');
    r.input('table', sql.NVarChar(50), table || '');
    r.input('customer', sql.NVarChar(200), customer || '');
    r.input('discountPct', sql.Decimal(5, 2), Number(discountPct) || 0);
    r.input('taxPct', sql.Decimal(5, 2), Number(taxPct) || 0);
    r.input('svcPct', sql.Decimal(5, 2), Number(svcPct) || 0);
    r.input('sub', sql.Decimal(10, 2), Number(sub) || 0);
    r.input('discount', sql.Decimal(10, 2), Number(discount) || 0);
    r.input('service', sql.Decimal(10, 2), Number(service) || 0);
    r.input('tax', sql.Decimal(10, 2), Number(tax) || 0);
    r.input('total', sql.Decimal(10, 2), Number(total) || 0);
    r.input('status', sql.NVarChar(20), status || 'new');
    r.input('paid', sql.Bit, paid ? 1 : 0);
    r.input('payMethod', sql.NVarChar(20), pay?.method || null);
    r.input('payRef', sql.NVarChar(100), pay?.ref || null);
    r.input('payLast4', sql.NVarChar(10), pay?.last4 || null);
    r.input('payTendered', sql.Decimal(10, 2), pay?.tendered != null ? Number(pay.tendered) : null);
    r.input('payChange', sql.Decimal(10, 2), pay?.change != null ? Number(pay.change) : null);
    r.input('createdAt', sql.BigInt, at || Date.now());
    r.input('cashier', sql.NVarChar(100), cashier || 'Ayesha');

    await r.query(`
      INSERT INTO Orders (no, type, [table], customer, discountPct, taxPct, svcPct, sub, discount, service, tax, total, status, paid, payMethod, payRef, payLast4, payTendered, payChange, createdAt, cashier)
      VALUES (@no, @type, @table, @customer, @discountPct, @taxPct, @svcPct, @sub, @discount, @service, @tax, @total, @status, @paid, @payMethod, @payRef, @payLast4, @payTendered, @payChange, @createdAt, @cashier)
    `);

    if (Array.isArray(lines)) {
      for (const line of lines) {
        const lineReq = p.request();
        lineReq.input('orderNo', sql.Int, orderNo);
        lineReq.input('lineId', sql.NVarChar(50), line.id || 'l' + Math.random().toString(36).substring(2, 7));
        lineReq.input('name', sql.NVarChar(200), line.name);
        lineReq.input('price', sql.Decimal(10, 2), Number(line.price));
        lineReq.input('qty', sql.Int, Number(line.qty) || 1);
        lineReq.input('note', sql.NVarChar(500), line.note || '');
        await lineReq.query(`
          INSERT INTO OrderLines (orderNo, lineId, name, price, qty, note)
          VALUES (@orderNo, @lineId, @name, @price, @qty, @note)
        `);
      }
    }

    const createdOrder = {
      no: orderNo,
      type: type || 'dine-in',
      table: table || '',
      customer: customer || '',
      lines: lines || [],
      discountPct: Number(discountPct) || 0,
      taxPct: Number(taxPct) || 0,
      svcPct: Number(svcPct) || 0,
      sub: Number(sub) || 0,
      discount: Number(discount) || 0,
      service: Number(service) || 0,
      tax: Number(tax) || 0,
      total: Number(total) || 0,
      status: status || 'new',
      paid: Boolean(paid),
      pay,
      at: at || Date.now(),
      cashier: cashier || 'Ayesha',
    };

    res.status(201).json(createdOrder);
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// PATCH /api/orders/:no/status
router.patch('/:no/status', async (req: Request, res: Response) => {
  try {
    const orderNo = parseInt(req.params.no, 10);
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });

    const p = await getDbPool();
    const r = p.request();
    r.input('no', sql.Int, orderNo);
    r.input('status', sql.NVarChar(20), status);
    await r.query('UPDATE Orders SET status = @status WHERE no = @no');

    res.json({ ok: true, no: orderNo, status });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// POST /api/orders/:no/pay
router.post('/:no/pay', async (req: Request, res: Response) => {
  try {
    const orderNo = parseInt(req.params.no, 10);
    const { method, ref, last4, tendered, change } = req.body;
    if (!method) return res.status(400).json({ error: 'Payment method is required' });

    const p = await getDbPool();
    const r = p.request();
    r.input('no', sql.Int, orderNo);
    r.input('payMethod', sql.NVarChar(20), method);
    r.input('payRef', sql.NVarChar(100), ref || null);
    r.input('payLast4', sql.NVarChar(10), last4 || null);
    r.input('payTendered', sql.Decimal(10, 2), tendered != null ? Number(tendered) : null);
    r.input('payChange', sql.Decimal(10, 2), change != null ? Number(change) : null);

    await r.query(`
      UPDATE Orders
      SET paid = 1,
          payMethod = @payMethod,
          payRef = @payRef,
          payLast4 = @payLast4,
          payTendered = @payTendered,
          payChange = @payChange
      WHERE no = @no
    `);

    res.json({
      ok: true,
      no: orderNo,
      pay: { method, ref, last4, tendered, change },
    });
  } catch (err) {
    console.error('Error processing payment:', err);
    res.status(500).json({ error: 'Failed to update order payment' });
  }
});

// DELETE /api/orders/:no
router.delete('/:no', async (req: Request, res: Response) => {
  try {
    const orderNo = parseInt(req.params.no, 10);
    const p = await getDbPool();
    await p.request().input('no', sql.Int, orderNo).query('DELETE FROM Orders WHERE no = @no');
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

export default router;
