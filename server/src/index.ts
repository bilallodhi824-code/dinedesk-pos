import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { initDb } from './db';
import authRouter from './routes/auth';
import paymentsRouter from './routes/payments';
import adminRouter from './routes/admin';
import productsRouter from './routes/products';
import ordersRouter from './routes/orders';
import dashboardRouter from './routes/dashboard';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const port = parseInt(process.env.PORT || '5000', 10);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Byte NCo Simple POS API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Byte NCo Simple POS API',
    version: '1.0.0',
    currency: 'PKR',
    timezone: 'Asia/Karachi',
    timestamp: new Date().toISOString(),
  });
});

// Mount Byte NCo API v1 Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/products', productsRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/dashboard', dashboardRouter);

// Fallback legacy health for backward compatibility if any
app.get('/api', (_req, res) => {
  res.json({ message: 'Byte NCo POS API root' });
});

async function startServer() {
  try {
    console.log('[SERVER] Initializing Byte NCo MSSQL database...');
    await initDb();
    app.listen(port, () => {
      console.log('=========================================');
      console.log(` Byte NCo Simple POS Express TS Server `);
      console.log(` Running on: http://localhost:${port} `);
      console.log(` Database: MSSQL (ByteNcoDB) `);
      console.log('=========================================');
    });
  } catch (err) {
    console.error('[SERVER] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
