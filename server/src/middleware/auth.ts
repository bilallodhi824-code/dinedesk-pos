import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDbPool, sql } from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'bytenco_pos_super_secure_jwt_secret_2026_xyz';

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    role: 'owner' | 'admin';
    status?: string;
    email?: string;
    mobile?: string;
    cartName?: string;
    ownerName?: string;
  };
}

export function generateToken(payload: any): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No authorization token provided.' } });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired.' } });
    return;
  }
}

// Ensure caller is an authenticated owner and re-check live status in DB
export async function authOwner(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  await authMiddleware(req, res, async () => {
    if (!req.user || req.user.role !== 'owner') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied: Cart Owners only.' } });
      return;
    }

    try {
      const p = await getDbPool();
      const r = await p.request()
        .input('uid', sql.Int, req.user.userId)
        .query(`SELECT UserID, OwnerName, Mobile, CartName, City, Status FROM Users WHERE UserID = @uid`);

      if (r.recordset.length === 0) {
        res.status(401).json({ error: { code: 'USER_NOT_FOUND', message: 'User account not found.' } });
        return;
      }

      const dbUser = r.recordset[0];
      req.user.status = dbUser.Status;
      req.user.cartName = dbUser.CartName;
      req.user.ownerName = dbUser.OwnerName;

      // Server-side block check on EVERY request
      if (dbUser.Status === 'Blocked') {
        res.status(403).json({
          error: {
            code: 'ACCOUNT_BLOCKED',
            message: 'Your account has been suspended by Byte NCo Administration.',
          },
        });
        return;
      }

      next();
    } catch (err) {
      console.error('[AUTH_OWNER_ERR]', err);
      res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to verify account status.' } });
    }
  });
}

// Require status == 'Approved' for POS, Products, Orders, and Dashboard
export async function authApprovedOwner(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  await authOwner(req, res, () => {
    if (req.user?.status !== 'Approved') {
      res.status(403).json({
        error: {
          code: req.user?.status === 'Pending' ? 'ACCOUNT_PENDING' : 'ACCOUNT_NOT_APPROVED',
          message: req.user?.status === 'Pending'
            ? 'Your account is awaiting Byte NCo admin review and payment verification.'
            : 'Your account is not approved to access the POS.',
          status: req.user?.status,
        },
      });
      return;
    }
    next();
  });
}

// Admin only middleware
export async function authAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  await authMiddleware(req, res, async () => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied: Byte NCo Administrators only.' } });
      return;
    }

    try {
      const p = await getDbPool();
      const r = await p.request()
        .input('aid', sql.Int, req.user.userId)
        .query(`SELECT AdminID, Name, Email, IsActive FROM Admins WHERE AdminID = @aid`);

      if (r.recordset.length === 0 || !r.recordset[0].IsActive) {
        res.status(403).json({ error: { code: 'ADMIN_INACTIVE', message: 'Admin account is inactive.' } });
        return;
      }

      next();
    } catch (err) {
      console.error('[AUTH_ADMIN_ERR]', err);
      res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to verify admin status.' } });
    }
  });
}
