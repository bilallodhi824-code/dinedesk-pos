import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api, User, Product, Order, DashboardMetrics, PaymentSubmission, AdminStats } from './api';

// Currency Formatter for PKR
function fmtPkr(amount: number): string {
  return 'Rs. ' + (amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Format date in Asia/Karachi format
function fmtDateTime(dateStr?: string | number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function generateUuid(): string {
  return 'idemp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}

// ------------------------------ Crisp Clean SVG Icons ------------------------------
const Icon = {
  Cart: () => (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  Store: () => (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  Dashboard: () => (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  ),
  Receipt: () => (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z" /><line x1="8" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="13" y2="16" />
    </svg>
  ),
  Tag: () => (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  User: () => (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Printer: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
    </svg>
  ),
  Trash: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Search: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
};

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authRole, setAuthRole] = useState<'owner' | 'admin'>('owner');
  const [dbLive, setDbLive] = useState(false);

  // Form states for login/register
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [regName, setRegName] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regCart, setRegCart] = useState('');
  const [regCity, setRegCity] = useState('');
  const [regPass, setRegPass] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Owner active navigation tab
  const [activeTab, setActiveTab] = useState<'pos' | 'dashboard' | 'products' | 'orders' | 'status'>('pos');
  const [toastMsg, setToastMsg] = useState('');

  // POS State
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [posSearch, setPosSearch] = useState<string>('');
  const [cart, setCart] = useState<Array<{ product: Product; qty: number }>>([]);
  const [payMethod, setPayMethod] = useState<'Cash' | 'JazzCash' | 'EasyPaisa'>('Cash');
  const [cashTendered, setCashTendered] = useState<string>('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [mobilePosTab, setMobilePosTab] = useState<'menu' | 'cart'>('menu');

  // Receipt Modal State
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptCopy, setReceiptCopy] = useState<'customer' | 'shop' | 'both'>('customer');
  const [receiptWidth, setReceiptWidth] = useState<'58mm' | '80mm'>('80mm');

  // Owner Dashboard State
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  // Owner Products Management State
  const [showAddProdModal, setShowAddProdModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newProdName, setNewProdName] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('General');
  const [newProdImg, setNewProdImg] = useState('');
  const [prodSubmitting, setProdSubmitting] = useState(false);

  // Owner Orders History State
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderMethodFilter, setOrderMethodFilter] = useState('All');
  const [orderSearchQuery, setOrderSearchQuery] = useState('');

  // Owner Status & Payment Submission State
  const [paymentSubmissions, setPaymentSubmissions] = useState<PaymentSubmission[]>([]);
  const [payAmount, setPayAmount] = useState('500');
  const [paySubmitMethod, setPaySubmitMethod] = useState('JazzCash');
  const [payRef, setPayRef] = useState('');
  const [payProofBase64, setPayProofBase64] = useState<string>('');
  const [payInstructions, setPayInstructions] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Admin Workspace State
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [adminOwners, setAdminOwners] = useState<any[]>([]);
  const [adminStatusFilter, setAdminStatusFilter] = useState<string>('all');
  const [adminSearch, setAdminSearch] = useState('');
  const [adminSelectedOwner, setAdminSelectedOwner] = useState<any | null>(null);
  const [adminRejectReason, setAdminRejectReason] = useState('');
  const [adminBlockReason, setAdminBlockReason] = useState('');
  const [adminActionLoading, setAdminActionLoading] = useState(false);
  const [adminAuditLogs, setAdminAuditLogs] = useState<any[]>([]);
  const [adminActiveTab, setAdminActiveTab] = useState<'owners' | 'audit'>('owners');
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  const toastTimerRef = useRef<any>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 3200);
  };

  // Check health and authenticate session
  useEffect(() => {
    api.checkHealth().then(isOk => setDbLive(isOk));

    api.getMe().then(u => {
      if (u) {
        setUser(u);
        if (u.role === 'admin') setAuthRole('admin');
      }
      setLoadingUser(false);
    }).catch(() => setLoadingUser(false));
  }, []);

  // Sync data on user change
  useEffect(() => {
    if (!user) return;

    if (user.role === 'admin') {
      fetchAdminData();
    } else if (user.role === 'owner') {
      if (user.status === 'Approved') {
        loadOwnerData();
      } else {
        loadPaymentStatus();
      }
    }
  }, [user, user?.status]);

  const loadOwnerData = async () => {
    try {
      const [prods, ords, mtr] = await Promise.all([
        api.getProducts(true),
        api.getOrders(),
        api.getTodayMetrics(),
      ]);
      setProducts(prods);
      setOrders(ords);
      setMetrics(mtr);
    } catch (err) {
      console.warn('Failed to load owner data:', err);
    }
  };

  const loadPaymentStatus = async () => {
    try {
      const [statusRes, instRes] = await Promise.all([
        api.getMyPaymentStatus(),
        api.getPaymentInstructions(),
      ]);
      setPaymentSubmissions(statusRes.payments || []);
      setPayInstructions(instRes.instructions || '');
      if (statusRes.ownerStatus && statusRes.ownerStatus !== user?.status) {
        setUser(prev => prev ? { ...prev, status: statusRes.ownerStatus as any } : null);
      }
    } catch (err) {
      console.warn('Failed to load payment status:', err);
    }
  };

  const fetchAdminData = async () => {
    try {
      const [stats, ownersList, logs] = await Promise.all([
        api.getAdminStats(),
        api.getAdminOwners(adminStatusFilter, adminSearch),
        api.getAuditLogs(),
      ]);
      setAdminStats(stats);
      setAdminOwners(ownersList);
      setAdminAuditLogs(logs);
    } catch (err) {
      console.warn('Failed to fetch admin data:', err);
    }
  };

  // Auth Handling
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);

    try {
      if (authMode === 'login') {
        const res = await api.login(loginId, loginPass);
        setUser(res.user);
        showToast('Welcome back, ' + res.user.ownerName + '!');
      } else {
        const res = await api.register({
          ownerName: regName,
          mobile: regMobile,
          cartName: regCart,
          city: regCity,
          password: regPass,
        });
        setUser(res.user);
        showToast('Cart registered! Status: Pending Approval.');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    setUser(null);
    setCart([]);
    setReceiptOrder(null);
    showToast('Logged out successfully.');
  };

  // Payment Proof File Upload Reader
  const handleProofFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image file too large (Max 5MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPayProofBase64(reader.result as string);
      showToast('Payment screenshot attached!');
    };
    reader.readAsDataURL(file);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payRef.trim()) {
      showToast('Please enter your transaction reference TID.');
      return;
    }
    setSubmittingPayment(true);
    try {
      await api.submitPayment({
        amount: parseFloat(payAmount) || 500,
        paymentMethod: paySubmitMethod,
        reference: payRef.trim(),
        proofBase64: payProofBase64 || undefined,
      });
      setPayRef('');
      setPayProofBase64('');
      showToast('Payment submitted successfully! Byte NCo Admin will review.');
      loadPaymentStatus();
    } catch (err: any) {
      showToast(err.message || 'Payment submission failed.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Cart Management
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.ProductID === product.ProductID);
      if (existing) {
        return prev.map(item =>
          item.product.ProductID === product.ProductID ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart(prev =>
      prev
        .map(item => {
          if (item.product.ProductID === productId) {
            const newQty = item.qty + delta;
            return newQty > 0 ? { ...item, qty: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as Array<{ product: Product; qty: number }>
    );
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(item => item.product.ProductID !== productId));
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.product.Price * item.qty, 0);
  }, [cart]);

  const cartItemCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.qty, 0);
  }, [cart]);

  // Cash Tender & Change Calculation
  const cashNum = parseFloat(cashTendered) || 0;
  const changeDue = Math.max(0, cashNum - cartTotal);

  // Dynamic Product Categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (p.Category) set.add(p.Category);
    });
    return ['All', ...Array.from(set)];
  }, [products]);

  // Filtered Products for POS
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchCat = selectedCategory === 'All' || p.Category === selectedCategory;
      const matchQuery = !posSearch.trim() || p.ProductName.toLowerCase().includes(posSearch.toLowerCase().trim());
      return matchCat && matchQuery && p.IsActive;
    });
  }, [products, selectedCategory, posSearch]);

  // Filtered Orders for History
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const matchMethod = orderMethodFilter === 'All' || o.PaymentMethod === orderMethodFilter;
      const matchSearch = !orderSearchQuery.trim() || o.OrderNo.toLowerCase().includes(orderSearchQuery.toLowerCase().trim());
      return matchMethod && matchSearch;
    });
  }, [orders, orderMethodFilter, orderSearchQuery]);

  // Checkout Execution
  const handleCheckout = async () => {
    if (cart.length === 0) {
      setCheckoutError('Your cart is empty. Add products first.');
      return;
    }
    setCheckoutError('');
    setIsCheckingOut(true);

    try {
      const idempotencyKey = generateUuid();
      const items = cart.map(item => ({
        productId: item.product.ProductID,
        quantity: item.qty,
      }));

      const res = await api.checkout({
        idempotencyKey,
        paymentMethod: payMethod,
        cashReceived: payMethod === 'Cash' ? (cashNum > 0 ? cashNum : cartTotal) : null,
        changeDue: payMethod === 'Cash' ? (cashNum > cartTotal ? changeDue : 0) : null,
        items,
      });

      setCart([]);
      setCashTendered('');
      setReceiptOrder(res.order);
      setReceiptCopy('customer');
      showToast(`Sale recorded! Order ${res.order.OrderNo}`);

      // Refresh data
      api.getOrders().then(setOrders);
      api.getTodayMetrics().then(setMetrics);
    } catch (err: any) {
      setCheckoutError(err.message || 'Checkout failed. Please try again.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Product Add / Edit
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(newProdPrice);
    if (!newProdName.trim() || isNaN(priceNum) || priceNum <= 0) {
      showToast('Please enter a valid product name and positive price.');
      return;
    }
    setProdSubmitting(true);
    try {
      if (editingProduct) {
        const updated = await api.updateProduct(editingProduct.ProductID, {
          productName: newProdName.trim(),
          price: priceNum,
          category: newProdCategory.trim() || 'General',
          imageUrl: newProdImg.trim() || undefined,
        });
        setProducts(prev => prev.map(p => (p.ProductID === updated.ProductID ? updated : p)));
        showToast(`Product "${updated.ProductName}" updated.`);
      } else {
        const created = await api.createProduct({
          productName: newProdName.trim(),
          price: priceNum,
          category: newProdCategory.trim() || 'General',
          imageUrl: newProdImg.trim() || undefined,
        });
        setProducts(prev => [created, ...prev]);
        showToast(`Product "${created.ProductName}" added successfully!`);
      }
      setShowAddProdModal(false);
      setEditingProduct(null);
      setNewProdName('');
      setNewProdPrice('');
      setNewProdCategory('General');
      setNewProdImg('');
    } catch (err: any) {
      showToast(err.message || 'Failed to save product.');
    } finally {
      setProdSubmitting(false);
    }
  };

  const handleToggleProduct = async (productId: number) => {
    try {
      const updated = await api.toggleProduct(productId);
      setProducts(prev =>
        prev.map(p => (p.ProductID === productId ? { ...p, IsActive: updated.IsActive } : p))
      );
      showToast(`Product ${updated.IsActive ? 'activated' : 'deactivated'}.`);
    } catch (err: any) {
      showToast(err.message || 'Failed to update product.');
    }
  };

  const handleDeleteProduct = async (productId: number) => {
    if (!confirm('Are you sure you want to remove this product?')) return;
    try {
      await api.deleteProduct(productId);
      setProducts(prev => prev.filter(p => p.ProductID !== productId));
      showToast('Product removed.');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete product.');
    }
  };

  const handlePrint = (copy: 'customer' | 'shop' | 'both') => {
    setReceiptCopy(copy);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // ----------------------------------------------------
  // Loading Screen
  // ----------------------------------------------------
  if (loadingUser) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--f-display)', letterSpacing: '-0.5px', marginBottom: 8 }}>
            Byte NCo <span style={{ color: 'var(--accent)' }}>POS</span>
          </div>
          <p className="muted">Initializing Point of Sale System...</p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // 1. PUBLIC AUTH SCREEN (Login / Registration)
  // ----------------------------------------------------
  if (!user) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-brand">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 20 }}>
                B
              </div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Byte NCo</h1>
            </div>
            <p className="fine" style={{ marginTop: 6, fontSize: 13 }}>
              Lightweight, Touch-Friendly POS for Food Carts & Street Vendors
            </p>
          </div>

          <div className="tabs" style={{ marginBottom: 18 }}>
            <button
              className={`tab ${authRole === 'owner' ? 'active' : ''}`}
              onClick={() => { setAuthRole('owner'); setLoginId(''); }}
            >
              Food Cart Owner
            </button>
            <button
              className={`tab ${authRole === 'admin' ? 'active' : ''}`}
              onClick={() => { setAuthRole('admin'); setAuthMode('login'); setLoginId('admin@bytenco.com'); }}
            >
              Byte NCo Admin
            </button>
          </div>

          {authRole === 'owner' && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
              <button
                className={`btn sm ${authMode === 'login' ? 'primary' : 'ghost'}`}
                style={{ flex: 1 }}
                onClick={() => setAuthMode('login')}
              >
                Sign In
              </button>
              <button
                className={`btn sm ${authMode === 'register' ? 'primary' : 'ghost'}`}
                style={{ flex: 1 }}
                onClick={() => setAuthMode('register')}
              >
                Register New Cart
              </button>
            </div>
          )}

          {authError && <div className="alert bad">{authError}</div>}

          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {authMode === 'login' ? (
              <>
                <div>
                  <label className="label">
                    {authRole === 'admin' ? 'Admin Email' : 'Mobile Number (e.g. 03001234567)'}
                  </label>
                  <input
                    className="input"
                    type={authRole === 'admin' ? 'email' : 'text'}
                    placeholder={authRole === 'admin' ? 'admin@bytenco.com' : '03XXXXXXXXX'}
                    value={loginId}
                    onChange={e => setLoginId(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Enter password"
                    value={loginPass}
                    onChange={e => setLoginPass(e.target.value)}
                    required
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="label">Owner Full Name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Tariq Khan"
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Mobile Number</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="03XXXXXXXXX"
                    value={regMobile}
                    onChange={e => setRegMobile(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Food Cart / Stall Name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Khan Biryani & Roll Corner"
                    value={regCart}
                    onChange={e => setRegCart(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">City</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Karachi, Lahore, Rawalpindi"
                    value={regCity}
                    onChange={e => setRegCity(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Password (Min 6 characters)</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Create a secure password"
                    value={regPass}
                    onChange={e => setRegPass(e.target.value)}
                    required
                  />
                </div>
              </>
            )}

            <button className="btn primary wide" type="submit" disabled={authSubmitting} style={{ marginTop: 8 }}>
              {authSubmitting ? 'Verifying...' : authMode === 'login' ? 'Sign In to POS' : 'Submit Cart Registration'}
            </button>
          </form>

          <div style={{ marginTop: 18, textAlign: 'center', fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dbLive ? '#10b981' : '#64748b' }} />
            {dbLive ? 'MSSQL Database (ByteNcoDB Connected)' : 'Offline / Standalone Mode (Local Storage)'}
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // 2. OWNER STATUS GATE SCREEN (Pending / Rejected / Blocked)
  // ----------------------------------------------------
  if (user.role === 'owner' && user.status !== 'Approved') {
    return (
      <div className="shell">
        <header className="topbar">
          <div>
            <h1>{user.cartName || 'Byte NCo POS'}</h1>
            <p className="fine">Owner: {user.ownerName} ({user.mobile}) &bull; {user.city}</p>
          </div>
          <div className="top-actions">
            <span className={`pill ${user.status === 'Pending' ? 'warn' : 'bad'}`}>
              Status: {user.status}
            </span>
            <button className="btn ghost sm" onClick={loadPaymentStatus}>Refresh</button>
            <button className="btn ghost sm" onClick={handleLogout}>Logout</button>
          </div>
        </header>

        <main className="page" style={{ maxWidth: 780, margin: '20px auto' }}>
          {user.status === 'Pending' && (
            <div className="card" style={{ padding: 26, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--warn-soft)', color: 'var(--warn)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 'bold' }}>
                  ⏳
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20 }}>Account Awaiting Approval</h2>
                  <p className="fine">Your cart is registered. Complete payment verification to unlock the POS.</p>
                </div>
              </div>

              <div style={{ background: 'var(--surface-2)', padding: 18, borderRadius: 'var(--r)', marginBottom: 22, borderLeft: '4px solid var(--accent)' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>Payment Instructions (Subscription: Rs. 500)</h4>
                <p style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.5 }}>
                  {payInstructions || 'Please transfer Rs. 500 to JazzCash/EasyPaisa (0300-1234567, Title: Byte NCo POS) and submit your Transaction Reference ID below.'}
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span className="tender-pill jazzcash">JazzCash: 0300-1234567</span>
                  <span className="tender-pill easypaisa">EasyPaisa: 0300-1234567</span>
                </div>
              </div>

              <form onSubmit={handlePaymentSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label className="label">Payment Method Used</label>
                  <select className="input" value={paySubmitMethod} onChange={e => setPaySubmitMethod(e.target.value)}>
                    <option value="JazzCash">JazzCash</option>
                    <option value="EasyPaisa">EasyPaisa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="label">Amount Paid (PKR)</label>
                  <input className="input" type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} required />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="label">Transaction Reference / TID Number</label>
                  <input className="input" type="text" placeholder="e.g. TID-9876543210" value={payRef} onChange={e => setPayRef(e.target.value)} required />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="label">Attach Payment Screenshot (Optional)</label>
                  <input className="input" type="file" accept="image/*" onChange={handleProofFileChange} />
                  {payProofBase64 && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={payProofBase64} alt="Proof" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
                      <span className="fine" style={{ color: 'var(--good)' }}>Screenshot attached! Ready to submit.</span>
                    </div>
                  )}
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <button className="btn primary wide" type="submit" disabled={submittingPayment}>
                    {submittingPayment ? 'Submitting...' : 'Submit Payment for Admin Review'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {user.status === 'Rejected' && (
            <div className="card" style={{ padding: 24, marginBottom: 20, borderLeft: '4px solid var(--bad)' }}>
              <h2 style={{ margin: '0 0 8px', color: 'var(--bad)' }}>Application / Payment Rejected</h2>
              <p className="fine" style={{ marginBottom: 14 }}>
                Your payment submission was rejected by Byte NCo Administration.
              </p>
              <div style={{ background: 'var(--bad-soft)', color: 'var(--bad)', padding: 12, borderRadius: 'var(--r)', marginBottom: 18 }}>
                <strong>Rejection Reason:</strong> {paymentSubmissions[0]?.RejectionReason || 'Invalid transaction ID or deposit unverified.'}
              </div>
              <h4>Resubmit Correct Details:</h4>
              <form onSubmit={handlePaymentSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label className="label">Payment Method</label>
                  <select className="input" value={paySubmitMethod} onChange={e => setPaySubmitMethod(e.target.value)}>
                    <option value="JazzCash">JazzCash</option>
                    <option value="EasyPaisa">EasyPaisa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="label">Amount (PKR)</label>
                  <input className="input" type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} required />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="label">Correct Transaction Reference / TID</label>
                  <input className="input" type="text" placeholder="Correct TID" value={payRef} onChange={e => setPayRef(e.target.value)} required />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <button className="btn primary wide" type="submit" disabled={submittingPayment}>
                    Resubmit for Review
                  </button>
                </div>
              </form>
            </div>
          )}

          {user.status === 'Blocked' && (
            <div className="card" style={{ padding: 32, textAlign: 'center', borderLeft: '4px solid var(--bad)' }}>
              <h2 style={{ color: 'var(--bad)', marginTop: 0 }}>Account Suspended</h2>
              <p>Your cart account has been suspended by Byte NCo Administration. POS and selling features are locked.</p>
              <p className="fine">Please contact Byte NCo Support for resolution.</p>
            </div>
          )}

          {/* Submissions History */}
          {paymentSubmissions.length > 0 && (
            <div className="card" style={{ padding: 18 }}>
              <h4 style={{ margin: '0 0 12px' }}>Your Submissions History</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentSubmissions.map(sub => (
                    <tr key={sub.PaymentID}>
                      <td>{fmtDateTime(sub.CreatedAt)}</td>
                      <td>{sub.PaymentMethod}</td>
                      <td className="mono">{sub.Reference}</td>
                      <td>{fmtPkr(sub.Amount)}</td>
                      <td>
                        <span className={`pill ${sub.Status === 'Approved' ? 'good' : sub.Status === 'Pending' ? 'warn' : 'bad'}`}>
                          {sub.Status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    );
  }

  // ----------------------------------------------------
  // 3. BYTE NCO ADMIN WORKSPACE
  // ----------------------------------------------------
  if (user.role === 'admin') {
    return (
      <div className="shell">
        <header className="topbar">
          <div>
            <h1>Byte NCo <span style={{ color: 'var(--adm)' }}>Admin Portal</span></h1>
            <p className="fine">Signed in as: {user.email || user.ownerName} &bull; System Administration</p>
          </div>
          <div className="top-actions">
            <span className="pill good">Role: Administrator</span>
            <button className="btn ghost sm" onClick={fetchAdminData}>Refresh</button>
            <button className="btn ghost sm" onClick={handleLogout}>Logout</button>
          </div>
        </header>

        <div className="rail" style={{ background: 'var(--rail-adm)' }}>
          <div className="rail-head">
            <div className="logo-badge" style={{ background: 'var(--adm)' }}>BN</div>
            <div className="logo-text">
              <strong>Admin Panel</strong>
              <small>Review & Audit</small>
            </div>
          </div>
          <nav className="rail-nav">
            <button
              className={`nav-btn ${adminActiveTab === 'owners' ? 'active' : ''}`}
              onClick={() => setAdminActiveTab('owners')}
            >
              <span>Cart Owners & Payments</span>
              {adminStats && adminStats.pendingPayments > 0 && (
                <span className="badge">{adminStats.pendingPayments}</span>
              )}
            </button>
            <button
              className={`nav-btn ${adminActiveTab === 'audit' ? 'active' : ''}`}
              onClick={() => setAdminActiveTab('audit')}
            >
              <span>Audit Logs</span>
            </button>
          </nav>
        </div>

        <main className="work page">
          {adminStats && (
            <div className="kpis" style={{ marginBottom: 20 }}>
              <div className="kpi">
                <span className="kpi-l">Pending Approvals</span>
                <span className="kpi-v" style={{ color: adminStats.owners.Pending > 0 ? 'var(--warn)' : 'inherit' }}>
                  {adminStats.owners.Pending}
                </span>
                <span className="fine">{adminStats.pendingPayments} payments awaiting verification</span>
              </div>
              <div className="kpi">
                <span className="kpi-l">Approved Owners</span>
                <span className="kpi-v" style={{ color: 'var(--good)' }}>{adminStats.owners.Approved}</span>
                <span className="fine">Active carts in operation</span>
              </div>
              <div className="kpi">
                <span className="kpi-l">Rejected / Blocked</span>
                <span className="kpi-v" style={{ color: 'var(--bad)' }}>
                  {adminStats.owners.Rejected + adminStats.owners.Blocked}
                </span>
                <span className="fine">{adminStats.owners.Blocked} currently blocked</span>
              </div>
              <div className="kpi">
                <span className="kpi-l">Total Platform Sales</span>
                <span className="kpi-v">{fmtPkr(adminStats.totalPlatformSales)}</span>
                <span className="fine">{adminStats.totalPlatformOrders} lifetime sales</span>
              </div>
            </div>
          )}

          {adminActiveTab === 'owners' && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['all', 'Pending', 'Approved', 'Rejected', 'Blocked'].map(st => (
                    <button
                      key={st}
                      className={`btn sm ${adminStatusFilter === st ? 'primary' : 'ghost'}`}
                      onClick={() => {
                        setAdminStatusFilter(st);
                        api.getAdminOwners(st, adminSearch).then(setAdminOwners);
                      }}
                    >
                      {st.charAt(0).toUpperCase() + st.slice(1)}
                    </button>
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <input
                    className="input sm"
                    placeholder="Search by owner name, cart name, mobile..."
                    value={adminSearch}
                    onChange={e => {
                      setAdminSearch(e.target.value);
                      api.getAdminOwners(adminStatusFilter, e.target.value).then(setAdminOwners);
                    }}
                  />
                </div>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>Cart & Owner</th>
                    <th>City & Mobile</th>
                    <th>Status</th>
                    <th>Latest Payment</th>
                    <th>Sales</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {adminOwners.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)' }}>
                        No cart owners found matching this filter.
                      </td>
                    </tr>
                  ) : (
                    adminOwners.map(o => (
                      <tr key={o.UserID}>
                        <td>
                          <strong>{o.CartName}</strong>
                          <div className="fine">{o.OwnerName}</div>
                        </td>
                        <td>
                          <div>{o.City}</div>
                          <div className="fine mono">{o.Mobile}</div>
                        </td>
                        <td>
                          <span className={`pill ${o.Status === 'Approved' ? 'good' : o.Status === 'Pending' ? 'warn' : 'bad'}`}>
                            {o.Status}
                          </span>
                        </td>
                        <td>
                          {o.LastPaymentRef ? (
                            <div>
                              <span className="mono">{o.LastPaymentRef}</span>
                              <div className="fine">{fmtPkr(o.LastPaymentAmount)} ({o.LastPaymentMethod})</div>
                              {o.LastPaymentProof && (
                                <button
                                  className="btn ghost sm"
                                  style={{ padding: '0 4px', height: 20, fontSize: 11, color: 'var(--adm)' }}
                                  onClick={() => setLightboxImg(o.LastPaymentProof)}
                                >
                                  📷 View Proof Screenshot
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="muted">No submission</span>
                          )}
                        </td>
                        <td>
                          <strong>{o.OrdersCount || 0} orders</strong>
                          <div className="fine">{fmtPkr(o.TotalSales || 0)}</div>
                        </td>
                        <td>
                          <button
                            className="btn sm"
                            onClick={() => {
                              setAdminSelectedOwner(o);
                              setAdminRejectReason('');
                              setAdminBlockReason('');
                            }}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {adminActiveTab === 'audit' && (
            <div className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: '0 0 14px' }}>System & Admin Audit Logs</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Admin / Actor</th>
                    <th>Target Owner</th>
                    <th>Details / Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {adminAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                        No audit logs recorded yet.
                      </td>
                    </tr>
                  ) : (
                    adminAuditLogs.map(log => (
                      <tr key={log.LogID}>
                        <td className="mono">{fmtDateTime(log.CreatedAt)}</td>
                        <td>
                          <span className="pill neutral">{log.Action}</span>
                        </td>
                        <td>{log.AdminName || 'System'}</td>
                        <td>{log.OwnerName ? `${log.OwnerName} (${log.CartName})` : '-'}</td>
                        <td className="fine">{log.Details || log.Reason || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* Modal: Admin Owner Review */}
        {adminSelectedOwner && (
          <div className="scrim" onClick={() => setAdminSelectedOwner(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
              <div className="modal-h">
                <h3>Review Cart Owner: {adminSelectedOwner.CartName}</h3>
                <button className="btn ghost sm" onClick={() => setAdminSelectedOwner(null)}>✕</button>
              </div>
              <div className="modal-b">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <span className="label">Owner Name:</span>
                    <strong>{adminSelectedOwner.OwnerName}</strong>
                  </div>
                  <div>
                    <span className="label">Mobile:</span>
                    <strong className="mono">{adminSelectedOwner.Mobile}</strong>
                  </div>
                  <div>
                    <span className="label">City:</span>
                    <strong>{adminSelectedOwner.City}</strong>
                  </div>
                  <div>
                    <span className="label">Current Status:</span>
                    <span className={`pill ${adminSelectedOwner.Status === 'Approved' ? 'good' : adminSelectedOwner.Status === 'Pending' ? 'warn' : 'bad'}`}>
                      {adminSelectedOwner.Status}
                    </span>
                  </div>
                </div>

                <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 'var(--r)', marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px' }}>Payment Submission</h4>
                  {adminSelectedOwner.LastPaymentRef ? (
                    <div>
                      <p style={{ margin: '0 0 4px' }}>
                        <strong>Reference ID (TID):</strong> <span className="mono">{adminSelectedOwner.LastPaymentRef}</span>
                      </p>
                      <p style={{ margin: '0 0 4px' }}>
                        <strong>Amount:</strong> {fmtPkr(adminSelectedOwner.LastPaymentAmount)} &bull; <strong>Method:</strong> {adminSelectedOwner.LastPaymentMethod}
                      </p>
                      <p style={{ margin: 0, fontSize: 12 }} className="muted">
                        Submitted: {fmtDateTime(adminSelectedOwner.LastPaymentDate)}
                      </p>
                      {adminSelectedOwner.LastPaymentProof && (
                        <div style={{ marginTop: 10 }}>
                          <button
                            className="btn sm ghost"
                            onClick={() => setLightboxImg(adminSelectedOwner.LastPaymentProof)}
                          >
                            📷 Click to View Full Payment Screenshot
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ margin: 0, color: 'var(--muted)' }}>No payment record submitted yet.</p>
                  )}
                </div>

                {/* Approve Button */}
                {adminSelectedOwner.LastPaymentID && adminSelectedOwner.Status !== 'Approved' && (
                  <div style={{ marginBottom: 14 }}>
                    <button
                      className="btn primary wide"
                      disabled={adminActionLoading}
                      onClick={async () => {
                        setAdminActionLoading(true);
                        try {
                          await api.approvePayment(adminSelectedOwner.LastPaymentID);
                          showToast('Owner approved successfully!');
                          setAdminSelectedOwner(null);
                          fetchAdminData();
                        } catch (err: any) {
                          showToast(err.message || 'Approval failed.');
                        } finally {
                          setAdminActionLoading(false);
                        }
                      }}
                    >
                      ✓ Approve Payment & Activate Cart Owner
                    </button>
                  </div>
                )}

                {/* Reject Section */}
                {adminSelectedOwner.LastPaymentID && adminSelectedOwner.Status === 'Pending' && (
                  <div style={{ marginBottom: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                    <label className="label">Rejection Reason</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="input sm"
                        placeholder="e.g. Deposit unverified / Invalid TID"
                        value={adminRejectReason}
                        onChange={e => setAdminRejectReason(e.target.value)}
                      />
                      <button
                        className="btn danger sm"
                        disabled={!adminRejectReason.trim() || adminActionLoading}
                        onClick={async () => {
                          setAdminActionLoading(true);
                          try {
                            await api.rejectPayment(adminSelectedOwner.LastPaymentID, adminRejectReason.trim());
                            showToast('Payment rejected.');
                            setAdminSelectedOwner(null);
                            fetchAdminData();
                          } catch (err: any) {
                            showToast(err.message || 'Rejection failed.');
                          } finally {
                            setAdminActionLoading(false);
                          }
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Block / Unblock Section */}
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                  {adminSelectedOwner.Status !== 'Blocked' ? (
                    <div>
                      <label className="label">Emergency Suspend / Block Cart</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="input sm"
                          placeholder="Reason for suspension"
                          value={adminBlockReason}
                          onChange={e => setAdminBlockReason(e.target.value)}
                        />
                        <button
                          className="btn danger sm"
                          disabled={adminActionLoading}
                          onClick={async () => {
                            setAdminActionLoading(true);
                            try {
                              await api.blockOwner(adminSelectedOwner.UserID, adminBlockReason.trim() || 'Suspended by admin');
                              showToast('Owner blocked successfully.');
                              setAdminSelectedOwner(null);
                              fetchAdminData();
                            } catch (err: any) {
                              showToast(err.message || 'Block failed.');
                            } finally {
                              setAdminActionLoading(false);
                            }
                          }}
                        >
                          Block
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button
                        className="btn primary sm"
                        disabled={adminActionLoading}
                        onClick={async () => {
                          setAdminActionLoading(true);
                          try {
                            await api.unblockOwner(adminSelectedOwner.UserID);
                            showToast('Owner unblocked.');
                            setAdminSelectedOwner(null);
                            fetchAdminData();
                          } catch (err: any) {
                            showToast(err.message || 'Unblock failed.');
                          } finally {
                            setAdminActionLoading(false);
                          }
                        }}
                      >
                        Unblock Owner & Restore POS Access
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Screenshot Lightbox Modal */}
        {lightboxImg && (
          <div className="scrim" onClick={() => setLightboxImg(null)}>
            <div style={{ maxWidth: '90vw', maxHeight: '90vh', background: '#000', padding: 10, borderRadius: 12 }}>
              <img src={lightboxImg} alt="Proof" style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <button className="btn sm primary" onClick={() => setLightboxImg(null)}>Close Image</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------
  // 4. APPROVED CART OWNER WORKSPACE
  // ----------------------------------------------------
  return (
    <div className="shell">
      {/* Top Header */}
      <header className="topbar">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{user.cartName}</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--good-soft)', color: 'var(--good)', fontWeight: 700 }}>
              Approved
            </span>
          </h1>
          <p className="fine">Owner: {user.ownerName} &bull; {user.city} &bull; PKR (Asia/Karachi)</p>
        </div>
        <div className="top-actions">
          <span className={`pill ${dbLive ? 'good' : 'neutral'}`}>
            {dbLive ? 'MSSQL DB: Connected' : 'Local Storage Mode'}
          </span>
          <button className="btn ghost sm" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* Navigation Rail */}
      <aside className="rail">
        <div className="rail-head">
          <div className="logo-badge">BN</div>
          <div className="logo-text">
            <strong>Byte NCo</strong>
            <small>Simple POS v1.0</small>
          </div>
        </div>
        <nav className="rail-nav">
          <button
            className={`nav-btn ${activeTab === 'pos' ? 'active' : ''}`}
            onClick={() => setActiveTab('pos')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon.Store /> POS Register
            </span>
            {cartItemCount > 0 && <span className="badge">{cartItemCount}</span>}
          </button>
          <button
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon.Dashboard /> Today's Sales
            </span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'products' ? 'active' : ''}`}
            onClick={() => setActiveTab('products')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon.Tag /> Products
            </span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon.Receipt /> Orders & Receipts
            </span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon.User /> My Account
            </span>
          </button>
        </nav>
      </aside>

      {/* Main Workspace Area */}
      <main className="work">
        {/* ==================== TAB 1: POS REGISTER ==================== */}
        {activeTab === 'pos' && (
          <div className="page" style={{ height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
            <div className="two">
              {/* Left Column: Product Selection Grid */}
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                {/* Search & Categories */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        className="input sm"
                        placeholder="Search product (e.g. Biryani, Chai, Roll)..."
                        value={posSearch}
                        onChange={e => setPosSearch(e.target.value)}
                        style={{ paddingLeft: 34 }}
                      />
                      <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--muted)' }}>
                        <Icon.Search />
                      </span>
                    </div>
                  </div>

                  {/* Category Pills */}
                  {categories.length > 1 && (
                    <div className="category-bar">
                      {categories.map(cat => (
                        <button
                          key={cat}
                          className={`category-chip ${selectedCategory === cat ? 'active' : ''}`}
                          onClick={() => setSelectedCategory(cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Product Tiles */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                  {products.length === 0 ? (
                    <div className="card" style={{ padding: 40, textAlign: 'center', marginTop: 10 }}>
                      <div style={{ fontSize: 44, marginBottom: 12 }}>🛒</div>
                      <h3 style={{ margin: '0 0 8px' }}>Add Product First</h3>
                      <p className="muted" style={{ maxWidth: 360, margin: '0 auto 20px' }}>
                        Your catalog is currently empty. You must add at least one product before taking customer orders.
                      </p>
                      <button
                        className="btn primary"
                        onClick={() => {
                          setActiveTab('products');
                          setShowAddProdModal(true);
                        }}
                      >
                        + Add First Product
                      </button>
                    </div>
                  ) : filteredProducts.length === 0 ? (
                    <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>
                      No items found matching "{posSearch}".
                    </div>
                  ) : (
                    <div className="tiles">
                      {filteredProducts.map(p => (
                        <button
                          key={p.ProductID}
                          className="tile"
                          onClick={() => addToCart(p)}
                        >
                          <div>
                            {p.Category && <div className="tile-cat">{p.Category}</div>}
                            <div className="tile-name">{p.ProductName}</div>
                          </div>
                          <div className="tile-price">{fmtPkr(p.Price)}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Tactile Cart & Tender Drawer */}
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-2)' }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Current Bill</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="pill neutral">{cartItemCount} items</span>
                    {cart.length > 0 && (
                      <button
                        className="btn ghost sm"
                        style={{ padding: '0 6px', color: 'var(--bad)', height: 26 }}
                        onClick={() => setCart([])}
                        title="Clear Cart"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {checkoutError && (
                  <div className="alert bad" style={{ margin: 10, padding: 8 }}>
                    {checkoutError}
                  </div>
                )}

                {/* Cart Items List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                  {cart.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '50px 10px', color: 'var(--muted)' }}>
                      <p style={{ margin: 0, fontWeight: 600 }}>Cart is empty</p>
                      <p className="fine">Tap products on the left to add items.</p>
                    </div>
                  ) : (
                    cart.map(item => (
                      <div
                        key={item.product.ProductID}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 0',
                          borderBottom: '1px solid var(--line)',
                        }}
                      >
                        <div style={{ flex: 1, paddingRight: 6 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{item.product.ProductName}</div>
                          <div className="fine muted">{fmtPkr(item.product.Price)} each</div>
                        </div>

                        {/* Qty Controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            className="btn ghost sm"
                            style={{ width: 28, height: 28, padding: 0 }}
                            onClick={() => updateCartQty(item.product.ProductID, -1)}
                          >
                            -
                          </button>
                          <span style={{ fontWeight: 800, minWidth: 20, textAlign: 'center' }}>
                            {item.qty}
                          </span>
                          <button
                            className="btn ghost sm"
                            style={{ width: 28, height: 28, padding: 0 }}
                            onClick={() => updateCartQty(item.product.ProductID, 1)}
                          >
                            +
                          </button>
                        </div>

                        <div style={{ minWidth: 70, textAlign: 'right', fontWeight: 800, fontSize: 14 }}>
                          {fmtPkr(item.product.Price * item.qty)}
                        </div>

                        <button
                          className="btn ghost sm"
                          style={{ padding: '0 4px', color: 'var(--muted)', marginLeft: 4 }}
                          onClick={() => removeFromCart(item.product.ProductID)}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Tender & Checkout Footer */}
                <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                  {/* Tender Selector */}
                  <label className="label" style={{ marginBottom: 6 }}>Select Payment Tender</label>
                  <div className="tender-selector">
                    {(['Cash', 'JazzCash', 'EasyPaisa'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        className={`tender-btn ${payMethod === m ? 'active ' + m.toLowerCase() : ''}`}
                        onClick={() => setPayMethod(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {/* Cash Change Calculator (When Cash is chosen) */}
                  {payMethod === 'Cash' && cartTotal > 0 && (
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 'var(--r)', marginBottom: 12, border: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className="fine" style={{ fontWeight: 600 }}>Cash Received (PKR):</span>
                        <input
                          className="input sm"
                          style={{ width: 110, textAlign: 'right', fontWeight: 700 }}
                          placeholder={cartTotal.toString()}
                          value={cashTendered}
                          onChange={e => setCashTendered(e.target.value)}
                        />
                      </div>

                      {/* Quick Cash Keys */}
                      <div className="cash-keypad">
                        {[cartTotal, 100, 500, 1000, 5000].map(val => (
                          <button
                            key={val}
                            type="button"
                            className="cash-chip"
                            onClick={() => setCashTendered(val.toString())}
                          >
                            {val === cartTotal ? 'Exact' : `Rs. ${val}`}
                          </button>
                        ))}
                      </div>

                      {cashNum > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 6, borderTop: '1px dashed var(--line)' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Change Return:</span>
                          <span style={{ fontSize: 16, fontWeight: 800, color: changeDue > 0 ? 'var(--good)' : 'inherit' }}>
                            {fmtPkr(changeDue)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Total and Checkout Action */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>Total Payable</span>
                    <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--f-display)' }}>
                      {fmtPkr(cartTotal)}
                    </span>
                  </div>

                  <button
                    className="btn primary wide"
                    disabled={cart.length === 0 || isCheckingOut}
                    onClick={handleCheckout}
                    style={{ height: 48, fontSize: 15, fontWeight: 700 }}
                  >
                    {isCheckingOut ? 'Recording Sale...' : `COMPLETE SALE (${fmtPkr(cartTotal)})`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: TODAY'S DASHBOARD ==================== */}
        {activeTab === 'dashboard' && (
          <div className="page">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2>Today's Sales Dashboard</h2>
                <p className="fine">Business Day: {metrics?.date || 'Today'} &bull; Timezone: Asia/Karachi (PKR)</p>
              </div>
              <button className="btn sm ghost" onClick={() => api.getTodayMetrics().then(setMetrics)}>
                Refresh Sales
              </button>
            </div>

            <div className="kpis" style={{ marginBottom: 24 }}>
              <div className="kpi">
                <span className="kpi-l">Today's Total Sales</span>
                <span className="kpi-v" style={{ color: 'var(--accent)' }}>
                  {fmtPkr(metrics?.todayTotalSales || 0)}
                </span>
                <span className="fine">All completed orders today</span>
              </div>
              <div className="kpi">
                <span className="kpi-l">Today's Orders</span>
                <span className="kpi-v">{metrics?.todayOrdersCount || 0}</span>
                <span className="fine">Orders billed</span>
              </div>
              <div className="kpi">
                <span className="kpi-l">Cash in Drawer (Physical)</span>
                <span className="kpi-v" style={{ color: 'var(--good)' }}>
                  {fmtPkr(metrics?.todayCashSales || 0)}
                </span>
                <span className="fine">Physical cash sales only</span>
              </div>
              <div className="kpi">
                <span className="kpi-l">Mobile Wallets Total</span>
                <span className="kpi-v" style={{ fontSize: 20, color: 'var(--ink)' }}>
                  {fmtPkr((metrics?.todayJazzCashSales || 0) + (metrics?.todayEasyPaisaSales || 0))}
                </span>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <span className="tender-pill jazzcash">JazzCash: {fmtPkr(metrics?.todayJazzCashSales || 0)}</span>
                  <span className="tender-pill easypaisa">EasyPaisa: {fmtPkr(metrics?.todayEasyPaisaSales || 0)}</span>
                </div>
              </div>
            </div>

            {/* Truthful Empty State */}
            {(!metrics || metrics.todayOrdersCount === 0) && (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                <h3 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>No Sales Recorded Today Yet</h3>
                <p className="fine" style={{ maxWidth: 420, margin: '0 auto 18px' }}>
                  Orders completed in the POS register will automatically compute your daily totals and cash reconciliation here.
                </p>
                <button className="btn primary sm" onClick={() => setActiveTab('pos')}>
                  Go to POS Register
                </button>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 3: PRODUCTS MANAGEMENT ==================== */}
        {activeTab === 'products' && (
          <div className="page">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2>Product Catalogue</h2>
                <p className="fine">Add, edit, or deactivate food cart menu items and prices</p>
              </div>
              <button
                className="btn primary sm"
                onClick={() => {
                  setEditingProduct(null);
                  setNewProdName('');
                  setNewProdPrice('');
                  setNewProdCategory('General');
                  setNewProdImg('');
                  setShowAddProdModal(true);
                }}
              >
                + Add New Product
              </button>
            </div>

            {products.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🥘</div>
                <h3 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>No Products Added Yet</h3>
                <p className="fine" style={{ maxWidth: 380, margin: '0 auto 18px' }}>
                  Add your food items (e.g. Biryani, Bun Kabab, Chai, Samosa) to start billing customers.
                </p>
                <button
                  className="btn primary"
                  onClick={() => {
                    setEditingProduct(null);
                    setShowAddProdModal(true);
                  }}
                >
                  + Add First Product
                </button>
              </div>
            ) : (
              <div className="card" style={{ padding: 20 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th>Category</th>
                      <th>Price (PKR)</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.ProductID}>
                        <td>
                          <strong>{p.ProductName}</strong>
                        </td>
                        <td>
                          <span className="pill neutral">{p.Category || 'General'}</span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{fmtPkr(p.Price)}</td>
                        <td>
                          <span className={`pill ${p.IsActive ? 'good' : 'neutral'}`}>
                            {p.IsActive ? 'Active' : 'Deactivated'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn ghost sm"
                              onClick={() => {
                                setEditingProduct(p);
                                setNewProdName(p.ProductName);
                                setNewProdPrice(p.Price.toString());
                                setNewProdCategory(p.Category || 'General');
                                setNewProdImg(p.ImageUrl || '');
                                setShowAddProdModal(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="btn ghost sm"
                              onClick={() => handleToggleProduct(p.ProductID)}
                            >
                              {p.IsActive ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              className="btn danger sm"
                              style={{ padding: '0 8px' }}
                              onClick={() => handleDeleteProduct(p.ProductID)}
                              title="Delete Product"
                            >
                              <Icon.Trash />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 4: ORDERS & RECEIPTS ==================== */}
        {activeTab === 'orders' && (
          <div className="page">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2>Order History & Receipts</h2>
                <p className="fine">Reprint customer or shop thermal slips</p>
              </div>
              <button className="btn ghost sm" onClick={() => api.getOrders().then(setOrders)}>
                Refresh History
              </button>
            </div>

            {/* Filter and Search */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['All', 'Cash', 'JazzCash', 'EasyPaisa'].map(m => (
                  <button
                    key={m}
                    className={`btn sm ${orderMethodFilter === m ? 'primary' : 'ghost'}`}
                    onClick={() => setOrderMethodFilter(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <input
                  className="input sm"
                  placeholder="Search by Order # (e.g. #000101)..."
                  value={orderSearchQuery}
                  onChange={e => setOrderSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {orders.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
                <h3 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>No Sales Yet</h3>
                <p className="fine" style={{ maxWidth: 360, margin: '0 auto 18px' }}>
                  Completed sales from the POS register will appear here with instant thermal receipt reprint options.
                </p>
                <button className="btn primary sm" onClick={() => setActiveTab('pos')}>
                  Start Selling in POS
                </button>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>
                No orders found matching this filter.
              </div>
            ) : (
              <div className="card" style={{ padding: 20 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order No</th>
                      <th>Date & Time</th>
                      <th>Payment Tender</th>
                      <th>Items</th>
                      <th>Total (PKR)</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map(o => (
                      <tr key={o.OrderID}>
                        <td className="mono" style={{ fontWeight: 800 }}>{o.OrderNo}</td>
                        <td>{fmtDateTime(o.OrderDate)}</td>
                        <td>
                          <span className={`tender-pill ${o.PaymentMethod.toLowerCase()}`}>
                            {o.PaymentMethod}
                          </span>
                        </td>
                        <td>{o.TotalItems || '-'} items</td>
                        <td style={{ fontWeight: 800 }}>{fmtPkr(o.TotalAmount)}</td>
                        <td>
                          <button
                            className="btn sm"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                            onClick={async () => {
                              try {
                                const detail = await api.getOrderDetail(o.OrderID);
                                setReceiptOrder(detail);
                                setReceiptCopy('customer');
                              } catch (err: any) {
                                showToast(err.message || 'Failed to load order receipt');
                              }
                            }}
                          >
                            <Icon.Printer /> Reprint Slip
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 5: MY ACCOUNT / STATUS ==================== */}
        {activeTab === 'status' && (
          <div className="page" style={{ maxWidth: 680 }}>
            <h2>Cart & Subscription Details</h2>
            <div className="card" style={{ padding: 24, marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <span className="label">Cart Name</span>
                  <strong style={{ fontSize: 16 }}>{user.cartName}</strong>
                </div>
                <div>
                  <span className="label">Owner Name</span>
                  <strong style={{ fontSize: 16 }}>{user.ownerName}</strong>
                </div>
                <div>
                  <span className="label">Mobile Number</span>
                  <strong className="mono">{user.mobile}</strong>
                </div>
                <div>
                  <span className="label">City</span>
                  <strong>{user.city}</strong>
                </div>
                <div>
                  <span className="label">Account Status</span>
                  <span className="pill good">Approved & Active</span>
                </div>
                <div>
                  <span className="label">Platform Architecture</span>
                  <strong>Byte NCo POS v1.0 (PKR)</strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==================== MODAL: ADD / EDIT PRODUCT ==================== */}
      {showAddProdModal && (
        <div className="scrim" onClick={() => setShowAddProdModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-h">
              <h3>{editingProduct ? 'Edit Product' : 'Add New Product'}</h3>
              <button className="btn ghost sm" onClick={() => setShowAddProdModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveProduct}>
              <div className="modal-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label className="label">Product / Food Item Name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Special Chicken Biryani"
                    value={newProdName}
                    onChange={e => setNewProdName(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="label">Price in PKR</label>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="1"
                      placeholder="e.g. 250"
                      value={newProdPrice}
                      onChange={e => setNewProdPrice(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Category</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="e.g. Biryani, Rolls, Drinks"
                      value={newProdCategory}
                      onChange={e => setNewProdCategory(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Image URL (Optional)</label>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://images.unsplash.com/..."
                    value={newProdImg}
                    onChange={e => setNewProdImg(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-f">
                <button type="button" className="btn ghost" onClick={() => setShowAddProdModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={prodSubmitting}>
                  {prodSubmitting ? 'Saving...' : editingProduct ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: DUAL THERMAL RECEIPT PREVIEW & PRINT ==================== */}
      {receiptOrder && (
        <div className="scrim" onClick={() => setReceiptOrder(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-h no-print">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon.Printer /> Thermal Receipt
              </h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`btn sm ${receiptWidth === '58mm' ? 'primary' : 'ghost'}`}
                  onClick={() => setReceiptWidth('58mm')}
                >
                  58mm
                </button>
                <button
                  className={`btn sm ${receiptWidth === '80mm' ? 'primary' : 'ghost'}`}
                  onClick={() => setReceiptWidth('80mm')}
                >
                  80mm
                </button>
                <button className="btn ghost sm" onClick={() => setReceiptOrder(null)}>✕</button>
              </div>
            </div>

            <div className="modal-b" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
              <div className={`thermal-slip-box size-${receiptWidth}`}>
                {/* 1. CUSTOMER COPY */}
                {(receiptCopy === 'customer' || receiptCopy === 'both') && (
                  <div>
                    <div className="thermal-slip-header">
                      <div style={{ fontSize: 16, fontWeight: 900 }}>Byte NCo - {receiptOrder.cartName || user.cartName}</div>
                      <div style={{ fontSize: 11, marginTop: 2, color: 'var(--paper-mute)' }}>
                        {user.city} &bull; Ph: {user.mobile}
                      </div>
                      <div className="thermal-slip-copy-badge">CUSTOMER COPY</div>
                      <div style={{ marginTop: 6, fontSize: 11 }}>
                        Date: {fmtDateTime(receiptOrder.OrderDate)}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 14, marginTop: 2 }}>
                        Order: {receiptOrder.OrderNo}
                      </div>
                    </div>

                    {/* Items table */}
                    <div style={{ margin: '8px 0' }}>
                      {(receiptOrder.items || []).map((it, idx) => (
                        <div key={idx} className="thermal-slip-row">
                          <span>{it.Qty} x {it.ProductNameSnapshot}</span>
                          <span style={{ fontWeight: 700 }}>{fmtPkr(it.SubTotal)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="thermal-slip-divider" />

                    <div className="thermal-slip-row" style={{ fontSize: 15, fontWeight: 900 }}>
                      <span>GRAND TOTAL</span>
                      <span>{fmtPkr(receiptOrder.TotalAmount)}</span>
                    </div>

                    <div className="thermal-slip-row" style={{ fontSize: 11.5, marginTop: 4 }}>
                      <span>Payment Method:</span>
                      <span style={{ fontWeight: 700 }}>{receiptOrder.PaymentMethod}</span>
                    </div>

                    {receiptOrder.PaymentMethod === 'Cash' && receiptOrder.CashReceived && (
                      <>
                        <div className="thermal-slip-row" style={{ fontSize: 11 }}>
                          <span>Cash Received:</span>
                          <span>{fmtPkr(receiptOrder.CashReceived)}</span>
                        </div>
                        <div className="thermal-slip-row" style={{ fontSize: 11 }}>
                          <span>Change Returned:</span>
                          <span style={{ fontWeight: 700 }}>{fmtPkr(receiptOrder.ChangeDue || 0)}</span>
                        </div>
                      </>
                    )}

                    <div className="thermal-slip-footer">
                      <div style={{ fontWeight: 700, fontSize: 12 }}>شکریہ! دوبارہ تشریف لائیں</div>
                      <div style={{ fontSize: 11 }}>Shukriya! Dobara Tashreef Layen</div>
                      <div style={{ fontSize: 9, marginTop: 6, color: 'var(--paper-mute)' }}>
                        ||||| |||| |||||| |||| ||||| ||||
                      </div>
                      <div style={{ fontSize: 9, marginTop: 2, color: 'var(--paper-mute)' }}>
                        Powered by Byte NCo Simple POS
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. SHOP COPY */}
                {(receiptCopy === 'shop' || receiptCopy === 'both') && (
                  <div style={{ marginTop: receiptCopy === 'both' ? 26 : 0 }}>
                    <div className="thermal-slip-header">
                      <div style={{ fontSize: 16, fontWeight: 900 }}>Byte NCo - {receiptOrder.cartName || user.cartName}</div>
                      <div className="thermal-slip-copy-badge" style={{ background: '#000', color: '#fff' }}>SHOP COPY</div>
                      <div style={{ marginTop: 6, fontSize: 11 }}>
                        Date: {fmtDateTime(receiptOrder.OrderDate)}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 14, marginTop: 2 }}>
                        Order: {receiptOrder.OrderNo}
                      </div>
                    </div>

                    <div style={{ margin: '8px 0' }}>
                      {(receiptOrder.items || []).map((it, idx) => (
                        <div key={idx} className="thermal-slip-row">
                          <span>{it.Qty} x {it.ProductNameSnapshot}</span>
                          <span style={{ fontWeight: 700 }}>{fmtPkr(it.SubTotal)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="thermal-slip-divider" />

                    <div className="thermal-slip-row" style={{ fontSize: 15, fontWeight: 900 }}>
                      <span>TOTAL</span>
                      <span>{fmtPkr(receiptOrder.TotalAmount)}</span>
                    </div>

                    <div className="thermal-slip-row" style={{ fontSize: 11.5 }}>
                      <span>Method:</span>
                      <span style={{ fontWeight: 700 }}>{receiptOrder.PaymentMethod}</span>
                    </div>

                    <div className="thermal-slip-footer">
                      <div style={{ fontWeight: 700 }}>INTERNAL SHOP RECORD &bull; KEEP SAFELY</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-f no-print" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm primary" onClick={() => handlePrint('customer')}>
                  🖨️ Customer Copy
                </button>
                <button className="btn sm" onClick={() => handlePrint('shop')}>
                  🖨️ Shop Copy
                </button>
                <button className="btn sm" onClick={() => handlePrint('both')}>
                  Print Both
                </button>
              </div>
              <button className="btn ghost sm" onClick={() => setReceiptOrder(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Toast */}
      {toastMsg && (
        <div className="toast">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
