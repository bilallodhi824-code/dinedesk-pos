import { Router, Response } from 'express';
import { getDbPool, sql } from '../db';
import { authApprovedOwner, AuthRequest } from '../middleware/auth';

const router = Router();

// Helper to get UTC date range for the current business day in Asia/Karachi (UTC+5)
function getKarachiDayRangeUtc(): { startUtc: Date; endUtc: Date; karachiDateStr: string } {
  const now = new Date();
  // Offset to UTC+5
  const karachiTimeMs = now.getTime() + 5 * 60 * 60 * 1000;
  const karachiDate = new Date(karachiTimeMs);

  const y = karachiDate.getUTCFullYear();
  const m = karachiDate.getUTCMonth();
  const d = karachiDate.getUTCDate();

  // Midnight in Karachi converted back to UTC (-5 hours)
  const startUtc = new Date(Date.UTC(y, m, d, -5, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y, m, d + 1, -5, 0, 0, 0));
  const karachiDateStr = `${String(d).padStart(2, '0')}-${String(m + 1).padStart(2, '0')}-${y}`;

  return { startUtc, endUtc, karachiDateStr };
}

// GET /api/v1/dashboard/today (Owner's metrics for the current day)
router.get('/today', authApprovedOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { startUtc, endUtc, karachiDateStr } = getKarachiDayRangeUtc();
    const p = await getDbPool();

    const result = await p.request()
      .input('uid', sql.Int, req.user?.userId)
      .input('start', sql.DateTime2, startUtc)
      .input('end', sql.DateTime2, endUtc)
      .query(`
        SELECT 
          ISNULL(SUM(TotalAmount), 0) as totalSales,
          COUNT(*) as orderCount,
          ISNULL(SUM(CASE WHEN PaymentMethod = 'Cash' THEN TotalAmount ELSE 0 END), 0) as cashSales,
          ISNULL(SUM(CASE WHEN PaymentMethod = 'JazzCash' THEN TotalAmount ELSE 0 END), 0) as jazzCashSales,
          ISNULL(SUM(CASE WHEN PaymentMethod = 'EasyPaisa' THEN TotalAmount ELSE 0 END), 0) as easyPaisaSales
        FROM Orders
        WHERE UserID = @uid 
          AND OrderStatus = 'Completed'
          AND OrderDate >= @start 
          AND OrderDate < @end
      `);

    const row = result.recordset[0] || {};

    res.json({
      date: karachiDateStr,
      timezone: 'Asia/Karachi (UTC+5)',
      currency: 'PKR',
      todayTotalSales: Number(row.totalSales || 0),
      todayOrdersCount: Number(row.orderCount || 0),
      todayCashSales: Number(row.cashSales || 0),
      todayJazzCashSales: Number(row.jazzCashSales || 0),
      todayEasyPaisaSales: Number(row.easyPaisaSales || 0),
    });
  } catch (err: any) {
    console.error('[DASHBOARD_METRICS_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to calculate daily metrics.' } });
  }
});

export default router;
