import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDbPool, sql } from '../db';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// Helper to normalize Pakistan mobile numbers (e.g. 03001234567 or +923001234567 -> 03001234567)
function normalizeMobile(raw: string): string {
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+92')) {
    cleaned = '0' + cleaned.substring(3);
  } else if (cleaned.startsWith('92') && cleaned.length === 12) {
    cleaned = '0' + cleaned.substring(2);
  }
  return cleaned;
}

// POST /api/v1/auth/register (Cart Owner registration)
router.post('/register', async (req, res: Response) => {
  try {
    const { ownerName, mobile, cartName, city, password } = req.body;

    if (!ownerName || !mobile || !cartName || !city || !password) {
      res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'All fields are required.' } });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 6 characters.' } });
      return;
    }

    const normMobile = normalizeMobile(mobile);
    if (normMobile.length < 11) {
      res.status(400).json({ error: { code: 'INVALID_MOBILE', message: 'Please provide a valid 11-digit mobile number (e.g. 03XXXXXXXXX).' } });
      return;
    }

    const p = await getDbPool();

    // Check unique mobile
    const check = await p.request()
      .input('mobile', sql.VarChar, normMobile)
      .query(`SELECT UserID FROM Users WHERE Mobile = @mobile`);

    if (check.recordset.length > 0) {
      res.status(409).json({ error: { code: 'MOBILE_EXISTS', message: 'This mobile number is already registered. Please login.' } });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passHash = await bcrypt.hash(password, salt);

    const result = await p.request()
      .input('name', sql.NVarChar, ownerName.trim())
      .input('mobile', sql.VarChar, normMobile)
      .input('cart', sql.NVarChar, cartName.trim())
      .input('city', sql.NVarChar, city.trim())
      .input('hash', sql.NVarChar, passHash)
      .query(`
        INSERT INTO Users (OwnerName, Mobile, CartName, City, PasswordHash, Status)
        OUTPUT INSERTED.UserID, INSERTED.OwnerName, INSERTED.Mobile, INSERTED.CartName, INSERTED.City, INSERTED.Status
        VALUES (@name, @mobile, @cart, @city, @hash, 'Pending');
      `);

    const user = result.recordset[0];
    const token = generateToken({
      userId: user.UserID,
      role: 'owner',
      status: 'Pending',
      mobile: user.Mobile,
      cartName: user.CartName,
      ownerName: user.OwnerName,
    });

    res.status(201).json({
      message: 'Account registered successfully. Awaiting payment and admin approval.',
      token,
      user: {
        userId: user.UserID,
        ownerName: user.OwnerName,
        mobile: user.Mobile,
        cartName: user.CartName,
        city: user.City,
        status: user.Status,
        role: 'owner',
      },
    });
  } catch (err: any) {
    console.error('[REGISTER_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Registration failed.' } });
  }
});

// POST /api/v1/auth/login (Dual login: Owner by Mobile or Admin by Email)
router.post('/login', async (req, res: Response) => {
  try {
    const { identifier, password } = req.body; // identifier can be mobile or email

    if (!identifier || !password) {
      res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'Mobile/Email and password are required.' } });
      return;
    }

    const p = await getDbPool();
    const cleanId = identifier.trim();

    // 1. Check if Admin email
    if (cleanId.includes('@')) {
      const adminRes = await p.request()
        .input('email', sql.NVarChar, cleanId.toLowerCase())
        .query(`SELECT AdminID, Name, Email, PasswordHash, IsActive FROM Admins WHERE Email = @email`);

      if (adminRes.recordset.length > 0) {
        const admin = adminRes.recordset[0];
        if (!admin.IsActive) {
          res.status(403).json({ error: { code: 'ADMIN_INACTIVE', message: 'Admin account has been deactivated.' } });
          return;
        }

        const match = await bcrypt.compare(password, admin.PasswordHash);
        if (!match) {
          res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
          return;
        }

        const token = generateToken({
          userId: admin.AdminID,
          role: 'admin',
          email: admin.Email,
          ownerName: admin.Name,
        });

        res.json({
          token,
          user: {
            userId: admin.AdminID,
            ownerName: admin.Name,
            email: admin.Email,
            role: 'admin',
            status: 'Approved',
          },
        });
        return;
      }
    }

    // 2. Otherwise check Owner by normalized mobile
    const normMobile = normalizeMobile(cleanId);
    const ownerRes = await p.request()
      .input('mobile', sql.VarChar, normMobile)
      .query(`SELECT UserID, OwnerName, Mobile, CartName, City, PasswordHash, Status FROM Users WHERE Mobile = @mobile`);

    if (ownerRes.recordset.length === 0) {
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'No registered account found with this mobile number.' } });
      return;
    }

    const owner = ownerRes.recordset[0];
    const match = await bcrypt.compare(password, owner.PasswordHash);
    if (!match) {
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid mobile or password.' } });
      return;
    }

    // Master Prompt Rule: If Status != Approved, return error "Waiting for Admin Approval"
    if (owner.Status !== 'Approved') {
      res.status(403).json({
        error: {
          code: 'WAITING_FOR_ADMIN_APPROVAL',
          message: 'Waiting for Admin Approval. Please contact Byte NCo administration to activate your cart.',
          status: owner.Status,
        },
      });
      return;
    }

    const token = generateToken({
      userId: owner.UserID,
      role: 'owner',
      status: owner.Status,
      mobile: owner.Mobile,
      cartName: owner.CartName,
      ownerName: owner.OwnerName,
    });

    res.json({
      token,
      user: {
        userId: owner.UserID,
        ownerName: owner.OwnerName,
        mobile: owner.Mobile,
        cartName: owner.CartName,
        city: owner.City,
        status: owner.Status,
        role: 'owner',
      },
    });
  } catch (err: any) {
    console.error('[LOGIN_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Login failed.' } });
  }
});

// GET /api/v1/auth/me (Returns live DB status on every request)
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const p = await getDbPool();

    if (req.user?.role === 'admin') {
      const adminRes = await p.request()
        .input('aid', sql.Int, req.user.userId)
        .query(`SELECT AdminID, Name, Email, IsActive FROM Admins WHERE AdminID = @aid`);

      if (adminRes.recordset.length === 0) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Admin not found.' } });
        return;
      }
      const admin = adminRes.recordset[0];
      res.json({
        userId: admin.AdminID,
        ownerName: admin.Name,
        email: admin.Email,
        role: 'admin',
        status: 'Approved',
        isActive: admin.IsActive,
      });
      return;
    }

    // Owner check
    const ownerRes = await p.request()
      .input('uid', sql.Int, req.user?.userId)
      .query(`SELECT UserID, OwnerName, Mobile, CartName, City, Status, CreatedAt FROM Users WHERE UserID = @uid`);

    if (ownerRes.recordset.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Owner not found.' } });
      return;
    }

    const o = ownerRes.recordset[0];
    res.json({
      userId: o.UserID,
      ownerName: o.OwnerName,
      mobile: o.Mobile,
      cartName: o.CartName,
      city: o.City,
      status: o.Status,
      role: 'owner',
      createdAt: o.CreatedAt,
    });
  } catch (err: any) {
    console.error('[ME_ERR]', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

export default router;
