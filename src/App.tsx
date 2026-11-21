import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api, User, Product, Order, DashboardMetrics, PaymentSubmission, AdminStats } from './api';

// Utility for formatting PKR currency
function fmtPkr(amount: number): string {
  return 'Rs. ' + (amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Format date in Asia/Karachi friendly format
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

  // Owner POS state
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Array<{ product: Product; qty: number }>>([]);
  const [payMethod, setPayMethod] = useState<'Cash' | 'JazzCash' | 'EasyPaisa'>('Cash');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [mobilePosTab, setMobilePosTab] = useState<'menu' | 'cart'>('menu');

  // Receipt Modal state
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptCopy, setReceiptCopy] = useState<'customer' | 'shop' | 'both'>('customer');
  const [receiptWidth, setReceiptWidth] = useState<'58mm' | '80mm'>('80mm');

  // Owner Dashboard state
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  // Owner Products state
  const [showAddProdModal, setShowAddProdModal] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdImg, setNewProdImg] = useState('');
  const [prodSubmitting, setProdSubmitting] = useState(false);

  // Owner Orders history
  const [orders, setOrders] = useState<Order[]>([]);

  // Owner Status / Payment submission state
  const [paymentSubmissions, setPaymentSubmissions] = useState<PaymentSubmission[]>([]);
  const [payAmount, setPayAmount] = useState('500');
  const [paySubmitMethod, setPaySubmitMethod] = useState('JazzCash');
  const [payRef, setPayRef] = useState('');
  const [payInstructions, setPayInstructions] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Admin Workspace state
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

  const toastTimerRef = useRef<any>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 3000);
  };

  // Check backend health and restore user session on mount
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

  // Fetch data whenever user or status changes
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
      // If status changed to Approved on server, update local user state
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

  // Refresh status button for Pending/Rejected owners
  const handleRefreshStatus = async () => {
    try {
      const updatedUser = await api.getMe();
      if (updatedUser) {
        setUser(updatedUser);
        showToast('Account status refreshed: ' + updatedUser.status);
      }
    } catch {
      showToast('Could not reach server.');
    }
  };

  // Auth Submit (Login / Register)
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);

    try {
      if (authMode === 'login') {
        const res = await api.login(loginId, loginPass);
        setUser(res.user);
        showToast('Welcome, ' + res.user.ownerName + '!');
      } else {
        // Register (Cart Owner only)
        const res = await api.register({
          ownerName: regName,
          mobile: regMobile,
          cartName: regCart,
          city: regCity,
          password: regPass,
        });
        setUser(res.user);
        showToast('Account registered! Status: Pending Approval.');
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

  // Payment Submission
  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payRef.trim()) {
      showToast('Please enter your transaction reference ID.');
      return;
    }
    setSubmittingPayment(true);
    try {
      await api.submitPayment({
        amount: parseFloat(payAmount) || 500,
        paymentMethod: paySubmitMethod,
        reference: payRef.trim(),
      });
      setPayRef('');
      showToast('Payment submitted successfully! Byte NCo Admin will review.');
      loadPaymentStatus();
    } catch (err: any) {
      showToast(err.message || 'Payment submission failed.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // POS Cart management
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

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.product.Price * item.qty, 0);
  }, [cart]);

  const cartItemCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.qty, 0);
  }, [cart]);

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
        items,
      });

      // Clear cart and show receipt dialog
      setCart([]);
      setReceiptOrder(res.order);
      setReceiptCopy('customer');
      showToast(`Sale completed! Order ${res.order.OrderNo}`);

      // Refresh dashboard & orders in background
      api.getOrders().then(setOrders);
      api.getTodayMetrics().then(setMetrics);
    } catch (err: any) {
      setCheckoutError(err.message || 'Checkout failed. Please try again.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Create Product
  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(newProdPrice);
    if (!newProdName.trim() || isNaN(priceNum) || priceNum <= 0) {
      showToast('Please enter a valid product name and positive price.');
      return;
    }
    setProdSubmitting(true);
    try {
      const created = await api.createProduct({
        productName: newProdName.trim(),
        price: priceNum,
        imageUrl: newProdImg.trim() || undefined,
      });
      setProducts(prev => [created, ...prev]);
      setShowAddProdModal(false);
      setNewProdName('');
      setNewProdPrice('');
      setNewProdImg('');
      showToast(`Product "${created.ProductName}" added successfully!`);
    } catch (err: any) {
      showToast(err.message || 'Failed to add product.');
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

  // Browser print trigger
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
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontFamily: 'var(--f-ui)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--f-display)', letterSpacing: '-0.5px', marginBottom: 8 }}>
            Byte NCo <span style={{ color: 'var(--accent)' }}>POS</span>
          </div>
          <p className="muted">Loading system...</p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // 1. PUBLIC AUTH SCREEN (Login & Register)
  // ----------------------------------------------------
  if (!user) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-brand">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 18 }}>
                B
              </div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Byte NCo</h1>
            </div>
            <p className="fine" style={{ marginTop: 4 }}>Fast, Simple POS for Food Carts & Street Vendors (PKR)</p>
          </div>

          {/* Role & Mode Switcher */}
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
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
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

          {authError && (
            <div className="alert bad" style={{ marginBottom: 14 }}>
              {authError}
            </div>
          )}

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
                    placeholder="Create a strong password"
                    value={regPass}
                    onChange={e => setRegPass(e.target.value)}
                    required
                  />
                </div>
              </>
            )}

            <button className="btn primary wide" type="submit" disabled={authSubmitting} style={{ marginTop: 8 }}>
              {authSubmitting ? 'Please wait...' : authMode === 'login' ? 'Sign In to POS' : 'Submit Cart Registration'}
            </button>
          </form>

          {/* Database & Vercel mode status */}
          <div style={{ marginTop: 18, textAlign: 'center', fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dbLive ? '#10b981' : '#64748b' }} />
            {dbLive ? 'MSSQL Database (ByteNcoDB Connected)' : 'Offline / Standalone Mode'}
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
            <button className="btn ghost sm" onClick={handleRefreshStatus}>
              Refresh Status
            </button>
            <button className="btn ghost sm" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <main className="page" style={{ maxWidth: 760, margin: '20px auto' }}>
          {user.status === 'Pending' && (
            <div className="card" style={{ padding: 24, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--warn-soft)', color: 'var(--warn)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 'bold' }}>
                  ⏳
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>Account Awaiting Approval</h2>
                  <p className="fine">Your cart is registered. Complete payment verification to unlock the POS.</p>
                </div>
              </div>

              <div style={{ background: 'var(--surface-2)', padding: 16, borderRadius: 'var(--r)', marginBottom: 20, borderLeft: '4px solid var(--accent)' }}>
                <h4 style={{ margin: '0 0 6px' }}>Payment Instructions (Subscription: Rs. 500)</h4>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                  {payInstructions || 'Please transfer Rs. 500 to JazzCash/EasyPaisa (0300-1234567, Title: Byte NCo POS) and submit your Transaction Reference ID below.'}
                </p>
              </div>

              <form onSubmit={handlePaymentSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label className="label">Payment Method Used</label>
                  <select
                    className="input"
                    value={paySubmitMethod}
                    onChange={e => setPaySubmitMethod(e.target.value)}
                  >
                    <option value="JazzCash">JazzCash</option>
                    <option value="EasyPaisa">EasyPaisa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="label">Amount Paid (PKR)</label>
                  <input
                    className="input"
                    type="number"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    required
                  />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="label">Transaction Reference / TID Number</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. TID-9876543210"
                    value={payRef}
                    onChange={e => setPayRef(e.target.value)}
                    required
                  />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <button className="btn primary wide" type="submit" disabled={submittingPayment}>
                    {submittingPayment ? 'Submitting...' : 'Submit Payment Reference for Admin Review'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {user.status === 'Rejected' && (
            <div className="card" style={{ padding: 24, marginBottom: 20, borderLeft: '4px solid var(--bad)' }}>
              <h2 style={{ margin: '0 0 8px', color: 'var(--bad)' }}>Application / Payment Rejected</h2>
              <p className="fine" style={{ marginBottom: 16 }}>
                Byte NCo administration reviewed your submission and marked it Rejected.
              </p>
              <div style={{ background: 'var(--bad-soft)', color: 'var(--bad)', padding: 12, borderRadius: 'var(--r)', marginBottom: 20 }}>
                <strong>Rejection Reason:</strong> {paymentSubmissions[0]?.RejectionReason || 'Invalid payment reference or unverified deposit.'}
              </div>
              <h4>Resubmit Payment Details:</h4>
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
            <div className="card" style={{ padding: 24, textAlign: 'center', borderLeft: '4px solid var(--bad)' }}>
              <h2 style={{ color: 'var(--bad)', marginTop: 0 }}>Account Suspended</h2>
              <p>Your cart account has been suspended by Byte NCo Administration. All POS and selling features are locked.</p>
              <p className="fine">Please contact Byte NCo Support for resolution.</p>
            </div>
          )}

          {/* Submissions History */}
          {paymentSubmissions.length > 0 && (
            <div className="card" style={{ padding: 18 }}>
              <h4 style={{ margin: '0 0 12px' }}>Your Payment Submissions</h4>
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
          {/* Top KPI row */}
          {adminStats && (
            <div className="kpis" style={{ marginBottom: 20 }}>
              <div className="kpi">
                <span className="kpi-l">Pending Approvals</span>
                <span className="kpi-v" style={{ color: adminStats.owners.Pending > 0 ? 'var(--warn)' : 'inherit' }}>
                  {adminStats.owners.Pending}
                </span>
                <span className="fine">{adminStats.pendingPayments} payments awaiting review</span>
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
                <span className="fine">{adminStats.totalPlatformOrders} lifetime orders</span>
              </div>
            </div>
          )}

          {adminActiveTab === 'owners' && (
            <div className="card" style={{ padding: 18 }}>
              {/* Filter bar */}
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
                <div style={{ flex: 1, minWidth: 200 }}>
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

              {/* Owners Table */}
              <table className="table">
                <thead>
                  <tr>
                    <th>Cart & Owner</th>
                    <th>City & Mobile</th>
                    <th>Status</th>
                    <th>Latest Payment</th>
                    <th>Orders</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {adminOwners.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)' }}>
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
                            </div>
                          ) : (
                            <span className="muted">No payment submitted</span>
                          )}
                        </td>
                        <td>
                          <strong>{o.OrdersCount || 0}</strong>
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
            <div className="card" style={{ padding: 18 }}>
              <h3 style={{ margin: '0 0 14px' }}>System & Admin Audit Logs</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp (Asia/Karachi)</th>
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

        {/* Admin Review Owner Modal */}
        {adminSelectedOwner && (
          <div className="scrim" onClick={() => setAdminSelectedOwner(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
              <div className="modal-h">
                <h3>Review Cart Owner: {adminSelectedOwner.CartName}</h3>
                <button className="btn ghost sm" onClick={() => setAdminSelectedOwner(null)}>✕</button>
              </div>
              <div className="modal-b">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
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

                <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 'var(--r)', marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px' }}>Latest Payment Submission</h4>
                  {adminSelectedOwner.LastPaymentRef ? (
                    <div>
                      <p style={{ margin: '0 0 4px' }}>
                        <strong>Reference ID:</strong> <span className="mono">{adminSelectedOwner.LastPaymentRef}</span>
                      </p>
                      <p style={{ margin: '0 0 4px' }}>
                        <strong>Amount:</strong> {fmtPkr(adminSelectedOwner.LastPaymentAmount)} &bull; <strong>Method:</strong> {adminSelectedOwner.LastPaymentMethod}
                      </p>
                      <p style={{ margin: 0, fontSize: 12 }} className="muted">
                        Submitted: {fmtDateTime(adminSelectedOwner.LastPaymentDate)} &bull; Status: {adminSelectedOwner.LastPaymentStatus}
                      </p>
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
                    <label className="label">Rejection Reason (Required to Reject)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="input sm"
                        placeholder="e.g. Invalid TID / Deposit unverified"
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
                        Reject Payment
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
                          Block Owner
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
      </div>
    );
  }

  // ----------------------------------------------------
  // 4. CART OWNER APPROVED WORKSPACE
  // ----------------------------------------------------
  return (
    <div className="shell">
      {/* Top Header */}
      <header className="topbar">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{user.cartName}</span>
            <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: 'var(--good-soft)', color: 'var(--good)', fontWeight: 600 }}>
              Approved
            </span>
          </h1>
          <p className="fine">Owner: {user.ownerName} &bull; {user.city} &bull; PKR (Asia/Karachi)</p>
        </div>
        <div className="top-actions">
          <span className={`pill ${dbLive ? 'good' : 'warn'}`}>
            {dbLive ? 'MSSQL DB' : 'Offline / Standalone'}
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
            <small>Simple POS</small>
          </div>
        </div>
        <nav className="rail-nav">
          <button
            className={`nav-btn ${activeTab === 'pos' ? 'active' : ''}`}
            onClick={() => setActiveTab('pos')}
          >
            <span>POS Register</span>
            {cartItemCount > 0 && <span className="badge">{cartItemCount}</span>}
          </button>
          <button
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span>Today's Sales</span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'products' ? 'active' : ''}`}
            onClick={() => setActiveTab('products')}
          >
            <span>Products</span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            <span>Orders & Receipts</span>
          </button>
          <button
            className={`nav-btn ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            <span>My Account</span>
          </button>
        </nav>
      </aside>

      {/* Main Workspace Area */}
      <main className="work">
        {/* TAB 1: POS REGISTER */}
        {activeTab === 'pos' && (
          <div className="page" style={{ height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
            {/* Mobile Tab Switcher for POS */}
            <div className="pos-mobile-tabs hide-desktop" style={{ display: 'none', marginBottom: 12 }}>
              <button
                className={`tab ${mobilePosTab === 'menu' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setMobilePosTab('menu')}
              >
                Products
              </button>
              <button
                className={`tab ${mobilePosTab === 'cart' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setMobilePosTab('cart')}
              >
                Cart ({cartItemCount}) &bull; {fmtPkr(cartTotal)}
              </button>
            </div>

            <div className="two" style={{ height: '100%' }}>
              {/* Left Column: Product Grid */}
              <div className="col" style={{ overflowY: 'auto', paddingRight: 8 }}>
                {products.length === 0 ? (
                  <div className="card" style={{ padding: 40, textAlign: 'center', marginTop: 20 }}>
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
                ) : (
                  <div className="tiles">
                    {products.map(p => (
                      <button
                        key={p.ProductID}
                        className="tile"
                        onClick={() => addToCart(p)}
                        style={{ position: 'relative' }}
                      >
                        <div className="tile-name">{p.ProductName}</div>
                        <div className="tile-price">{fmtPkr(p.Price)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Cart Drawer */}
              <div className="col" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)', borderRadius: 'var(--r)', border: '1px solid var(--line)' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>Current Order</h3>
                  <span className="fine muted">{cartItemCount} items</span>
                </div>

                {checkoutError && (
                  <div className="alert bad" style={{ margin: 12, padding: 8 }}>
                    {checkoutError}
                  </div>
                )}

                {/* Cart Items List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                  {cart.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--muted)' }}>
                      <p style={{ margin: 0, fontWeight: 500 }}>Cart is empty</p>
                      <p className="fine">Tap any product on the left to add items.</p>
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
                        <div style={{ flex: 1, paddingRight: 8 }}>
                          <div style={{ fontWeight: 600 }}>{item.product.ProductName}</div>
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
                          <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'center' }}>
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

                        <div style={{ minWidth: 70, textAlign: 'right', fontWeight: 700 }}>
                          {fmtPkr(item.product.Price * item.qty)}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Cart Footer & Checkout Action */}
                <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                  {/* Payment Method Selector */}
                  <label className="label" style={{ marginBottom: 6 }}>Payment Method</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 14 }}>
                    {(['Cash', 'JazzCash', 'EasyPaisa'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        className={`btn sm ${payMethod === m ? 'primary' : 'ghost'}`}
                        onClick={() => setPayMethod(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {/* Grand Total */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>Grand Total</span>
                    <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--f-display)' }}>
                      {fmtPkr(cartTotal)}
                    </span>
                  </div>

                  <button
                    className="btn primary wide"
                    disabled={cart.length === 0 || isCheckingOut}
                    onClick={handleCheckout}
                    style={{ height: 48, fontSize: 16 }}
                  >
                    {isCheckingOut ? 'Recording Sale...' : `COMPLETE SALE (${fmtPkr(cartTotal)})`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TODAY'S DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="page">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h2>Today's Performance</h2>
                <p className="fine">Business Day: {metrics?.date || 'Today'} &bull; Timezone: Asia/Karachi (PKR)</p>
              </div>
              <button className="btn sm ghost" onClick={() => api.getTodayMetrics().then(setMetrics)}>
                Refresh Metrics
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
                <span className="fine">Sales count today</span>
              </div>
              <div className="kpi">
                <span className="kpi-l">Today's Cash Only</span>
                <span className="kpi-v" style={{ color: 'var(--good)' }}>
                  {fmtPkr(metrics?.todayCashSales || 0)}
                </span>
                <span className="fine">Cash in hand</span>
              </div>
              <div className="kpi">
                <span className="kpi-l">Mobile Wallets</span>
                <span className="kpi-v" style={{ fontSize: 18, marginTop: 4 }}>
                  JazzCash: {fmtPkr(metrics?.todayJazzCashSales || 0)}
                </span>
                <span className="fine">EasyPaisa: {fmtPkr(metrics?.todayEasyPaisaSales || 0)}</span>
              </div>
            </div>

            {/* Truthful Empty State if no sales today */}
            {(!metrics || metrics.todayOrdersCount === 0) && (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
                <h4 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>No sales recorded yet today</h4>
                <p className="fine" style={{ maxWidth: 400, margin: '0 auto 16px' }}>
                  Orders completed in the POS register will automatically compute your daily totals and cash reconciliation here.
                </p>
                <button className="btn primary sm" onClick={() => setActiveTab('pos')}>
                  Go to POS Register
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PRODUCTS MANAGEMENT */}
        {activeTab === 'products' && (
          <div className="page">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h2>Product Catalogue</h2>
                <p className="fine">Manage your food cart menu items and prices</p>
              </div>
              <button className="btn primary sm" onClick={() => setShowAddProdModal(true)}>
                + Add Product
              </button>
            </div>

            {products.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🥘</div>
                <h3 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>No Products Added Yet</h3>
                <p className="fine" style={{ maxWidth: 360, margin: '0 auto 16px' }}>
                  Create your first product (e.g. Biryani, Bun Kabab, Chai, Roll) to start billing on your cart.
                </p>
                <button className="btn primary" onClick={() => setShowAddProdModal(true)}>
                  + Add Product Now
                </button>
              </div>
            ) : (
              <div className="card" style={{ padding: 18 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th>Price (PKR)</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.ProductID}>
                        <td>
                          <strong>{p.ProductName}</strong>
                        </td>
                        <td style={{ fontWeight: 600 }}>{fmtPkr(p.Price)}</td>
                        <td>
                          <span className={`pill ${p.IsActive ? 'good' : 'neutral'}`}>
                            {p.IsActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn ghost sm"
                            onClick={() => handleToggleProduct(p.ProductID)}
                          >
                            {p.IsActive ? 'Deactivate' : 'Activate'}
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

        {/* TAB 4: ORDERS & RECEIPTS */}
        {activeTab === 'orders' && (
          <div className="page">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h2>Order History & Receipts</h2>
                <p className="fine">Reprint customer or shop thermal slips</p>
              </div>
              <button className="btn ghost sm" onClick={() => api.getOrders().then(setOrders)}>
                Refresh Orders
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🧾</div>
                <h3 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>No Sales Yet</h3>
                <p className="fine" style={{ maxWidth: 360, margin: '0 auto 16px' }}>
                  Completed orders will appear here with instant thermal receipt reprint options.
                </p>
                <button className="btn primary sm" onClick={() => setActiveTab('pos')}>
                  Start Selling in POS
                </button>
              </div>
            ) : (
              <div className="card" style={{ padding: 18 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order No</th>
                      <th>Date & Time</th>
                      <th>Payment Method</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.OrderID}>
                        <td className="mono" style={{ fontWeight: 700 }}>{o.OrderNo}</td>
                        <td>{fmtDateTime(o.OrderDate)}</td>
                        <td>
                          <span className="pill neutral">{o.PaymentMethod}</span>
                        </td>
                        <td>{o.TotalItems || '-'} items</td>
                        <td style={{ fontWeight: 700 }}>{fmtPkr(o.TotalAmount)}</td>
                        <td>
                          <button
                            className="btn sm"
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
                            Print Receipt
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

        {/* TAB 5: MY ACCOUNT / STATUS */}
        {activeTab === 'status' && (
          <div className="page" style={{ maxWidth: 640 }}>
            <h2>Cart & Subscription Details</h2>
            <div className="card" style={{ padding: 20, marginBottom: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <span className="label">Cart Name</span>
                  <strong>{user.cartName}</strong>
                </div>
                <div>
                  <span className="label">Owner Name</span>
                  <strong>{user.ownerName}</strong>
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
                  <span className="label">Platform Version</span>
                  <strong>Byte NCo v1.0 (PKR)</strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: ADD PRODUCT */}
      {showAddProdModal && (
        <div className="scrim" onClick={() => setShowAddProdModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-h">
              <h3>Add New Product</h3>
              <button className="btn ghost sm" onClick={() => setShowAddProdModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateProduct}>
              <div className="modal-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label className="label">Product / Food Item Name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Chicken Biryani Half"
                    value={newProdName}
                    onChange={e => setNewProdName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Price in PKR (e.g. 250)</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="250"
                    value={newProdPrice}
                    onChange={e => setNewProdPrice(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Image URL (Optional)</label>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://..."
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
                  {prodSubmitting ? 'Saving...' : 'Add to Menu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: THERMAL RECEIPT SLIP & PRINT PREVIEW */}
      {receiptOrder && (
        <div className="scrim" onClick={() => setReceiptOrder(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-h no-print">
              <h3>Thermal Receipt Preview</h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`btn sm ${receiptWidth === '58mm' ? 'primary' : 'ghost'}`}
                  onClick={() => setReceiptWidth('58mm')}
                >
                  58mm (2")
                </button>
                <button
                  className={`btn sm ${receiptWidth === '80mm' ? 'primary' : 'ghost'}`}
                  onClick={() => setReceiptWidth('80mm')}
                >
                  80mm (3")
                </button>
                <button className="btn ghost sm" onClick={() => setReceiptOrder(null)}>✕</button>
              </div>
            </div>

            <div className="modal-b" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
              {/* Slip Print Preview Card */}
              <div className={`thermal-slip-box size-${receiptWidth}`}>
                {/* CUSTOMER COPY */}
                {(receiptCopy === 'customer' || receiptCopy === 'both') && (
                  <div>
                    <div className="thermal-slip-header">
                      <div style={{ fontSize: 16, fontWeight: 800 }}>Byte NCo - {receiptOrder.cartName || user.cartName}</div>
                      <div className="thermal-slip-copy-badge">CUSTOMER COPY</div>
                      <div style={{ marginTop: 6, fontSize: 11 }}>
                        Date: {fmtDateTime(receiptOrder.OrderDate)}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13, marginTop: 2 }}>
                        Order No: {receiptOrder.OrderNo}
                      </div>
                    </div>

                    {/* Line Items */}
                    <div style={{ margin: '8px 0' }}>
                      {(receiptOrder.items || []).map((it, idx) => (
                        <div key={idx} className="thermal-slip-row">
                          <span>{it.Qty} x {it.ProductNameSnapshot}</span>
                          <span style={{ fontWeight: 600 }}>{fmtPkr(it.SubTotal)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="thermal-slip-divider" />

                    <div className="thermal-slip-row" style={{ fontSize: 14, fontWeight: 800 }}>
                      <span>TOTAL</span>
                      <span>{fmtPkr(receiptOrder.TotalAmount)}</span>
                    </div>
                    <div className="thermal-slip-row" style={{ fontSize: 11 }}>
                      <span>Payment:</span>
                      <span style={{ fontWeight: 600 }}>{receiptOrder.PaymentMethod}</span>
                    </div>

                    <div className="thermal-slip-footer">
                      <div>Shukriya! Dobara Tashreef Layen</div>
                      <div style={{ fontSize: 10, marginTop: 4, color: 'var(--paper-mute)' }}>
                        Powered by Byte NCo Simple POS
                      </div>
                    </div>
                  </div>
                )}

                {/* SHOP COPY */}
                {(receiptCopy === 'shop' || receiptCopy === 'both') && (
                  <div style={{ marginTop: receiptCopy === 'both' ? 24 : 0 }}>
                    <div className="thermal-slip-header">
                      <div style={{ fontSize: 16, fontWeight: 800 }}>Byte NCo - {receiptOrder.cartName || user.cartName}</div>
                      <div className="thermal-slip-copy-badge" style={{ background: '#000', color: '#fff' }}>SHOP COPY</div>
                      <div style={{ marginTop: 6, fontSize: 11 }}>
                        Date: {fmtDateTime(receiptOrder.OrderDate)}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13, marginTop: 2 }}>
                        Order No: {receiptOrder.OrderNo}
                      </div>
                    </div>

                    {/* Line Items */}
                    <div style={{ margin: '8px 0' }}>
                      {(receiptOrder.items || []).map((it, idx) => (
                        <div key={idx} className="thermal-slip-row">
                          <span>{it.Qty} x {it.ProductNameSnapshot}</span>
                          <span style={{ fontWeight: 600 }}>{fmtPkr(it.SubTotal)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="thermal-slip-divider" />

                    <div className="thermal-slip-row" style={{ fontSize: 14, fontWeight: 800 }}>
                      <span>TOTAL</span>
                      <span>{fmtPkr(receiptOrder.TotalAmount)}</span>
                    </div>
                    <div className="thermal-slip-row" style={{ fontSize: 11 }}>
                      <span>Payment:</span>
                      <span style={{ fontWeight: 600 }}>{receiptOrder.PaymentMethod}</span>
                    </div>

                    <div className="thermal-slip-footer">
                      <div>INTERNAL SHOP RECORD</div>
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
