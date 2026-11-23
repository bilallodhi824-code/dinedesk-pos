import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';

let sqlDriver: any = sql;
try {
  sqlDriver = require('mssql/msnodesqlv8');
} catch {
  sqlDriver = sql;
}

export { sql, sqlDriver };

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const server = process.env.DB_SERVER || '.\\SQLEXPRESS';
const database = process.env.DB_NAME || 'ByteNcoDB';
const driver = process.env.DB_DRIVER || 'ODBC Driver 18 for SQL Server';
const trustCert = process.env.DB_TRUST_SERVER_CERTIFICATE || 'yes';
const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;

let connectionString = '';
if (user && password) {
  connectionString = `Driver={${driver}};Server=${server};Database=${database};Uid=${user};Pwd=${password};TrustServerCertificate=${trustCert};`;
} else {
  connectionString = `Driver={${driver}};Server=${server};Database=${database};Trusted_Connection=yes;TrustServerCertificate=${trustCert};`;
}

let pool: sql.ConnectionPool | null = null;

export async function getDbPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }
  try {
    const p = await new sqlDriver.ConnectionPool({ connectionString } as any).connect();
    pool = p;
    console.log(`[MSSQL] Connected successfully to ${server}/${database}`);
    return p;
  } catch (err) {
    console.error('[MSSQL] Connection error:', err);
    throw err;
  }
}

export async function initDb(): Promise<void> {
  const p = await getDbPool();

  // 1. Users table (Cart Owners)
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
    CREATE TABLE Users (
      UserID INT IDENTITY(1,1) PRIMARY KEY,
      OwnerName NVARCHAR(100) NOT NULL,
      Mobile VARCHAR(20) NOT NULL UNIQUE,
      CartName NVARCHAR(150) NOT NULL,
      City NVARCHAR(100) NOT NULL,
      PasswordHash NVARCHAR(255) NOT NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (Status IN ('Pending', 'Approved', 'Rejected', 'Blocked')),
      CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  `);

  // 2. Admins table
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Admins')
    CREATE TABLE Admins (
      AdminID INT IDENTITY(1,1) PRIMARY KEY,
      Name NVARCHAR(100) NOT NULL,
      Email NVARCHAR(150) NOT NULL UNIQUE,
      PasswordHash NVARCHAR(255) NOT NULL,
      IsActive BIT NOT NULL DEFAULT 1,
      CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  `);

  // 3. Products table (Owner-specific)
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
    CREATE TABLE Products (
      ProductID INT IDENTITY(1,1) PRIMARY KEY,
      UserID INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
      ProductName NVARCHAR(150) NOT NULL,
      Price DECIMAL(18,2) NOT NULL CHECK (Price > 0),
      ImageUrl NVARCHAR(500) NULL,
      IsActive BIT NOT NULL DEFAULT 1,
      CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Products_User_Active')
    CREATE INDEX IX_Products_User_Active ON Products (UserID, IsActive);

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Products') AND name = 'Category')
    ALTER TABLE Products ADD Category NVARCHAR(50) NULL;
  `);

  // 4. Orders table
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
    CREATE TABLE Orders (
      OrderID INT IDENTITY(1,1) PRIMARY KEY,
      UserID INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
      OrderNo VARCHAR(50) NOT NULL,
      TotalAmount DECIMAL(18,2) NOT NULL CHECK (TotalAmount >= 0),
      PaymentMethod VARCHAR(20) NOT NULL CHECK (PaymentMethod IN ('Cash', 'JazzCash', 'EasyPaisa')),
      OrderStatus VARCHAR(20) NOT NULL DEFAULT 'Completed' CHECK (OrderStatus IN ('Completed', 'Voided')),
      IdempotencyKey VARCHAR(100) NOT NULL UNIQUE,
      OrderDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_User_Date')
    CREATE INDEX IX_Orders_User_Date ON Orders (UserID, OrderDate);

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Orders') AND name = 'CashReceived')
    ALTER TABLE Orders ADD CashReceived DECIMAL(18,2) NULL;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Orders') AND name = 'ChangeDue')
    ALTER TABLE Orders ADD ChangeDue DECIMAL(18,2) NULL;
  `);

  // 5. OrderItems table
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderItems')
    CREATE TABLE OrderItems (
      ItemID INT IDENTITY(1,1) PRIMARY KEY,
      OrderID INT NOT NULL FOREIGN KEY REFERENCES Orders(OrderID) ON DELETE CASCADE,
      ProductID INT NULL FOREIGN KEY REFERENCES Products(ProductID) ON DELETE SET NULL,
      ProductNameSnapshot NVARCHAR(150) NOT NULL,
      Qty INT NOT NULL CHECK (Qty > 0),
      UnitPrice DECIMAL(18,2) NOT NULL CHECK (UnitPrice > 0),
      SubTotal DECIMAL(18,2) NOT NULL CHECK (SubTotal > 0)
    );
  `);

  // 6. Payments / Subscriptions table
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Payments')
    CREATE TABLE Payments (
      PaymentID INT IDENTITY(1,1) PRIMARY KEY,
      UserID INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
      Amount DECIMAL(18,2) NOT NULL CHECK (Amount >= 0),
      CurrencyCode VARCHAR(5) NOT NULL DEFAULT 'PKR',
      PaymentMethod NVARCHAR(50) NOT NULL,
      Reference NVARCHAR(100) NOT NULL,
      PaymentProofUrl NVARCHAR(MAX) NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (Status IN ('Pending', 'Approved', 'Rejected')),
      ReviewedBy INT NULL FOREIGN KEY REFERENCES Admins(AdminID),
      ReviewedAt DATETIME2 NULL,
      RejectionReason NVARCHAR(500) NULL,
      CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Payments_Status')
    CREATE INDEX IX_Payments_Status ON Payments (Status, CreatedAt);
  `);

  // 7. Admin_Audit_Logs table
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Admin_Audit_Logs')
    CREATE TABLE Admin_Audit_Logs (
      LogID INT IDENTITY(1,1) PRIMARY KEY,
      AdminID INT NULL FOREIGN KEY REFERENCES Admins(AdminID),
      TargetUserID INT NULL FOREIGN KEY REFERENCES Users(UserID),
      Action VARCHAR(50) NOT NULL,
      Reason NVARCHAR(500) NULL,
      Details NVARCHAR(MAX) NULL,
      CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  `);

  // 8. App_Settings table
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'App_Settings')
    CREATE TABLE App_Settings (
      SettingKey NVARCHAR(50) PRIMARY KEY,
      SettingValue NVARCHAR(MAX) NOT NULL
    );
  `);

  // Seed default Admin ONLY if none exists (Zero fake products, zero fake orders)
  const adminCheck = await p.request().query(`SELECT COUNT(*) as count FROM Admins`);
  if (adminCheck.recordset[0].count === 0) {
    const salt = await bcrypt.genSalt(10);
    const passHash = await bcrypt.hash('Admin@123', salt);
    await p.request()
      .input('name', sql.NVarChar, 'Byte NCo System Admin')
      .input('email', sql.NVarChar, 'admin@bytenco.com')
      .input('pass', sql.NVarChar, passHash)
      .query(`
        INSERT INTO Admins (Name, Email, PasswordHash, IsActive)
        VALUES (@name, @email, @pass, 1);
      `);
    console.log('[MSSQL] Seeded default super admin: admin@bytenco.com');
  }

  // Seed initial system settings if not set
  const settingsCheck = await p.request().query(`SELECT COUNT(*) as count FROM App_Settings`);
  if (settingsCheck.recordset[0].count === 0) {
    await p.request().query(`
      INSERT INTO App_Settings (SettingKey, SettingValue) VALUES
      ('currency', 'PKR'),
      ('timezone', 'Asia/Karachi'),
      ('subscription_fee', '500'),
      ('payment_instructions', 'Transfer Rs. 500 to JazzCash/EasyPaisa: 0300-1234567 (Title: Byte NCo POS), and submit your Transaction Reference ID below.');
    `);
    console.log('[MSSQL] Initialized Byte NCo App_Settings.');
  }

  console.log('[MSSQL] Byte NCo database schema initialized successfully.');
}
