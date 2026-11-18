import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

import { initDb } from './db';
import menuRouter from './routes/menu';
import ordersRouter from './routes/orders';
import settingsRouter from './routes/settings';
import tenantsRouter from './routes/tenants';
import ticketsRouter from './routes/tickets';
import systemRouter from './routes/system';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString(), database: 'MSSQL' });
});

// Routes
app.use('/api/menu', menuRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api', systemRouter);

// Error Handling Middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[SERVER ERROR]:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

async function startServer() {
  try {
    console.log('[SERVER] Initializing MSSQL database...');
    await initDb();
    console.log('[SERVER] Database schema & seed checked.');

    app.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(` DineDesk POS Express TypeScript Server `);
      console.log(` Running on: http://localhost:${PORT} `);
      console.log(` Database: MSSQL (DineDeskDB) `);
      console.log(`=========================================`);
    });
  } catch (err) {
    console.error('[SERVER] Fatal error during startup:', err);
    process.exit(1);
  }
}

startServer();
