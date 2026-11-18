const API_BASE = '/api';

export interface ServerState {
  menu?: any[];
  orders?: any[];
  settings?: any;
  tenants?: any[];
  tickets?: any[];
  flags?: any;
  maint?: string;
  maintMsg?: string;
  gatewayDown?: boolean;
  nextNo?: number;
  nextTicket?: number;
  audit?: any[];
}

export const api = {
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

  async fetchInitialState(): Promise<ServerState | null> {
    try {
      const [menuRes, ordersRes, settingsRes, tenantsRes, ticketsRes, sysRes, auditRes] =
        await Promise.all([
          fetch(`${API_BASE}/menu`),
          fetch(`${API_BASE}/orders`),
          fetch(`${API_BASE}/settings`),
          fetch(`${API_BASE}/tenants`),
          fetch(`${API_BASE}/tickets`),
          fetch(`${API_BASE}/system`),
          fetch(`${API_BASE}/audit`),
        ]);

      if (!menuRes.ok) return null;
      const ct = menuRes.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return null;

      const menu = await menuRes.json();
      const orders = await ordersRes.json();
      const settings = await settingsRes.json();
      const tenants = await tenantsRes.json();
      const tickets = await ticketsRes.json();
      const sys = await sysRes.json();
      const audit = await auditRes.json();

      return {
        menu,
        orders,
        settings,
        tenants,
        tickets,
        flags: sys.flags,
        maint: sys.maint,
        maintMsg: sys.maintMsg,
        gatewayDown: sys.gatewayDown,
        nextNo: sys.nextNo,
        nextTicket: sys.nextTicket,
        audit,
      };
    } catch (err) {
      console.warn('[API] Could not fetch server state from MSSQL backend:', err);
      return null;
    }
  },

  async createOrder(order: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      });
    } catch (err) {
      console.warn('[API] Failed to sync order to MSSQL:', err);
    }
  },

  async updateOrderStatus(no: number, status: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/orders/${no}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      console.warn('[API] Failed to update order status in MSSQL:', err);
    }
  },

  async payOrder(no: number, payInfo: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/orders/${no}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payInfo),
      });
    } catch (err) {
      console.warn('[API] Failed to record payment in MSSQL:', err);
    }
  },

  async createMenuItem(item: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/menu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
    } catch (err) {
      console.warn('[API] Failed to create menu item in MSSQL:', err);
    }
  },

  async updateMenuItem(id: string, p: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/menu/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
    } catch (err) {
      console.warn('[API] Failed to update menu item in MSSQL:', err);
    }
  },

  async deleteMenuItem(id: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/menu/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('[API] Failed to delete menu item in MSSQL:', err);
    }
  },

  async updateSettings(settings: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    } catch (err) {
      console.warn('[API] Failed to update settings in MSSQL:', err);
    }
  },

  async updateTenant(id: string, p: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/tenants/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
    } catch (err) {
      console.warn('[API] Failed to update tenant in MSSQL:', err);
    }
  },

  async createTicket(ticket: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticket),
      });
    } catch (err) {
      console.warn('[API] Failed to create ticket in MSSQL:', err);
    }
  },

  async updateTicketStatus(id: string, status: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/tickets/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      console.warn('[API] Failed to update ticket status in MSSQL:', err);
    }
  },

  async updateSystem(state: any): Promise<void> {
    try {
      await fetch(`${API_BASE}/system`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
    } catch (err) {
      console.warn('[API] Failed to update system state in MSSQL:', err);
    }
  },

  async postAudit(actor: string, text: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor, text }),
      });
    } catch (err) {
      console.warn('[API] Failed to post audit log in MSSQL:', err);
    }
  },

  async resetDatabase(): Promise<void> {
    try {
      await fetch(`${API_BASE}/reset`, { method: 'POST' });
    } catch (err) {
      console.warn('[API] Failed to reset database:', err);
    }
  },
};
