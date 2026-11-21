import { Router, Response } from 'express';
import { getDbPool, sql } from '../db';
import { authOwner, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/v1/payments/instructions (Public or authenticated)
router.get('/instructions', async (_req, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request().query(`
      SELECT SettingKey, SettingValue FROM App_Settings 
      WHERE SettingKey IN ('currency', 'subscription_fee', 'payment_instructions')
    `);

    const map: Record<string, string> = {};
    for (const row of result.recordset) {
      map[row.SettingKey] = row.SettingValue;
    }

    res.json({
      currency: map['currency'] || 'PKR',
      fee: parseFloat(map['subscription_fee'] || '500'),
      instructions: map['payment_instructions'] || 'Please send subscription fee to JazzCash/EasyPaisa 0300-1234567 and enter reference number.',
    });
  } catch (err: any) {
    console.error('[PAYMENT_INSTRUCTIONS_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch instructions.' } });
  }
});

// GET /api/v1/payments/my-status (Authenticated owner: gets latest submissions & review notes)
router.get('/my-status', authOwner, async (req: AuthRequest, res: Response) => {
  try {
    const p = await getDbPool();
    const result = await p.request()
      .input('uid', sql.Int, req.user?.userId)
      .query(`
        SELECT TOP 5 PaymentID, Amount, CurrencyCode, PaymentMethod, Reference, PaymentProofUrl, Status, RejectionReason, CreatedAt, ReviewedAt
        FROM Payments
        WHERE UserID = @uid
        ORDER BY CreatedAt DESC
      `);

    res.json({
      ownerStatus: req.user?.status,
      payments: result.recordset,
    });
  } catch (err: any) {
    console.error('[MY_PAYMENT_STATUS_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch payment status.' } });
  }
});

// POST /api/v1/payments/submit (Pending/Rejected owner submits payment reference & optional proof)
router.post('/submit', authOwner, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, paymentMethod, reference, proofBase64 } = req.body;

    if (!paymentMethod || !reference) {
      res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'Payment method and reference/transaction ID are required.' } });
      return;
    }

    const payAmount = Number(amount) > 0 ? Number(amount) : 500;
    const p = await getDbPool();

    const insertResult = await p.request()
      .input('uid', sql.Int, req.user?.userId)
      .input('amount', sql.Decimal(18, 2), payAmount)
      .input('method', sql.NVarChar, paymentMethod.trim())
      .input('ref', sql.NVarChar, reference.trim())
      .input('proof', sql.NVarChar, proofBase64 || null)
      .query(`
        INSERT INTO Payments (UserID, Amount, CurrencyCode, PaymentMethod, Reference, PaymentProofUrl, Status)
        OUTPUT INSERTED.PaymentID, INSERTED.Amount, INSERTED.CurrencyCode, INSERTED.PaymentMethod, INSERTED.Reference, INSERTED.Status, INSERTED.CreatedAt
        VALUES (@uid, @amount, 'PKR', @method, @ref, @proof, 'Pending');
      `);

    // Record in audit log
    await p.request()
      .input('uid', sql.Int, req.user?.userId)
      .input('action', sql.VarChar, 'PAYMENT_SUBMITTED')
      .input('details', sql.NVarChar, `Submitted reference: ${reference} (${paymentMethod}, Rs. ${payAmount})`)
      .query(`
        INSERT INTO Admin_Audit_Logs (TargetUserID, Action, Details)
        VALUES (@uid, @action, @details);
      `);

    res.status(201).json({
      message: 'Payment submission received. Byte NCo administration will review and activate your account shortly.',
      payment: insertResult.recordset[0],
    });
  } catch (err: any) {
    console.error('[SUBMIT_PAYMENT_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Payment submission failed.' } });
  }
});

export default router;
