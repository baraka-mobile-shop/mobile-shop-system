/* طبقة البيانات: Supabase + كاش محلي + مزامنة لحظية */
'use strict';
const DB = (() => {
  let sb = null, ready = false, online = true, channel = null, role = '';
  const state = { items: [], log: [], shifts: [], shop: null, plans: [], payments: [] };
  const listeners = [];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
  const onChange = f => listeners.push(f);
  const fire = what => listeners.forEach(f => { try { f(what); } catch (e) { console.error(e); } });

  const CK = 'shopapp-cache-v1';
  function saveCache() {
    try { localStorage.setItem(CK, JSON.stringify({ t: Date.now(), items: state.items, shifts: state.shifts, shop: state.shop, plans: state.plans, payments: state.payments, log: state.log.slice(0, 500) })); } catch (e) {}
  }
  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CK) || 'null');
      if (!c) return false;
      state.items = c.items || []; state.shifts = c.shifts || []; state.shop = c.shop;
      state.plans = c.plans || []; state.payments = c.payments || []; state.log = c.log || [];
      return true;
    } catch (e) { return false; }
  }

  const unpack = r => ({ id: r.id, ...(r.doc || {}) });

  async function fetchAll() {
    const [items, log, shifts, settings, plans, payments] = await Promise.all([
      sb.from('items').select('*'),
      sb.from('log').select('*').order('t', { ascending: false }).limit(3000),
      sb.from('shifts').select('*'),
      sb.from('settings').select('*'),
      sb.from('plans').select('*'),
      sb.from('payments').select('*')
    ]);
    const err = items.error || log.error || shifts.error || settings.error || plans.error || payments.error;
    if (err) throw err;
    state.items = items.data.map(unpack);
    state.log = log.data.map(unpack);
    state.shifts = shifts.data.map(unpack);
    state.shop = (settings.data.find(r => r.id === 'shop') || {}).doc || null;
    state.plans = plans.data.map(unpack);
    state.payments = payments.data.map(unpack);
  }

  function applyRow(table, row) {
    const arr = table === 'settings' ? null : state[table];
    if (table === 'settings') { if (row.id === 'shop') state.shop = row.doc || null; return; }
    if (!arr) return;
    const i = arr.findIndex(x => x.id === row.id);
    const v = unpack(row);
    if (i >= 0) arr[i] = v; else arr.push(v);
  }
  function removeRow(table, id) {
    const arr = state[table]; if (!arr) return;
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) arr.splice(i, 1);
  }

  function sortAll() {
    state.items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
    state.log.sort((a, b) => (b.t || 0) - (a.t || 0));
    state.shifts.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
    state.payments.sort((a, b) => (b.t || 0) - (a.t || 0));
  }

  function subscribe() {
    const wire = ch => {
      ['items', 'log', 'shifts', 'settings', 'plans', 'payments'].forEach(table => {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, p => {
          if (p.eventType === 'DELETE') removeRow(table, p.old && p.old.id);
          else applyRow(table, p.new);
          sortAll(); saveCache();
          fire(table === 'log' && p.eventType === 'INSERT' ? { table, inserted: unpack(p.new) } : { table });
        });
      });
      return ch;
    };
    let settled = false;
    channel = wire(sb.channel('shop-live', { config: { private: true } }));
    const fallback = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { sb.removeChannel(channel); } catch (e) {}
      channel = wire(sb.channel('shop-live-pub'));
      channel.subscribe(st => { online = st === 'SUBSCRIBED'; fire({ table: '_status' }); });
    }, 6000);
    channel.subscribe(st => {
      if (st === 'SUBSCRIBED') { settled = true; clearTimeout(fallback); }
      online = st === 'SUBSCRIBED';
      fire({ table: '_status' });
    });
  }

  async function init(url, key) {
    if (!sb) sb = window.supabase.createClient(url, key);
    const { data: sess } = await sb.auth.getSession();
    if (!sess || !sess.session) { const e = new Error('no-session'); e.code = 'AUTH'; throw e; }
    try { const u = sess.session.user; role = (u && u.app_metadata && u.app_metadata.role) || 'cashier'; try { localStorage.setItem('role', role); } catch (e) {} } catch (e) {}
    await fetchAll();
    sortAll(); ready = true; online = true; saveCache(); subscribe();
  }

  async function link(url, key, pw) {
    if (!sb) sb = window.supabase.createClient(url, key);
    const cfg = window.SHOP_CONFIG || {};
    const tries = [[cfg.cashierEmail, 'cashier'], [cfg.ownerEmail, 'owner']];
    for (const [email, r] of tries) {
      if (!email) continue;
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (!error && data && data.session) {
        role = (data.user && data.user.app_metadata && data.user.app_metadata.role) || r;
        try { localStorage.setItem('role', role); } catch (e) {}
        return role;
      }
    }
    const e = new Error('bad-code'); e.code = 'AUTH'; throw e;
  }

  /* كتابة: كل جدول صف فيه id + doc (+t للوج) */
  const put = async (table, id, doc, t) => {
    const row = { id, doc };
    if (table === 'log' || table === 'payments') row.t = t || doc.t || Date.now();
    const { error } = await sb.from(table).upsert(row);
    if (error) throw error;
    if (table === 'settings') { if (id === 'shop') state.shop = doc; }
    else applyRow(table, row);
    sortAll(); saveCache(); fire({ table });
  };
  const del = async (table, id) => {
    const { data, error } = await sb.from(table).delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || !data.length) { const e = new Error('not-allowed'); e.code = 'DENIED'; throw e; }
    removeRow(table, id); saveCache(); fire({ table });
  };

  return {
    init, onChange, uid, loadCache, link,
    get ready() { return ready; },
    get online() { return online && navigator.onLine !== false; },
    get role() { return role; },
    state,
    saveShop: doc => put('settings', 'shop', doc),
    putItem: (id, doc) => put('items', id, doc),
    delItem: id => del('items', id),
    addLog: rec => { const id = uid(); return put('log', id, rec, rec.t).then(() => id); },
    putShift: (id, doc) => put('shifts', id, doc),
    addShift: doc => { const id = uid(); return put('shifts', id, doc).then(() => id); },
    putPlan: (id, doc) => put('plans', id, doc),
    addPlan: doc => { const id = uid(); return put('plans', id, doc).then(() => id); },
    addPayment: rec => { const id = uid(); return put('payments', id, rec, rec.t).then(() => id); }
  };
})();
