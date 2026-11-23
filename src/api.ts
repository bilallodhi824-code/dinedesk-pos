// Byte NCo Simple POS API Client with Live MSSQL Sync & Resilient Local Fallback
const API_BASE = '/api/v1';

export interface User {
  userId: number;
  ownerName: string;
  mobile?: string;
  cartName?: string;
  city?: string;
  email?: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Blocked';
  role: 'owner' | 'admin';
}

export interface Product {
  ProductID: number;
  ProductName: string;
  Price: number;
  Category?: string | null;
  ImageUrl?: string | null;
  IsActive: boolean;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export interface OrderItem {
  ItemID?: number;
  ProductID?: number;
  ProductNameSnapshot: string;
  Qty: number;
  UnitPrice: number;
  SubTotal: number;
}

export interface Order {
  OrderID: number;
  OrderNo: string;
  TotalAmount: number;
  PaymentMethod: 'Cash' | 'JazzCash' | 'EasyPaisa';
  OrderStatus: 'Completed' | 'Voided';
  OrderDate: string;
  CashReceived?: number | null;
  ChangeDue?: number | null;
  cartName?: string;
  ownerName?: string;
  items?: OrderItem[];
  TotalItems?: number;
}

export interface DashboardMetrics {
  date: string;
  timezone: string;
  currency: string;
  todayTotalSales: number;
  todayOrdersCount: number;
  todayCashSales: number;
  todayJazzCashSales: number;
  todayEasyPaisaSales: number;
}

export interface PaymentSubmission {
  PaymentID: number;
  Amount: number;
  CurrencyCode: string;
  PaymentMethod: string;
  Reference: string;
  PaymentProofUrl?: string | null;
  Status: 'Pending' | 'Approved' | 'Rejected';
  RejectionReason?: string | null;
  CreatedAt: string;
  ReviewedAt?: string | null;
}

export interface AdminStats {
  owners: { Pending: number; Approved: number; Rejected: number; Blocked: number };
  pendingPayments: number;
  totalPlatformSales: number;
  totalPlatformOrders: number;
}

function getStoredToken(): string | null {
  return localStorage.getItem('bytenco_token');
}

function setStoredToken(token: string | null) {
  if (token) localStorage.setItem('bytenco_token', token);
  else localStorage.removeItem('bytenco_token');
}

// Local storage keys for standalone / offline fallback
const LS_USERS = 'bytenco_local_users';
const LS_PRODS = 'bytenco_local_prods';
const LS_ORDS = 'bytenco_local_orders';
const LS_PAYS = 'bytenco_local_payments';
const LS_AUDIT = 'bytenco_local_audit';

function getLs<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : def;
  } catch {
    return def;
  }
}

function setLs(key: string, val: any) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export const api = {
  getToken: getStoredToken,
  setToken: setStoredToken,

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return false;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return false;
      const data = await res.json();
      return data?.status === 'ok';
    } catch {
      return false;
    }
  },

  async getMe(): Promise<User | null> {
    const token = getStoredToken();
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        return await res.json();
      }
    } catch {}

    // Fallback in standalone mode
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      if (payload?.userId) {
        if (payload.role === 'admin') {
          return {
            userId: payload.userId,
            ownerName: 'Byte NCo System Admin',
            email: 'admin@bytenco.com',
            role: 'admin',
            status: 'Approved',
          };
        }
        const users = getLs<any[]>(LS_USERS, []);
        const found = users.find(u => u.userId === payload.userId);
        if (found) return found;
      }
    } catch {}
    return null;
  },

  async login(identifier: string, password: string): Promise<{ token: string; user: User }> {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'Login failed');
        setStoredToken(data.token);
        return data;
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('Failed to fetch')) {
        throw err;
      }
    }

    // Standalone fallback
    const cleanId = identifier.trim().toLowerCase();
    if (cleanId === 'admin@bytenco.com') {
      if (password !== 'Admin@123') throw new Error('Invalid email or password.');
      const adminUser: User = {
        userId: 1,
        ownerName: 'Byte NCo System Admin',
        email: 'admin@bytenco.com',
        role: 'admin',
        status: 'Approved',
      };
      const token = 'header.' + btoa(JSON.stringify({ userId: 1, role: 'admin' })) + '.sig';
      setStoredToken(token);
      return { token, user: adminUser };
    }

    const users = getLs<any[]>(LS_USERS, []);
    const cleanMobile = identifier.replace(/[^0-9]/g, '');
    const found = users.find(u => u.mobile.replace(/[^0-9]/g, '') === cleanMobile);
    if (!found) throw new Error('No registered account found with this mobile number.');
    if (found.password !== password) throw new Error('Invalid mobile or password.');

    const token = 'header.' + btoa(JSON.stringify({ userId: found.userId, role: 'owner' })) + '.sig';
    setStoredToken(token);
    return { token, user: found };
  },

  async register(params: {
    ownerName: string;
    mobile: string;
    cartName: string;
    city: string;
    password: string;
  }): Promise<{ token: string; user: User }> {
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'Registration failed');
        setStoredToken(data.token);
        return data;
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('Failed to fetch')) {
        throw err;
      }
    }

    // Standalone fallback
    const users = getLs<any[]>(LS_USERS, []);
    const cleanMobile = params.mobile.replace(/[^0-9]/g, '');
    if (users.some(u => u.mobile.replace(/[^0-9]/g, '') === cleanMobile)) {
      throw new Error('This mobile number is already registered. Please login.');
    }

    const newUser: any = {
      userId: Date.now(),
      ownerName: params.ownerName.trim(),
      mobile: params.mobile.trim(),
      cartName: params.cartName.trim(),
      city: params.city.trim(),
      password: params.password,
      status: 'Pending',
      role: 'owner',
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    setLs(LS_USERS, users);

    const token = 'header.' + btoa(JSON.stringify({ userId: newUser.userId, role: 'owner' })) + '.sig';
    setStoredToken(token);
    return { token, user: newUser };
  },

  logout() {
    setStoredToken(null);
  },

  // Payment instructions and submissions
  async getPaymentInstructions(): Promise<{ currency: string; fee: number; instructions: string }> {
    try {
      const res = await fetch(`${API_BASE}/payments/instructions`);
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}
    return {
      currency: 'PKR',
      fee: 500,
      instructions: 'Transfer Rs. 500 to JazzCash/EasyPaisa: 0300-1234567 (Title: Byte NCo POS), and submit your Transaction Reference ID below.',
    };
  },

  async getMyPaymentStatus(): Promise<{ ownerStatus: string; payments: PaymentSubmission[] }> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/payments/my-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}

    // Standalone fallback
    const me = await this.getMe();
    const payments = getLs<any[]>(LS_PAYS, []).filter(p => p.UserID === me?.userId);
    return {
      ownerStatus: me?.status || 'Pending',
      payments,
    };
  },

  async submitPayment(params: {
    amount: number;
    paymentMethod: string;
    reference: string;
    proofBase64?: string;
  }): Promise<any> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/payments/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'Payment submission failed');
        return data;
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
    }

    // Standalone fallback
    const me = await this.getMe();
    const payments = getLs<any[]>(LS_PAYS, []);
    const newPay = {
      PaymentID: Date.now(),
      UserID: me?.userId,
      Amount: params.amount || 500,
      CurrencyCode: 'PKR',
      PaymentMethod: params.paymentMethod,
      Reference: params.reference,
      PaymentProofUrl: params.proofBase64 || null,
      Status: 'Pending',
      CreatedAt: new Date().toISOString(),
    };
    payments.unshift(newPay);
    setLs(LS_PAYS, payments);
    return { message: 'Payment submitted successfully.', payment: newPay };
  },

  // Owner Products
  async getProducts(activeOnly = false, category?: string): Promise<Product[]> {
    const token = getStoredToken();
    try {
      let url = `${API_BASE}/products?`;
      if (activeOnly) url += 'activeOnly=true&';
      if (category && category !== 'All') url += `category=${encodeURIComponent(category)}&`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}

    // Standalone fallback
    const me = await this.getMe();
    const allProds = getLs<any[]>(LS_PRODS, []).filter(p => p.UserID === me?.userId);
    let filtered = allProds;
    if (activeOnly) filtered = filtered.filter(p => p.IsActive);
    if (category && category !== 'All') filtered = filtered.filter(p => p.Category === category);
    return filtered;
  },

  async createProduct(params: { productName: string; price: number; category?: string; imageUrl?: string }): Promise<Product> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'Failed to create product');
        return data;
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
    }

    // Standalone fallback
    const me = await this.getMe();
    const allProds = getLs<any[]>(LS_PRODS, []);
    const newProd: Product = {
      ProductID: Date.now(),
      ProductName: params.productName.trim(),
      Price: Number(params.price),
      Category: params.category || 'General',
      ImageUrl: params.imageUrl || null,
      IsActive: true,
      CreatedAt: new Date().toISOString(),
    };
    allProds.unshift(newProd);
    setLs(LS_PRODS, allProds);
    return newProd;
  },

  async updateProduct(id: number, params: { productName?: string; price?: number; category?: string; imageUrl?: string; isActive?: boolean }): Promise<Product> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/products/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'Failed to update product');
        return data;
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
    }

    // Standalone fallback
    const allProds = getLs<any[]>(LS_PRODS, []);
    const idx = allProds.findIndex(p => p.ProductID === id);
    if (idx !== -1) {
      allProds[idx] = {
        ...allProds[idx],
        ...params,
        UpdatedAt: new Date().toISOString(),
      };
      setLs(LS_PRODS, allProds);
      return allProds[idx];
    }
    throw new Error('Product not found');
  },

  async toggleProduct(id: number): Promise<Product> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/products/${id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'Failed to toggle product');
        return data;
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
    }

    const allProds = getLs<any[]>(LS_PRODS, []);
    const idx = allProds.findIndex(p => p.ProductID === id);
    if (idx !== -1) {
      allProds[idx].IsActive = !allProds[idx].IsActive;
      setLs(LS_PRODS, allProds);
      return allProds[idx];
    }
    throw new Error('Product not found');
  },

  async deleteProduct(id: number): Promise<void> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/products/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'Failed to delete product');
        return;
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
    }

    const allProds = getLs<any[]>(LS_PRODS, []);
    const updated = allProds.filter(p => p.ProductID !== id);
    setLs(LS_PRODS, updated);
  },

  // Checkout & Orders
  async checkout(params: {
    idempotencyKey: string;
    paymentMethod: 'Cash' | 'JazzCash' | 'EasyPaisa';
    cashReceived?: number | null;
    changeDue?: number | null;
    items: Array<{ productId: number; quantity: number }>;
  }): Promise<{ message: string; order: Order }> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || 'Checkout failed');
        return data;
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('Failed to fetch')) throw err;
    }

    // Standalone fallback
    const me = await this.getMe();
    const allProds = getLs<any[]>(LS_PRODS, []).filter(p => p.UserID === me?.userId);
    const prodMap = new Map(allProds.map(p => [p.ProductID, p]));

    let total = 0;
    const orderItems: OrderItem[] = [];

    for (const it of params.items) {
      const prod = prodMap.get(it.productId);
      if (!prod) throw new Error(`Product #${it.productId} not found`);
      const sub = prod.Price * it.quantity;
      total += sub;
      orderItems.push({
        ItemID: Date.now() + Math.random(),
        ProductID: prod.ProductID,
        ProductNameSnapshot: prod.ProductName,
        Qty: it.quantity,
        UnitPrice: prod.Price,
        SubTotal: sub,
      });
    }

    const allOrders = getLs<any[]>(LS_ORDS, []);
    const userOrders = allOrders.filter(o => o.UserID === me?.userId);
    const orderNo = `#${String(101 + userOrders.length).padStart(6, '0')}`;

    const newOrder: any = {
      OrderID: Date.now(),
      UserID: me?.userId,
      OrderNo: orderNo,
      TotalAmount: total,
      PaymentMethod: params.paymentMethod,
      OrderStatus: 'Completed',
      OrderDate: new Date().toISOString(),
      CashReceived: params.cashReceived ?? null,
      ChangeDue: params.changeDue ?? null,
      cartName: me?.cartName,
      ownerName: me?.ownerName,
      items: orderItems,
      TotalItems: orderItems.reduce((acc, x) => acc + x.Qty, 0),
    };

    allOrders.unshift(newOrder);
    setLs(LS_ORDS, allOrders);
    return { message: 'Order checkout successful.', order: newOrder };
  },

  async getOrders(method?: string, search?: string): Promise<Order[]> {
    const token = getStoredToken();
    try {
      let url = `${API_BASE}/orders?`;
      if (method && method !== 'All') url += `method=${encodeURIComponent(method)}&`;
      if (search) url += `search=${encodeURIComponent(search)}&`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}

    // Standalone fallback
    const me = await this.getMe();
    let userOrders = getLs<any[]>(LS_ORDS, []).filter(o => o.UserID === me?.userId);
    if (method && method !== 'All') userOrders = userOrders.filter(o => o.PaymentMethod === method);
    if (search && search.trim()) userOrders = userOrders.filter(o => o.OrderNo.toLowerCase().includes(search.toLowerCase().trim()));
    return userOrders;
  },

  async getOrderDetail(id: number): Promise<Order> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/orders/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}

    const allOrders = getLs<any[]>(LS_ORDS, []);
    const found = allOrders.find(o => o.OrderID === id);
    if (found) return found;
    throw new Error('Order not found');
  },

  // Owner Dashboard
  async getTodayMetrics(): Promise<DashboardMetrics> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/dashboard/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}

    // Standalone fallback: calculate for today
    const me = await this.getMe();
    const allOrders = getLs<any[]>(LS_ORDS, []).filter(o => o.UserID === me?.userId);
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayOrders = allOrders.filter(o => (o.OrderDate || '').slice(0, 10) === todayStr);

    let total = 0;
    let cash = 0;
    let jazz = 0;
    let easy = 0;

    for (const o of todayOrders) {
      total += o.TotalAmount || 0;
      if (o.PaymentMethod === 'Cash') cash += o.TotalAmount || 0;
      else if (o.PaymentMethod === 'JazzCash') jazz += o.TotalAmount || 0;
      else if (o.PaymentMethod === 'EasyPaisa') easy += o.TotalAmount || 0;
    }

    return {
      date: new Date().toLocaleDateString('en-PK'),
      timezone: 'Asia/Karachi (UTC+5)',
      currency: 'PKR',
      todayTotalSales: total,
      todayOrdersCount: todayOrders.length,
      todayCashSales: cash,
      todayJazzCashSales: jazz,
      todayEasyPaisaSales: easy,
    };
  },

  // Admin APIs
  async getAdminStats(): Promise<AdminStats> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}

    // Standalone fallback
    const users = getLs<any[]>(LS_USERS, []);
    const pays = getLs<any[]>(LS_PAYS, []);
    const ords = getLs<any[]>(LS_ORDS, []);

    const counts = { Pending: 0, Approved: 0, Rejected: 0, Blocked: 0 };
    for (const u of users) {
      if (counts[u.status as keyof typeof counts] !== undefined) {
        counts[u.status as keyof typeof counts]++;
      }
    }

    return {
      owners: counts,
      pendingPayments: pays.filter(p => p.Status === 'Pending').length,
      totalPlatformSales: ords.reduce((acc, o) => acc + (o.TotalAmount || 0), 0),
      totalPlatformOrders: ords.length,
    };
  },

  async getAdminOwners(status?: string, search?: string): Promise<any[]> {
    const token = getStoredToken();
    try {
      const url = new URL(`${API_BASE}/admin/owners`, window.location.origin);
      if (status && status !== 'all') url.searchParams.set('status', status);
      if (search) url.searchParams.set('search', search);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}

    // Standalone fallback
    let users = getLs<any[]>(LS_USERS, []);
    const pays = getLs<any[]>(LS_PAYS, []);
    const ords = getLs<any[]>(LS_ORDS, []);

    if (status && status !== 'all') {
      users = users.filter(u => u.status === status);
    }
    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      users = users.filter(u =>
        u.ownerName.toLowerCase().includes(q) ||
        u.cartName.toLowerCase().includes(q) ||
        u.mobile.includes(q) ||
        u.city.toLowerCase().includes(q)
      );
    }

    return users.map(u => {
      const lastPay = pays.find(p => p.UserID === u.userId);
      const userOrds = ords.filter(o => o.UserID === u.userId);
      return {
        UserID: u.userId,
        OwnerName: u.ownerName,
        Mobile: u.mobile,
        CartName: u.cartName,
        City: u.city,
        Status: u.status,
        CreatedAt: u.createdAt,
        OrdersCount: userOrds.length,
        TotalSales: userOrds.reduce((acc, o) => acc + (o.TotalAmount || 0), 0),
        PaymentID: lastPay?.PaymentID,
        LastPaymentAmount: lastPay?.Amount,
        LastPaymentMethod: lastPay?.PaymentMethod,
        LastPaymentRef: lastPay?.Reference,
        LastPaymentStatus: lastPay?.Status,
        LastPaymentDate: lastPay?.CreatedAt,
        LastPaymentProof: lastPay?.PaymentProofUrl,
      };
    });
  },

  async approvePayment(paymentId: number): Promise<void> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/admin/payments/${paymentId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return;
    } catch {}

    // Standalone fallback
    const pays = getLs<any[]>(LS_PAYS, []);
    const p = pays.find(x => x.PaymentID === paymentId);
    if (p) {
      p.Status = 'Approved';
      p.ReviewedAt = new Date().toISOString();
      setLs(LS_PAYS, pays);

      const users = getLs<any[]>(LS_USERS, []);
      const u = users.find(x => x.userId === p.UserID);
      if (u) {
        u.status = 'Approved';
        setLs(LS_USERS, users);
      }
    }
  },

  async rejectPayment(paymentId: number, reason: string): Promise<void> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/admin/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return;
    } catch {}

    const pays = getLs<any[]>(LS_PAYS, []);
    const p = pays.find(x => x.PaymentID === paymentId);
    if (p) {
      p.Status = 'Rejected';
      p.RejectionReason = reason;
      p.ReviewedAt = new Date().toISOString();
      setLs(LS_PAYS, pays);

      const users = getLs<any[]>(LS_USERS, []);
      const u = users.find(x => x.userId === p.UserID);
      if (u) {
        u.status = 'Rejected';
        setLs(LS_USERS, users);
      }
    }
  },

  async blockOwner(ownerId: number, reason: string): Promise<void> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/admin/owners/${ownerId}/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return;
    } catch {}

    const users = getLs<any[]>(LS_USERS, []);
    const u = users.find(x => x.userId === ownerId);
    if (u) {
      u.status = 'Blocked';
      setLs(LS_USERS, users);
    }
  },

  async unblockOwner(ownerId: number): Promise<void> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/admin/owners/${ownerId}/unblock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return;
    } catch {}

    const users = getLs<any[]>(LS_USERS, []);
    const u = users.find(x => x.userId === ownerId);
    if (u) {
      u.status = 'Approved';
      setLs(LS_USERS, users);
    }
  },

  async getAuditLogs(): Promise<any[]> {
    const token = getStoredToken();
    try {
      const res = await fetch(`${API_BASE}/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) return await res.json();
    } catch {}

    return getLs<any[]>(LS_AUDIT, []);
  },
};
