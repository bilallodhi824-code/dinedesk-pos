# DineDesk POS

Full-Stack Restaurant POS system built with **React (TypeScript)**, **Express (TypeScript)**, and **Microsoft SQL Server (MSSQL)**.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Express.js, TypeScript, `msnodesqlv8` / `mssql`
- **Database**: Microsoft SQL Server (MSSQL) (`DineDeskDB`)
- **Desktop (Optional)**: Electron

---

## Prerequisites

1. **Node.js** (v18+ or v20+)
2. **Microsoft SQL Server** (e.g. SQL Server Express `.\SQLEXPRESS` installed and running)
3. **ODBC Driver 18 for SQL Server** (or Driver 17)

---

## Configuration (`.env`)

Root directory mein `.env` file configuration:

```env
PORT=5000
DB_SERVER=.\SQLEXPRESS
DB_NAME=DineDeskDB
DB_DRIVER=ODBC Driver 18 for SQL Server
DB_TRUST_SERVER_CERTIFICATE=yes
# Agar SQL Authentication use karni ho (default is Windows Authentication):
# DB_USER=sa
# DB_PASSWORD=your_password
```

---

## Chalane ka tareeqa (How to Run)

### 1. Dependencies Install karein
```bash
npm install
```

### 2. Full-Stack Development Mode (Frontend + Backend dono ek sath)
```bash
npm run dev
```

Yeh command dono servers start kar degi:
- **Express Backend Server**: [http://localhost:5000](http://localhost:5000)
- **React Frontend (Vite)**: [http://localhost:5173](http://localhost:5173)

Database (`DineDeskDB`) aur saare tables (`MenuItems`, `Orders`, `OrderLines`, `Settings`, `Tenants`, `Tickets`, `AuditLogs`, `SystemState`) automatically create aur initial data ke sath seed ho jayenge!

---

## Alag-Alag Chalana (Separate Commands)

- **Sirf Backend Server**:
  ```bash
  npm run dev:server
  ```
- **Sirf Frontend Client**:
  ```bash
  npm run dev:client
  ```
- **Production Build (Client + Server)**:
  ```bash
  npm run build
  ```
- **TypeScript Check**:
  ```bash
  npm run typecheck
  ```
- **Desktop App (Electron)**:
  ```bash
  npm run start
  ```

---

## Database Schema (MSSQL)

- `MenuItems`: Menu items, categories, prices, availability
- `Orders`: Orders, totals, taxes, discounts, cashier, payment methods
- `OrderLines`: Items inside each order (with cascade delete)
- `Settings`: Restaurant name, address, tax %, service %, print settings
- `Tenants`: Multi-tenant restaurant branches & license info
- `Tickets`: Customer & POS support tickets
- `AuditLogs`: Audit activity logs
- `SystemState`: Feature flags (wallet, delivery, discount), maintenance mode, next numbers

---

## API Endpoints

- `GET /api/health` - Server & MSSQL status
- `GET /api/menu` / `POST /api/menu` / `PUT /api/menu/:id` / `DELETE /api/menu/:id`
- `GET /api/orders` / `POST /api/orders` / `PATCH /api/orders/:no/status` / `POST /api/orders/:no/pay` / `DELETE /api/orders/:no`
- `GET /api/settings` / `PUT /api/settings`
- `GET /api/tenants` / `POST /api/tenants` / `PUT /api/tenants/:id`
- `GET /api/tickets` / `POST /api/tickets` / `PATCH /api/tickets/:id/status`
- `GET /api/system` / `PUT /api/system`
- `GET /api/audit` / `POST /api/audit`
- `POST /api/reset` - Reset & reseed database
