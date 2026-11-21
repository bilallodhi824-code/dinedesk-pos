import { Router, Response } from 'express';
import { getDbPool, sql } from '../db';
import { authAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/v1/admin/stats (Admin dashboard overview)
router.get('/stats', authAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const p = await getDbPool();

    const [statusCounts, pendingPayments, totalSales] = await Promise.all([
      p.request().query(`
        SELECT Status, COUNT(*) as count 
        FROM Users 
        GROUP BY Status
      `),
      p.request().query(`
        SELECT COUNT(*) as count 
        FROM Payments 
        WHERE Status = 'Pending'
      `),
      p.request().query(`
        SELECT ISNULL(SUM(TotalAmount), 0) as totalPlatformSales, COUNT(*) as totalPlatformOrders 
        FROM Orders
      `),
    ]);

    const counts: Record<string, number> = { Pending: 0, Approved: 0, Rejected: 0, Blocked: 0 };
    for (const row of statusCounts.recordset) {
      counts[row.Status] = row.count;
    }

    res.json({
      owners: counts,
      pendingPayments: pendingPayments.recordset[0]?.count || 0,
      totalPlatformSales: totalSales.recordset[0]?.totalPlatformSales || 0,
      totalPlatformOrders: totalSales.recordset[0]?.totalPlatformOrders || 0,
    });
  } catch (err: any) {
    console.error('[ADMIN_STATS_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch admin stats.' } });
  }
});

// GET /api/v1/admin/owners (Filter by status, search by name/mobile/cart)
router.get('/owners', authAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search } = req.query;
    const p = await getDbPool();

    let query = `
      SELECT u.UserID, u.OwnerName, u.Mobile, u.CartName, u.City, u.Status, u.CreatedAt,
             (SELECT COUNT(*) FROM Orders o WHERE o.UserID = u.UserID) as OrdersCount,
             (SELECT ISNULL(SUM(o.TotalAmount), 0) FROM Orders o WHERE o.UserID = u.UserID) as TotalSales,
             p.PaymentID, p.Amount as LastPaymentAmount, p.PaymentMethod as LastPaymentMethod,
             p.Reference as LastPaymentRef, p.Status as LastPaymentStatus, p.CreatedAt as LastPaymentDate,
             p.PaymentProofUrl as LastPaymentProof
      FROM Users u
      OUTER APPLY (
        SELECT TOP 1 * FROM Payments pay WHERE pay.UserID = u.UserID ORDER BY pay.CreatedAt DESC
      ) p
      WHERE 1=1
    `;

    const request = p.request();

    if (status && typeof status === 'string' && status !== 'all') {
      query += ` AND u.Status = @status`;
      request.input('status', sql.VarChar, status);
    }

    if (search && typeof search === 'string' && search.trim()) {
      query += ` AND (u.OwnerName LIKE @search OR u.Mobile LIKE @search OR u.CartName LIKE @search OR u.City LIKE @search)`;
      request.input('search', sql.NVarChar, `%${search.trim()}%`);
    }

    query += ` ORDER BY u.CreatedAt DESC`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err: any) {
    console.error('[ADMIN_OWNERS_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch owners.' } });
  }
});

// GET /api/v1/admin/owners/:id (Full owner details)
router.get('/owners/:id', authAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = parseInt(req.params.id, 10);
    const p = await getDbPool();

    const ownerRes = await p.request()
      .input('uid', sql.Int, ownerId)
      .query(`SELECT UserID, OwnerName, Mobile, CartName, City, Status, CreatedAt, UpdatedAt FROM Users WHERE UserID = @uid`);

    if (ownerRes.recordset.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Cart owner not found.' } });
      return;
    }

    const [paymentsRes, ordersCountRes, auditRes] = await Promise.all([
      p.request()
        .input('uid', sql.Int, ownerId)
        .query(`SELECT * FROM Payments WHERE UserID = @uid ORDER BY CreatedAt DESC`),
      p.request()
        .input('uid', sql.Int, ownerId)
        .query(`SELECT COUNT(*) as count, ISNULL(SUM(TotalAmount), 0) as total FROM Orders WHERE UserID = @uid`),
      p.request()
        .input('uid', sql.Int, ownerId)
        .query(`SELECT TOP 20 * FROM Admin_Audit_Logs WHERE TargetUserID = @uid ORDER BY CreatedAt DESC`),
    ]);

    res.json({
      owner: ownerRes.recordset[0],
      ordersSummary: ordersCountRes.recordset[0],
      payments: paymentsRes.recordset,
      auditLogs: auditRes.recordset,
    });
  } catch (err: any) {
    console.error('[ADMIN_OWNER_DETAIL_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch owner details.' } });
  }
});

// POST /api/v1/admin/payments/:id/approve (Approves payment and activates owner)
router.post('/payments/:id/approve', authAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const adminId = req.user?.userId;
    const p = await getDbPool();

    const payRes = await p.request()
      .input('pid', sql.Int, paymentId)
      .query(`SELECT PaymentID, UserID, Status, Amount, Reference FROM Payments WHERE PaymentID = @pid`);

    if (payRes.recordset.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment record not found.' } });
      return;
    }

    const pay = payRes.recordset[0];
    const targetUserId = pay.UserID;

    // Transactionally approve payment and set owner Status to Approved
    await p.request()
      .input('pid', sql.Int, paymentId)
      .input('aid', sql.Int, adminId)
      .query(`
        UPDATE Payments 
        SET Status = 'Approved', ReviewedBy = @aid, ReviewedAt = SYSUTCDATETIME()
        WHERE PaymentID = @pid;
      `);

    await p.request()
      .input('uid', sql.Int, targetUserId)
      .query(`
        UPDATE Users 
        SET Status = 'Approved', UpdatedAt = SYSUTCDATETIME()
        WHERE UserID = @uid;
      `);

    // Audit log
    await p.request()
      .input('aid', sql.Int, adminId)
      .input('uid', sql.Int, targetUserId)
      .input('action', sql.VarChar, 'PAYMENT_APPROVED')
      .input('details', sql.NVarChar, `Approved payment #${paymentId} (Ref: ${pay.Reference}, Rs. ${pay.Amount}). Account activated to Approved.`)
      .query(`
        INSERT INTO Admin_Audit_Logs (AdminID, TargetUserID, Action, Details)
        VALUES (@aid, @uid, @action, @details);
      `);

    res.json({ message: 'Payment approved. Cart owner is now Approved and active.' });
  } catch (err: any) {
    console.error('[ADMIN_APPROVE_PAYMENT_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to approve payment.' } });
  }
});

// POST /api/v1/admin/payments/:id/reject (Rejects payment with mandatory reason)
router.post('/payments/:id/reject', authAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const adminId = req.user?.userId;

    if (!reason || !reason.trim()) {
      res.status(400).json({ error: { code: 'REASON_REQUIRED', message: 'A rejection reason is required.' } });
      return;
    }

    const p = await getDbPool();
    const payRes = await p.request()
      .input('pid', sql.Int, paymentId)
      .query(`SELECT PaymentID, UserID, Amount, Reference FROM Payments WHERE PaymentID = @pid`);

    if (payRes.recordset.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment record not found.' } });
      return;
    }

    const pay = payRes.recordset[0];
    const targetUserId = pay.UserID;

    await p.request()
      .input('pid', sql.Int, paymentId)
      .input('aid', sql.Int, adminId)
      .input('reason', sql.NVarChar, reason.trim())
      .query(`
        UPDATE Payments 
        SET Status = 'Rejected', ReviewedBy = @aid, ReviewedAt = SYSUTCDATETIME(), RejectionReason = @reason
        WHERE PaymentID = @pid;
      `);

    await p.request()
      .input('uid', sql.Int, targetUserId)
      .query(`
        UPDATE Users 
        SET Status = 'Rejected', UpdatedAt = SYSUTCDATETIME()
        WHERE UserID = @uid;
      `);

    await p.request()
      .input('aid', sql.Int, adminId)
      .input('uid', sql.Int, targetUserId)
      .input('action', sql.VarChar, 'PAYMENT_REJECTED')
      .input('reason', sql.NVarChar, reason.trim())
      .input('details', sql.NVarChar, `Rejected payment #${paymentId}. Reason: ${reason}`)
      .query(`
        INSERT INTO Admin_Audit_Logs (AdminID, TargetUserID, Action, Reason, Details)
        VALUES (@aid, @uid, @action, @reason, @details);
      `);

    res.json({ message: 'Payment rejected. Owner status set to Rejected.' });
  } catch (err: any) {
    console.error('[ADMIN_REJECT_PAYMENT_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to reject payment.' } });
  }
});

// POST /api/v1/admin/owners/:id/block (Blocks owner immediately)
router.post('/owners/:id/block', authAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const adminId = req.user?.userId;

    const p = await getDbPool();
    await p.request()
      .input('uid', sql.Int, ownerId)
      .query(`UPDATE Users SET Status = 'Blocked', UpdatedAt = SYSUTCDATETIME() WHERE UserID = @uid`);

    await p.request()
      .input('aid', sql.Int, adminId)
      .input('uid', sql.Int, ownerId)
      .input('action', sql.VarChar, 'OWNER_BLOCKED')
      .input('reason', sql.NVarChar, reason || 'Suspended by admin')
      .query(`
        INSERT INTO Admin_Audit_Logs (AdminID, TargetUserID, Action, Reason, Details)
        VALUES (@aid, @uid, @action, @reason, 'Owner suspended. Immediate POS and API access revoked.');
      `);

    res.json({ message: 'Owner blocked successfully. All subsequent API calls will be denied.' });
  } catch (err: any) {
    console.error('[ADMIN_BLOCK_OWNER_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to block owner.' } });
  }
});

// POST /api/v1/admin/owners/:id/unblock (Restores owner to Approved)
router.post('/owners/:id/unblock', authAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = parseInt(req.params.id, 10);
    const adminId = req.user?.userId;

    const p = await getDbPool();
    await p.request()
      .input('uid', sql.Int, ownerId)
      .query(`UPDATE Users SET Status = 'Approved', UpdatedAt = SYSUTCDATETIME() WHERE UserID = @uid`);

    await p.request()
      .input('aid', sql.Int, adminId)
      .input('uid', sql.Int, ownerId)
      .input('action', sql.VarChar, 'OWNER_UNBLOCKED')
      .query(`
        INSERT INTO Admin_Audit_Logs (AdminID, TargetUserID, Action, Details)
        VALUES (@aid, @uid, @action, 'Owner access restored to Approved.');
      `);

    res.json({ message: 'Owner unblocked successfully.' });
  } catch (err: any) {
    console.error('[ADMIN_UNBLOCK_OWNER_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to unblock owner.' } });
  }
});

// GET /api/v1/admin/audit-logs
router.get('/audit-logs', authAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request().query(`
      SELECT TOP 50 l.LogID, l.Action, l.Reason, l.Details, l.CreatedAt,
             a.Name as AdminName, a.Email as AdminEmail,
             u.OwnerName, u.Mobile as OwnerMobile, u.CartName
      FROM Admin_Audit_Logs l
      LEFT JOIN Admins a ON l.AdminID = a.AdminID
      LEFT JOIN Users u ON l.TargetUserID = u.UserID
      ORDER BY l.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err: any) {
    console.error('[AUDIT_LOGS_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch audit logs.' } });
  }
});

export default router;
