// Byte NCo Simple POS API Client
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

export const api = {
  getToken: getStoredToken,
  setToken: setStoredToken,

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
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
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async login(identifier: string, password: string): Promise<{ token: string; user: User }> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Login failed');
    setStoredToken(data.token);
    return data;
  },

  async register(params: {
    ownerName: string;
    mobile: string;
    cartName: string;
    city: string;
    password: string;
  }): Promise<{ token: string; user: User }> {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Registration failed');
    setStoredToken(data.token);
    return data;
  },

  logout() {
    setStoredToken(null);
  },

  // Payment instructions and submissions
  async getPaymentInstructions(): Promise<{ currency: string; fee: number; instructions: string }> {
    try {
      const res = await fetch(`${API_BASE}/payments/instructions`);
      if (res.ok) return await res.json();
    } catch {}
    return {
      currency: 'PKR',
      fee: 500,
      instructions: 'Transfer Rs. 500 to JazzCash/EasyPaisa: 0300-1234567 (Title: Byte NCo POS), and submit your Transaction Reference ID below.',
    };
  },

  async getMyPaymentStatus(): Promise<{ ownerStatus: string; payments: PaymentSubmission[] }> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/payments/my-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to fetch status');
    return data;
  },

  async submitPayment(params: {
    amount: number;
    paymentMethod: string;
    reference: string;
    proofBase64?: string;
  }): Promise<any> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/payments/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Payment submission failed');
    return data;
  },

  // Owner Products
  async getProducts(activeOnly = false): Promise<Product[]> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/products${activeOnly ? '?activeOnly=true' : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to fetch products');
    return data;
  },

  async createProduct(params: { productName: string; price: number; imageUrl?: string }): Promise<Product> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to create product');
    return data;
  },

  async updateProduct(id: number, params: { productName?: string; price?: number; imageUrl?: string; isActive?: boolean }): Promise<Product> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/products/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to update product');
    return data;
  },

  async toggleProduct(id: number): Promise<Product> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/products/${id}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to toggle product');
    return data;
  },

  // Checkout & Orders
  async checkout(params: {
    idempotencyKey: string;
    paymentMethod: 'Cash' | 'JazzCash' | 'EasyPaisa';
    items: Array<{ productId: number; quantity: number }>;
  }): Promise<{ message: string; order: Order }> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/orders/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Checkout failed');
    return data;
  },

  async getOrders(): Promise<Order[]> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to fetch orders');
    return data;
  },

  async getOrderDetail(id: number): Promise<Order> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/orders/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to fetch order detail');
    return data;
  },

  // Owner Dashboard
  async getTodayMetrics(): Promise<DashboardMetrics> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/dashboard/today`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to fetch dashboard metrics');
    return data;
  },

  // Admin APIs
  async getAdminStats(): Promise<AdminStats> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to fetch admin stats');
    return data;
  },

  async getAdminOwners(status?: string, search?: string): Promise<any[]> {
    const token = getStoredToken();
    const url = new URL(`${API_BASE}/admin/owners`, window.location.origin);
    if (status && status !== 'all') url.searchParams.set('status', status);
    if (search) url.searchParams.set('search', search);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to fetch owners');
    return data;
  },

  async approvePayment(paymentId: number): Promise<void> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/admin/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Approval failed');
  },

  async rejectPayment(paymentId: number, reason: string): Promise<void> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/admin/payments/${paymentId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Rejection failed');
  },

  async blockOwner(ownerId: number, reason: string): Promise<void> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/admin/owners/${ownerId}/block`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Block failed');
  },

  async unblockOwner(ownerId: number): Promise<void> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/admin/owners/${ownerId}/unblock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Unblock failed');
  },

  async getAuditLogs(): Promise<any[]> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to fetch audit logs');
    return data;
  },
};
