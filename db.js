/* طبقة البيانات: Supabase + كاش محلي + مزامنة لحظية */
'use strict';
const DB = (() => {
  let sb = null, ready = false, online = true, channel = null;
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
    channel = sb.channel('shop-live');
    ['items', 'log', 'shifts', 'settings', 'plans', 'payments'].forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, p => {
        if (p.eventType === 'DELETE') removeRow(table, p.old && p.old.id);
        else applyRow(table, p.new);
        sortAll(); saveCache();
        fire(table === 'log' && p.eventType === 'INSERT' ? { table, inserted: unpack(p.new) } : { table });
      });
    });
    channel.subscribe(st => {
      const was = online;
      online = st === 'SUBSCRIBED';
      if (was !== online || st === 'SUBSCRIBED') fire({ table: '_status' });
    });
  }

  async function init(url, key) {
    sb = window.supabase.createClient(url, key);
    await fetchAll();
    sortAll(); ready = true; online = true; saveCache(); subscribe();
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
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
    removeRow(table, id); saveCache(); fire({ table });
  };

  return {
    init, onChange, uid, loadCache,
    get ready() { return ready; },
    get online() { return online && navigator.onLine !== false; },
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
