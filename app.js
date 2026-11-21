/* سيستم المحل — التطبيق الرئيسي */
'use strict';
/* ============ أدوات عامة ============ */
const $ = s => document.querySelector(s);
const num = v => (+v || 0).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = t => new Date(t).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fdate = t => new Date(t).toLocaleDateString('ar-EG');
const normAr = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const CATS = { new: 'جديد', used: 'مستعمل', acc: 'اكسسوار' };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addMonths = (t, k) => { const d = new Date(t); const day = d.getDate(); d.setMonth(d.getMonth() + k); if (d.getDate() < day) d.setDate(0); return d.getTime(); };

const DEV = (() => { try { let d = localStorage.getItem('dev'); if (!d) { d = Math.random().toString(36).slice(2, 9); localStorage.setItem('dev', d); } return d; } catch (e) { return 'x'; } })();
const who = () => { try { return localStorage.getItem('staff') || ''; } catch (e) { return ''; } };
const ownerOn = () => { try { return localStorage.getItem('owner') === '1'; } catch (e) { return false; } };
const meta = () => ({ by: who(), dev: DEV });
const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mobile-shop:' + t)))].map(x => x.toString(16).padStart(2, '0')).join('');

/* ============ حالة الواجهة ============ */
let tab = 'items', q = '', editId = null, moveId = null, moveMode = '', delArmed = false, busy = false;
let cachedLocal = false; // شغال من الكاش (أوفلاين)
const items = () => DB.state.items;
const logL = () => DB.state.log;
const shifts = () => DB.state.shifts;
const plans = () => DB.state.plans;
const payments = () => DB.state.payments;
const shop = () => DB.state.shop || { name: 'سيستم المحل', info: '', vat: 14, prefix: 'SN', staff: '' };
const find = id => items().find(i => i.id === id);
const shopName = () => shop().name || 'سيستم المحل';
const canW = () => DB.ready && DB.online && !cachedLocal;

function say(t, info, btn) {
  const m = $('#msg'); m.className = t ? ('show' + (info ? ' info' : '')) : '';
  m.innerHTML = t ? esc(t) + (btn ? ' <button id="migBtn" class="mini">' + esc(btn) + '</button>' : '') : '';
}
function toast(txt, warn) {
  const e = document.createElement('div'); e.className = 'toast' + (warn ? ' warn' : ''); e.textContent = txt;
  $('#toasts').appendChild(e); try { navigator.vibrate && navigator.vibrate(120); } catch (x) {}
  setTimeout(() => e.remove(), 7000);
}
function syncUI() {
  const e = $('#sync');
  if (!DB.ready) { e.textContent = 'جاري الاتصال...'; e.className = 'sync'; return; }
  if (!DB.online) { e.textContent = '● غير متصل — البيانات المعروضة آخر نسخة محفوظة'; e.className = 'sync off'; return; }
  e.textContent = '● متزامن'; e.className = 'sync on';
}

/* ============ أصناف: حسابات ============ */
const serialOf = i => i.imei || i.barcode || '';
const taxOf = i => i.cat === 'acc' ? 0 : (+i.taxAmt > 0 ? +i.taxAmt : 0);
const specLine = i => {
  const p = [serialOf(i) ? 'سريال ' + serialOf(i) : '', taxOf(i) > 0 ? 'ضريبة ' + num(taxOf(i)) + ' ج.م' : '', i.spec, i.color, i.battery ? 'بطارية ' + i.battery + '%' : ''].filter(Boolean);
  return p.length ? '<div class="note">' + esc(p.join(' • ')) + '</div>' : '';
};
const serials = k => {
  const p = (shop().prefix || 'SN').trim() + '-'; let m = 0;
  items().forEach(i => { if (i.barcode && String(i.barcode).startsWith(p)) { const n = parseInt(String(i.barcode).slice(p.length), 10); if (n > m) m = n; } });
  return Array.from({ length: k }, (_, j) => p + String(m + j + 1).padStart(4, '0'));
};
const newCode = () => serials(1)[0];
const invNo = () => { const d = new Date(); return 'INV-' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + Math.floor(1000 + Math.random() * 9000); };
const addLog = (id, name, cost, type, qty, price, extra) => DB.addLog({ t: Date.now(), iid: id, name, type, qty, price, cost, ...meta(), ...(extra || {}) });

/* ============ الشيفتات ============ */
const curShift = () => shifts().find(x => x.status === 'open');
const gate = () => { toast('افتح شيفت جديد الأول عشان تقدر تبيع أو تشتري.', true); window.scrollTo(0, 0); };
function shiftData(sh) {
  const to = sh.closedAt || Date.now();
  const L = sh.entries || logL().filter(l => l.t >= sh.openedAt && l.t <= to && (l.type === 'sell' || l.type === 'in')).map(l => ({ t: l.t, type: l.type, name: l.name, sn: l.imei || l.barcode || '', qty: l.qty, price: l.price || 0, cost: l.cost || 0, tax: l.taxAmt != null ? l.qty * l.taxAmt : 0, who: (l.buyer && l.buyer.name) || (l.seller && l.seller.name) || '', buy: !!l.seller, by: l.by || '' })).reverse();
  const sells = L.filter(x => x.type === 'sell'), cust = L.filter(x => x.type === 'in' && x.buy), rest = L.filter(x => x.type === 'in' && !x.buy);
  const sumA = (a, f) => a.reduce((t, x) => t + f(x), 0);
  return { L, sells, cust, rest, sales: sumA(sells, x => x.qty * x.price), tax: sumA(sells, x => x.tax), profit: sumA(sells, x => x.qty * (x.price - x.cost)), custTot: sumA(cust, x => x.qty * x.price), restTot: sumA(rest, x => x.qty * x.price), restQty: sumA(rest, x => x.qty) };
}

/* ============ الأقساط: حسابات ============ */
const planPaid = p => payments().filter(x => x.planId === p.id).reduce((t, x) => t + (+x.amount || 0), 0);
const planFinanced = p => Math.max(0, (+p.total || 0) - (+p.down || 0));
const planRemaining = p => Math.max(0, planFinanced(p) - planPaid(p));
const planNextDue = p => { const k = Math.floor(planPaid(p) / (+p.monthly || 1)); return addMonths(p.firstDue, Math.min(k, p.months - 1)); };
const planLate = p => planRemaining(p) > 0 && dayStart(planNextDue(p)) < dayStart(Date.now());
const planStatus = p => p.status === 'cancelled' ? 'ملغي' : planRemaining(p) <= 0 ? 'خلّص' : planLate(p) ? 'متأخر' : 'نشط';
function planSchedule(p) {
  const rows = []; const fin = planFinanced(p);
  let covered = planPaid(p);
  for (let k = 0; k < p.months; k++) {
    const amt = Math.min(+p.monthly, fin - k * p.monthly);
    const due = addMonths(p.firstDue, k);
    rows.push({ n: k + 1, due, amt, paid: covered >= amt, partial: covered > 0 && covered < amt });
    covered = Math.max(0, covered - amt);
  }
  return rows;
}

/* ============ التنبيهات ============ */
function alertsAll() {
  const A = [];
  logL().forEach(l => {
    if (l.type === 'sell' && l.price < l.cost) A.push({ t: l.t, lv: 'red', x: 'بيع بأقل من التكلفة: ' + l.name + ' بـ ' + num(l.price) + ' (التكلفة ' + num(l.cost) + ')', by: l.by });
    else if (l.type === 'sell' && l.list > 0 && l.price < l.list * 0.95) A.push({ t: l.t, lv: 'amber', x: 'خصم ' + Math.round((1 - l.price / l.list) * 100) + '% على ' + l.name + ' (' + num(l.list) + ' ← ' + num(l.price) + ')', by: l.by });
    else if (l.type === 'del') A.push({ t: l.t, lv: 'red', x: 'حذف صنف: ' + l.name + ' (كان ' + num(l.qty) + ' قطعة)', by: l.by });
    else if (l.type === 'adj' && l.from != null && l.qty < l.from) A.push({ t: l.t, lv: 'red', x: 'نقص كمية ' + l.name + ': ' + num(l.from) + ' ← ' + num(l.qty), by: l.by });
    else if (l.type === 'edit') A.push({ t: l.t, lv: 'amber', x: 'تغيير سعر ' + l.name + ': بيع ' + num(l.oldSell) + ' ← ' + num(l.price), by: l.by });
  });
  plans().filter(planLate).forEach(p => A.push({ t: planNextDue(p), lv: 'red', x: 'قسط متأخر على ' + (p.customer && p.customer.name || 'عميل') + ': ' + p.itemName + ' (متبقي ' + num(planRemaining(p)) + ' ج.م)', by: '' }));
  items().filter(i => !(i.qty === 0 && i.cat !== 'acc') && i.qty <= i.min).forEach(i => A.push({ t: 0, lv: 'amber', x: 'مخزون قليل: ' + i.name + ' (باقي ' + num(i.qty) + ')', by: '' }));
  return A.sort((a, b) => b.t - a.t);
}

/* ============ العرض الرئيسي ============ */
function render() {
  syncUI();
  if (tab === 'owner' && !ownerOn()) tab = 'items';
  $('#ownerBtn').textContent = ownerOn() ? '🔓' : '🔒';
  $('#ownerBtn').classList.toggle('on', ownerOn());
  $('#ownerBtn').title = ownerOn() ? 'وضع المالك مفعّل — اضغط للخروج' : 'دخول المالك';
  document.body.classList.toggle('own', ownerOn());
  $('#shopTitle').textContent = shopName();

  const cs = curShift();
  $('#shiftBar').innerHTML = cs
    ? `<span class="dot"></span><b>شيفت مفتوح</b><span class="note">من ${fmt(cs.openedAt)} · ${num(shiftData(cs).sells.length)} عملية بيع</span><button id="whoBtn">👤 ${esc(who() || 'اختار الموظف')}</button><button class="danger" id="shClose">قفل الشيفت</button>`
    : `<b>مفيش شيفت مفتوح</b><span class="note">افتح شيفت عشان تبدأ تبيع وتشتري</span><button id="whoBtn">👤 ${esc(who() || 'اختار الموظف')}</button><button class="pri" id="shOpen">فتح شيفت</button>`;

  const lateN = plans().filter(planLate).length;
  const cnt = k => items().filter(i => i.cat === k).length;
  const tabs = [['items', 'المخزن', items().length], ['plans', 'الأقساط', plans().filter(p => planRemaining(p) > 0 && p.status !== 'cancelled').length + (lateN ? ' 🔴' : '')], ['reports', 'التقارير', ''], ['log', 'السجل', logL().length], ['shifts', 'الشيفتات', shifts().length]];
  if (ownerOn()) tabs.push(['owner', 'لوحة المالك', alertsAll().filter(a => a.lv === 'red').length || '']);
  tabs.push(['more', '⚙️', '']);
  $('#tabs').innerHTML = tabs.map(t => `<button data-t="${t[0]}" class="${tab === t[0] ? 'on' : ''}">${t[1]}${t[2] !== '' ? ' (' + t[2] + ')' : ''}</button>`).join('');

  $('#main').innerHTML =
    tab === 'owner' && ownerOn() ? renderOwner() :
    tab === 'log' ? renderLog() :
    tab === 'shifts' ? renderShifts() :
    tab === 'plans' ? renderPlans() :
    tab === 'reports' ? renderReports() :
    tab === 'more' ? renderMore() :
    renderItems();
}

/* ---- المخزن ---- */
function renderItems() {
  const term = normAr(q.trim().toLowerCase());
  const cat = renderItems.cat || 'all';
  const list = items().filter(i => (cat === 'all' || term || i.cat === cat) && (!term || normAr(((i.name || '') + ' ' + (i.note || '') + ' ' + (i.spec || '') + ' ' + (i.imei || '') + ' ' + (i.barcode || '')).toLowerCase()).includes(term)));
  const pieces = items().reduce((a, i) => a + i.qty, 0), val = items().reduce((a, i) => a + i.qty * i.buy, 0);
  const lowN = items().filter(i => !(i.qty === 0 && i.cat !== 'acc') && i.qty <= i.min).length;
  const cs = curShift(), sd = cs ? shiftData(cs) : null;
  const head = `<div class="stats">
    <div class="stat ok"><b>${sd ? num(sd.sales + sd.tax) + ' ج.م' : '—'}</b><span>مبيعات الشيفت الحالي</span></div>
    <div class="stat cost"><b>${sd ? num(sd.profit) + ' ج.م' : '—'}</b><span>ربح الشيفت</span></div>
    <div class="stat"><b>${num(pieces)}</b><span>قطعة في المخزن</span></div>
    <div class="stat cost"><b>${num(val)} ج.م</b><span>قيمة البضاعة بسعر الشراء</span></div>
    <div class="stat ${lowN ? 'warn' : ''}"><b>${num(lowN)}</b><span>أصناف قربت تخلص</span></div>
  </div>
  <div class="bar">
    <button id="add" class="pri">+ صنف جديد</button>
    <button id="buyBtn">📥 شراء من عميل</button>
  </div>
  <div class="bar">
    <input type="search" id="q" placeholder="ابحث بالاسم أو السريال..." value="${esc(q)}">
    <button id="scanBtn" class="mini" title="مسح بالكاميرا">📷 مسح</button>
    ${['all', 'new', 'used', 'acc'].map(k => `<button class="mini ${cat === k ? 'pri' : ''}" data-cat="${k}">${k === 'all' ? 'الكل' : CATS[k]}</button>`).join('')}
  </div>`;
  if (!list.length) return head + `<div class="tbl"><div class="empty">${items().length ? 'مفيش نتايج للبحث ده.' : 'المخزن فاضي. اضغط «+ صنف جديد» وابدأ سجّل بضاعتك.'}</div></div>`;
  return head + `<div class="tbl"><table><thead><tr><th>الصنف</th><th>النوع</th><th>الكمية</th><th class="cost">الشراء</th><th>البيع</th><th></th></tr></thead><tbody>` +
    list.map(i => {
      const sold = i.qty === 0 && i.cat !== 'acc', low = !sold && i.qty <= i.min;
      return `<tr class="${sold ? 'sold' : low ? 'low' : ''}"><td><b>${esc(i.name)}</b>${specLine(i)}${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}</td><td><span class="chip">${CATS[i.cat] || ''}</span></td><td><span class="qty">${num(i.qty)}</span>${sold ? ' <span class="tag-sold">اتباع</span>' : i.qty === 0 ? ' <span class="tag-out">خلص</span>' : low ? ' <span class="tag-out">قليل</span>' : ''}</td><td class="cost">${num(i.buy)}</td><td>${num(i.sell)}</td><td><div class="act"><button class="sell" data-a="sell" data-id="${i.id}"${i.qty && canW() ? '' : ' disabled'}>بيع</button><button data-a="in" data-id="${i.id}"${canW() ? '' : ' disabled'}>توريد</button><button data-a="view" data-id="${i.id}">كشف</button><button data-a="edit" data-id="${i.id}"${canW() ? '' : ' disabled'}>تعديل</button><button data-a="code" data-id="${i.id}">ملصق</button></div></td></tr>`;
    }).join('') + `</tbody></table></div>`;
}

/* ---- السجل ---- */
const LT = l => l.type === 'sell' ? ['بيع', 'out', '-' + num(l.qty)] : l.type === 'in' ? [l.seller ? 'شراء من عميل' : 'توريد', 'inn', '+' + num(l.qty)] : l.type === 'del' ? ['حذف صنف', 'out', num(l.qty)] : l.type === 'edit' ? ['تعديل سعر', '', ''] : ['تعديل كمية', 'out', (l.from != null ? num(l.from) + ' ← ' : '') + num(l.qty)];
function renderLog() {
  const term = normAr(q.trim().toLowerCase());
  const L = logL().filter(l => !term || normAr(((l.name || '') + ' ' + (l.imei || '') + ' ' + (l.by || '') + ' ' + ((l.buyer && l.buyer.name) || '') + ' ' + ((l.buyer && l.buyer.phone) || '')).toLowerCase()).includes(term));
  const head = `<div class="bar"><input type="search" id="q" placeholder="ابحث في السجل (صنف، سريال، موظف، عميل)..." value="${esc(q)}"></div>`;
  if (!L.length) return head + `<div class="tbl"><div class="empty">مفيش حركة مطابقة.</div></div>`;
  return head + `<div class="tbl"><table><thead><tr><th>الوقت</th><th>الموظف</th><th>الصنف</th><th>الحركة</th><th>الكمية</th><th>السعر</th><th></th></tr></thead><tbody>` +
    L.slice(0, 300).map((l) => { const T = LT(l); const idx = logL().indexOf(l); return `<tr><td>${fmt(l.t)}</td><td>${esc(l.by || '—')}</td><td><b>${esc(l.name)}</b>${l.imei ? `<div class="note">${esc(l.imei)}</div>` : ''}${l.paym === 'inst' ? ' <span class="chip">تقسيط</span>' : ''}</td><td class="${T[1]}">${T[0]}</td><td>${T[2]}</td><td>${l.price ? num(l.price) : ''}</td><td>${l.type === 'sell' || l.seller ? `<button data-a="inv" data-i="${idx}">${l.seller ? 'إيصال' : 'فاتورة'}</button>` : ''}</td></tr>`; }).join('') + `</tbody></table></div>`;
}

/* ---- الشيفتات ---- */
function renderShifts() {
  if (!shifts().length) return `<div class="tbl"><div class="empty">لسه مفيش شيفتات. افتح أول شيفت من الشريط اللي فوق.</div></div>`;
  return `<div class="tbl"><table><thead><tr><th>الشيفت</th><th>المبيعات (بعد الضريبة)</th><th>المشتريات</th><th class="cost">الربح</th><th></th></tr></thead><tbody>` +
    shifts().map((sh, i) => { const d = shiftData(sh); return `<tr><td><b>${sh.status === 'open' ? '🟢 مفتوح دلوقتي' : 'مقفول'}</b><div class="note">${fmt(sh.openedAt)}${sh.closedAt ? ' ← ' + fmt(sh.closedAt) : ''}</div><div class="note">${esc(sh.openedBy || '')}</div></td><td>${num(d.sales + d.tax)}</td><td>${num(d.custTot + d.restTot)}</td><td class="cost">${num(d.profit)}</td><td><button data-a="sh" data-i="${i}">عرض / طباعة</button></td></tr>`; }).join('') + `</tbody></table></div>`;
}

/* ---- الأقساط ---- */
function renderPlans() {
  const term = normAr(q.trim().toLowerCase());
  const list = plans().filter(p => !term || normAr(((p.itemName || '') + ' ' + (p.imei || '') + ' ' + ((p.customer && p.customer.name) || '') + ' ' + ((p.customer && p.customer.phone) || '')).toLowerCase()).includes(term));
  const act = list.filter(p => planRemaining(p) > 0 && p.status !== 'cancelled');
  const done = list.filter(p => !(planRemaining(p) > 0 && p.status !== 'cancelled'));
  const lateTot = act.filter(planLate).reduce((t, p) => t + planRemaining(p), 0);
  const remTot = act.reduce((t, p) => t + planRemaining(p), 0);
  const card = p => {
    const st = planStatus(p), late = planLate(p), rem = planRemaining(p), paid = planPaid(p), fin = planFinanced(p);
    const pct = fin > 0 ? Math.min(100, Math.round(paid / fin * 100)) : 100;
    return `<div class="icard ${late ? 'lowq' : ''}">
      <div class="hd"><div><h4>${esc((p.customer && p.customer.name) || 'عميل')}</h4><div class="note">${esc(p.itemName)}${p.imei ? ' · ' + esc(p.imei) : ''}</div><div class="note">${esc((p.customer && p.customer.phone) || '')}</div></div>
      <span class="chip">${st}</span></div>
      <div class="prog"><i class="${late ? 'late' : ''}" style="width:${pct}%"></i></div>
      <div class="prices"><span>الإجمالي: <b>${num(p.total)}</b></span><span>المدفوع: <b class="inn">${num((+p.down || 0) + paid)}</b></span><span>الباقي: <b class="${rem ? 'out' : 'inn'}">${num(rem)}</b></span></div>
      ${rem > 0 ? `<div class="note">القسط الجاي: ${num(Math.min(p.monthly, rem))} ج.م يوم ${fdate(planNextDue(p))}${late ? ' — <b class="out">متأخر!</b>' : ''}</div>` : ''}
      <div class="act">${rem > 0 && p.status !== 'cancelled' ? `<button class="sell" data-a="pay" data-id="${p.id}"${canW() ? '' : ' disabled'}>تسجيل قسط</button>` : ''}<button data-a="plan" data-id="${p.id}">كشف حساب</button></div>
    </div>`;
  };
  return `<div class="stats">
      <div class="stat ${lateTot ? 'warn' : ''}"><b>${num(lateTot)} ج.م</b><span>أقساط متأخرة</span></div>
      <div class="stat"><b>${num(remTot)} ج.م</b><span>إجمالي المتبقي على العملاء</span></div>
      <div class="stat"><b>${num(act.length)}</b><span>خطة نشطة</span></div>
    </div>
    <div class="bar"><input type="search" id="q" placeholder="ابحث باسم العميل أو تليفونه أو سريال الجهاز..." value="${esc(q)}"></div>
    ${act.length ? `<h3 class="sec">خطط نشطة</h3><div class="cards">${act.map(card).join('')}</div>` : '<div class="tbl"><div class="empty">مفيش أقساط نشطة. لما تبيع جهاز بالتقسيط هيظهر هنا.</div></div>'}
    ${done.length ? `<h3 class="sec">خطط منتهية</h3><div class="cards">${done.slice(0, 10).map(card).join('')}</div>` : ''}`;
}

/* ---- التقارير ---- */
let repPeriod = 'month';
function periodRange() {
  const now = Date.now(), d = new Date();
  if (repPeriod === 'today') return [dayStart(now), now, 'اليوم'];
  if (repPeriod === 'week') return [now - 7 * 864e5, now, 'آخر ٧ أيام'];
  if (repPeriod === 'month') { const s = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); return [s, now, 'الشهر ده']; }
  if (repPeriod === 'last') { const s = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(); const e = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); return [s, e, 'الشهر اللي فات']; }
  return [0, now, 'كل الفترة المسجلة'];
}
function renderReports() {
  const [from, to, label] = periodRange();
  const L = logL().filter(l => l.t >= from && l.t <= to);
  const sells = L.filter(l => l.type === 'sell'), buys = L.filter(l => l.type === 'in' && l.seller), rest = L.filter(l => l.type === 'in' && !l.seller);
  const sumA = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const sales = sumA(sells, l => l.qty * l.price), tax = sumA(sells, l => (l.taxAmt || 0) * l.qty), profit = sumA(sells, l => l.qty * (l.price - l.cost));
  const cashSales = sumA(sells.filter(l => l.paym !== 'inst'), l => l.qty * l.price), instSales = sales - cashSales;
  const collected = payments().filter(p => p.t >= from && p.t <= to).reduce((t, p) => t + (+p.amount || 0), 0);
  const byItem = {}, byEmp = {};
  sells.forEach(l => { const k = l.name; const o = byItem[k] || (byItem[k] = { n: 0, s: 0, p: 0 }); o.n += l.qty; o.s += l.qty * l.price; o.p += l.qty * (l.price - l.cost); });
  sells.forEach(l => { const k = l.by || 'غير معروف'; const o = byEmp[k] || (byEmp[k] = { n: 0, s: 0, p: 0 }); o.n++; o.s += l.qty * l.price; o.p += l.qty * (l.price - l.cost); });
  const top = Object.entries(byItem).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  const P = [['today', 'اليوم'], ['week', '٧ أيام'], ['month', 'الشهر ده'], ['last', 'الشهر اللي فات'], ['all', 'الكل']];
  return `<div class="bar">${P.map(p => `<button class="mini ${repPeriod === p[0] ? 'pri' : ''}" data-rep="${p[0]}">${p[1]}</button>`).join('')}</div>
  <h3 class="sec">ملخص ${label}</h3>
  <div class="stats">
    <div class="stat ok"><b>${num(sales + tax)} ج.م</b><span>المبيعات (شاملة الضريبة)</span></div>
    <div class="stat cost"><b>${num(profit)} ج.م</b><span>الربح</span></div>
    <div class="stat"><b>${num(sells.length)}</b><span>عملية بيع</span></div>
    <div class="stat"><b>${num(tax)} ج.م</b><span>الضرائب المحصلة</span></div>
    <div class="stat"><b>${num(cashSales)} ج.م</b><span>مبيعات كاش</span></div>
    <div class="stat"><b>${num(instSales)} ج.م</b><span>مبيعات بالتقسيط</span></div>
    <div class="stat ok"><b>${num(collected)} ج.م</b><span>أقساط اتحصلت في الفترة</span></div>
    <div class="stat"><b>${num(buys.length)} جهاز بـ ${num(sumA(buys, l => l.qty * l.price))}</b><span>شراء من عملاء</span></div>
    <div class="stat"><b>${num(rest.reduce((t, l) => t + l.qty, 0))} قطعة</b><span>توريد بضاعة</span></div>
  </div>
  <h3 class="sec">أكتر الأصناف مبيعاً</h3>
  ${top.length ? `<div class="tbl"><table><thead><tr><th>الصنف</th><th>القطع</th><th>المبيعات</th><th class="cost">الربح</th></tr></thead><tbody>${top.map(([k, o]) => `<tr><td><b>${esc(k)}</b></td><td>${num(o.n)}</td><td>${num(o.s)}</td><td class="cost">${num(o.p)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="tbl"><div class="empty">مفيش مبيعات في الفترة دي.</div></div>'}
  <h3 class="sec">مبيعات الموظفين</h3>
  ${Object.keys(byEmp).length ? `<div class="tbl"><table><thead><tr><th>الموظف</th><th>عمليات</th><th>مبيعات</th><th class="cost">ربح</th></tr></thead><tbody>${Object.entries(byEmp).map(([k, o]) => `<tr><td><b>${esc(k)}</b></td><td>${num(o.n)}</td><td>${num(o.s)}</td><td class="cost">${num(o.p)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="tbl"><div class="empty">مفيش مبيعات في الفترة دي.</div></div>'}
  <h3 class="sec">تصدير ونسخ احتياطي</h3>
  <div class="bar">
    <button id="xlsInv">📊 المخزن Excel</button>
    <button id="xlsLog">📊 حركات الفترة Excel</button>
    <button id="xlsPlans">📊 الأقساط Excel</button>
    <button id="backupBtn" class="warn">💾 نسخة احتياطية كاملة</button>
  </div>
  <div class="note">النسخة الاحتياطية ملف JSON فيه كل البيانات (مخزن + حركات + شيفتات + أقساط). نزّلها كل فترة واحتفظ بيها.</div>`;
}

/* ---- لوحة المالك ---- */
function renderOwner() {
  const cs = curShift(), d = cs ? shiftData(cs) : null, by = {};
  if (d) d.sells.forEach(x => { const k = x.by || 'غير معروف', o = by[k] || (by[k] = { n: 0, s: 0, p: 0 }); o.n++; o.s += x.qty * x.price; o.p += x.qty * (x.price - x.cost); });
  const A = alertsAll().slice(0, 20), R = logL().slice(0, 12);
  const todayS = logL().filter(l => l.type === 'sell' && l.t >= dayStart(Date.now()));
  const todayTot = todayS.reduce((t, l) => t + l.qty * l.price + (l.taxAmt || 0) * l.qty, 0);
  const todayProf = todayS.reduce((t, l) => t + l.qty * (l.price - l.cost), 0);
  const al = A.length ? A.map(a => `<div class="al ${a.lv}"><b>${esc(a.x)}</b><div class="note">${a.t ? fmt(a.t) + ' · ' : ''}${esc(a.by || '')}</div></div>`).join('') : '<div class="feedbox"><div class="empty">مفيش تنبيهات ✓</div></div>';
  const emp = Object.keys(by).length ? `<div class="tbl"><table><thead><tr><th>الموظف</th><th>عمليات</th><th>مبيعات</th><th>ربح</th></tr></thead><tbody>` + Object.entries(by).map(([k, o]) => `<tr><td><b>${esc(k)}</b></td><td>${num(o.n)}</td><td>${num(o.s)}</td><td>${num(o.p)}</td></tr>`).join('') + `</tbody></table></div>` : `<div class="tbl"><div class="empty">${cs ? 'مفيش مبيعات في الشيفت لحد دلوقتي.' : 'مفيش شيفت مفتوح.'}</div></div>`;
  const feed = R.length ? R.map(l => { const T = LT(l); return `<div class="fd"><span class="${T[1]}"><b>${T[0]}</b></span> ${esc(l.name)} ${l.price && (l.type === 'sell' || l.type === 'in') ? '<b>' + num(l.qty * l.price) + ' ج.م</b>' : ''}<div class="note">${fmt(l.t)} · ${esc(l.by || 'غير معروف')}</div></div>`; }).join('') : '<div class="empty">لسه مفيش حركة.</div>';
  return `<div class="stats">
      <div class="stat ok"><b>${num(todayTot)} ج.م</b><span>مبيعات النهاردة</span></div>
      <div class="stat"><b>${num(todayProf)} ج.م</b><span>ربح النهاردة</span></div>
      <div class="stat ${A.filter(a => a.lv === 'red').length ? 'warn' : ''}"><b>${A.filter(a => a.lv === 'red').length}</b><span>تنبيه مهم</span></div>
    </div>
    <h3 class="sec">تنبيهات تستاهل تبص عليها</h3>${al}
    <h3 class="sec">مبيعات الموظفين في الشيفت الحالي</h3>${emp}
    <h3 class="sec">آخر الحركات</h3><div class="feedbox">${feed}</div>`;
}

/* ---- الإعدادات / المزيد ---- */
function renderMore() {
  return `<div class="cards">
    <div class="icard"><h4>⚙️ إعدادات المحل</h4><div class="note">الاسم، بيانات الفاتورة، الضريبة، بادئة الباركود، أسماء الموظفين.</div><div class="act"><button id="setBtn" class="pri">فتح الإعدادات</button></div></div>
    <div class="icard"><h4>📱 تثبيت التطبيق</h4><div class="note">ثبّت السيستم على جهاز الكاشير وعلى موبايل صاحب المحل من زرار التثبيت (⬇️) فوق، أو من قائمة المتصفح «إضافة إلى الشاشة الرئيسية».</div></div>
    <div class="icard"><h4>🔒 وضع المالك</h4><div class="note">وضع المالك بيفتح لوحة المالك والتقارير الكاملة وأسعار الشراء، وبيحميه رقم سري. ${ownerOn() ? 'مفعّل دلوقتي على الجهاز ده.' : 'اضغط 🔒 فوق عشان تدخل.'}</div></div>
    <div class="icard"><h4>ℹ️ عن السيستم</h4><div class="note">بيانات المحل متزامنة لحظياً بين كل الأجهزة. لو النت قطع، هتشوف آخر نسخة محفوظة بس مش هتقدر تسجل عمليات لحد ما النت يرجع.</div></div>
  </div>`;
}

/* ============ الفواتير والطباعة ============ */
function invHtml(r) {
  const buy = !!r.seller, b = r.buyer || r.seller || {}, sub = r.qty * r.price, tax = r.taxAmt != null ? r.qty * r.taxAmt : 0, tot = sub + tax;
  const w = [(r.imei || r.barcode) ? 'سريال ' + (r.imei || r.barcode) : '', r.spec, r.color, r.battery ? 'بطارية ' + r.battery + '%' : '', r.devTax ? 'ضريبة الجهاز ' + num(r.devTax) + ' ج.م' : ''].filter(Boolean).join(' • ');
  const row = (k, v) => `<tr><th style="width:32%">${k}</th><td>${esc(v || '')}</td></tr>`;
  let payBlock = '';
  if (!buy && r.paym === 'inst' && r.planId) {
    const p = plans().find(x => x.id === r.planId);
    if (p) payBlock = `<b class="sec">تفاصيل التقسيط</b><table>${row('الإجمالي', num(p.total) + ' ج.م')}${row('المقدم', num(p.down) + ' ج.م')}${row('المتبقي', num(planFinanced(p)) + ' ج.م')}${row('القسط الشهري', num(p.monthly) + ' ج.م × ' + p.months + ' شهر')}${row('أول قسط', fdate(p.firstDue))}</table>`;
  }
  const warr = !buy && r.warrantyMonths > 0 ? row('الضمان', r.warrantyMonths + ' شهر — حتى ' + fdate(addMonths(r.t, r.warrantyMonths))) : '';
  return `<div class="inv"><h2>${esc(shopName())}</h2>${shop().info ? '<div style="text-align:center;font-size:12px">' + esc(shop().info) + '</div>' : ''}<h3>${buy ? 'إيصال استلام موبايل من عميل' : (tax ? 'فاتورة بيع (بضريبة)' : 'فاتورة بيع')}</h3>
  <table>${row('رقم ' + (buy ? 'الإيصال' : 'الفاتورة'), r.inv)}${row('التاريخ', new Date(r.t).toLocaleString('ar-EG'))}${row('الموظف', r.by || '')}${warr}</table>
  <b class="sec">${buy ? 'بيانات البائع (العميل)' : 'بيانات المشتري'}</b><table>${row('الاسم', b.name)}${row('التليفون', b.phone)}${row('الرقم القومي', b.nid)}${row('العنوان', b.addr)}</table>
  <table><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr><tr><td>${esc(r.name)}${w ? '<div style="font-size:11px">' + esc(w) + '</div>' : ''}</td><td>${num(r.qty)}</td><td>${num(r.price)}</td><td>${num(sub)}</td></tr></table>
  ${tax ? `<p>الإجمالي قبل الضريبة: ${num(sub)} ج.م<br>الضريبة: ${num(tax)} ج.م</p>` : ''}
  <p><b>${buy ? 'المبلغ المدفوع للعميل' : r.paym === 'inst' ? 'المدفوع مقدماً' : 'الإجمالي'}: ${num(r.paym === 'inst' ? (plans().find(x => x.id === r.planId) || {}).down || 0 : tot)} ج.م</b></p>
  ${payBlock}
  <div class="sig"><span>${buy ? 'توقيع البائع (العميل)' : 'توقيع المشتري'}</span><span>${buy ? 'توقيع المحل' : 'توقيع البائع'}</span></div></div>`;
}
function showInv(r) { if (!r) return; $('#invBox').innerHTML = invHtml(r); $('#dInv').showModal(); }
function doPrint(sel, wide) {
  const html = $(sel).innerHTML;
  $('#printRoot').innerHTML = `<div class="r${wide ? ' wide' : ''}">${html}</div>`;
  window.print();
}
function shiftHtml(sh, d, count) {
  const m = v => num(v) + ' ج.م', row = (k, v) => `<tr><th style="width:55%">${k}</th><td>${v}</td></tr>`;
  const exp = (+sh.openCash || 0) + d.sales + d.tax - d.custTot - d.restTot;
  const cnt = sh.status === 'closed' ? sh.closeCash : count, has = cnt !== '' && cnt != null, diff = has ? +cnt - exp : 0;
  const notes = [sh.openNote, sh.closeNote].filter(Boolean).join(' / ');
  return `<div class="inv"><h2>${esc(shopName())}</h2><h3>تقرير الشيفت</h3>
  <table>${row('فتح', fmt(sh.openedAt) + (sh.openedBy ? ' — ' + esc(sh.openedBy) : ''))}${row('قفل', sh.closedAt ? fmt(sh.closedAt) + (sh.closedBy ? ' — ' + esc(sh.closedBy) : '') : 'لسه مفتوح')}${row('الكاش وقت الفتح', m(sh.openCash || 0))}</table>
  <b class="sec">المبيعات</b><table>${row('عدد عمليات البيع', num(d.sells.length))}${row('إجمالي المبيعات (قبل الضريبة)', m(d.sales))}${row('الضرائب', m(d.tax))}${row('الإجمالي بعد الضريبة', m(d.sales + d.tax))}${ownerOn() ? row('الربح', m(d.profit)) : ''}</table>
  <b class="sec">المشتريات</b><table>${row('شراء من عملاء (' + d.cust.length + ' جهاز)', m(d.custTot))}${row('توريد بضاعة (' + num(d.restQty) + ' قطعة)', m(d.restTot))}</table>
  <b class="sec">الحساب</b><table>${row('الكاش المتوقع (لو كل المعاملات كاش)', m(exp))}${has ? row('الكاش الفعلي', m(+cnt)) + row('الفرق', (diff > 0 ? '+' : '') + num(diff) + ' ج.م') : ''}</table>
  <b class="sec">تفاصيل العمليات</b><table><tr><th>الوقت</th><th>العملية</th><th>الصنف</th><th>الكمية</th><th>المبلغ</th></tr>${d.L.map(x => `<tr><td>${fmt(x.t)}</td><td>${x.type === 'sell' ? 'بيع' : x.buy ? 'شراء من عميل' : 'توريد'}</td><td>${esc(x.name)}${x.sn ? '<div style="font-size:10px">' + esc(x.sn) + '</div>' : ''}${x.who ? '<div style="font-size:10px">' + esc(x.who) + '</div>' : ''}${x.by ? '<div style="font-size:10px">موظف: ' + esc(x.by) + '</div>' : ''}</td><td>${num(x.qty)}</td><td>${num(x.qty * x.price)}</td></tr>`).join('') || '<tr><td colspan="5">مفيش عمليات</td></tr>'}</table>
  ${notes ? '<p>ملاحظات: ' + esc(notes) + '</p>' : ''}</div>`;
}
function planHtml(p) {
  const row = (k, v) => `<tr><th style="width:38%">${k}</th><td>${esc(v)}</td></tr>`;
  const c = p.customer || {};
  const sched = planSchedule(p);
  const pays = payments().filter(x => x.planId === p.id).sort((a, b) => a.t - b.t);
  return `<div class="inv"><h2>${esc(shopName())}</h2>${shop().info ? '<div style="text-align:center;font-size:12px">' + esc(shop().info) + '</div>' : ''}<h3>كشف حساب تقسيط</h3>
  <table>${row('رقم الفاتورة', p.inv || '')}${row('الجهاز', p.itemName + (p.imei ? ' — ' + p.imei : ''))}${row('تاريخ البيع', fdate(p.createdAt))}</table>
  <b class="sec">بيانات العميل</b><table>${row('الاسم', c.name)}${row('التليفون', c.phone)}${row('الرقم القومي', c.nid)}${row('العنوان', c.addr)}</table>
  <b class="sec">الخطة</b><table>${row('إجمالي السعر', num(p.total) + ' ج.م')}${row('المقدم', num(p.down) + ' ج.م')}${row('المتبقي على أقساط', num(planFinanced(p)) + ' ج.م')}${row('القسط الشهري', num(p.monthly) + ' ج.م')}${row('عدد الشهور', String(p.months))}${row('المدفوع من الأقساط', num(planPaid(p)) + ' ج.م')}${row('الباقي الآن', num(planRemaining(p)) + ' ج.م')}${row('الحالة', planStatus(p))}</table>
  <b class="sec">جدول الأقساط</b><table><tr><th>قسط</th><th>تاريخ الاستحقاق</th><th>المبلغ</th><th>الحالة</th></tr>${sched.map(s => `<tr><td>${s.n}</td><td>${fdate(s.due)}</td><td>${num(s.amt)}</td><td>${s.paid ? 'اتدفع ✓' : s.partial ? 'جزء منه اتدفع' : dayStart(s.due) < dayStart(Date.now()) ? 'متأخر' : 'جاي'}</td></tr>`).join('')}</table>
  ${pays.length ? `<b class="sec">الدفعات المسجلة</b><table><tr><th>التاريخ</th><th>المبلغ</th><th>الموظف</th></tr>${pays.map(x => `<tr><td>${fmt(x.t)}</td><td>${num(x.amount)}</td><td>${esc(x.by || '')}</td></tr>`).join('')}</table>` : ''}
  <div class="sig"><span>توقيع العميل</span><span>توقيع المحل</span></div></div>`;
}

/* ============ تفاصيل صنف + الضمان ============ */
function detailHtml(i) {
  const sale = logL().find(l => l.iid === i.id && l.type === 'sell');
  const src = logL().find(l => l.iid === i.id && l.seller);
  const first = logL().slice().reverse().find(l => l.iid === i.id && l.type === 'in');
  let warr = '';
  if (sale && sale.warrantyMonths > 0) {
    const end = addMonths(sale.t, sale.warrantyMonths);
    warr = ['الضمان', sale.warrantyMonths + ' شهر — ' + (Date.now() > end ? 'انتهى في ' + fdate(end) : 'ساري حتى ' + fdate(end))];
  }
  const rows = [['الصنف', i.name], ['النوع', CATS[i.cat]], ['السريال (IMEI)', serialOf(i)], ['المواصفات', [i.spec, i.color].filter(Boolean).join(' - ')], ['البطارية', i.battery ? i.battery + '%' : ''], ['تاريخ الشراء', (i.added || (first && first.t)) ? fdate(i.added || first.t) : ''], ...(ownerOn() ? [['سعر الشراء', num(i.buy) + ' ج.م']] : []), ['المورد', i.supplier || (src && src.seller && src.seller.name) || ''], ['السعر المطلوب', num(i.sell) + ' ج.م'], ['الضريبة', taxOf(i) > 0 ? num(taxOf(i)) + ' ج.م' : 'بدون ضريبة'], ['الحالة', i.qty > 0 ? 'متاح في المحل (' + num(i.qty) + ')' : 'اتباع'], ['تاريخ البيع', sale ? fdate(sale.t) : ''], ['سعر البيع', sale ? num(sale.price) + ' ج.م' : ''], ['العميل', sale && sale.buyer ? sale.buyer.name + (sale.buyer.phone ? ' — ' + sale.buyer.phone : '') : ''], ...(warr ? [warr] : []), ['ملاحظات', i.note]].filter(r => r[1]);
  return `<div class="paper"><table class="kv" style="min-width:0">${rows.map(r => `<tr><th>${r[0]}</th><td>${esc(r[1])}</td></tr>`).join('')}</table></div>`;
}

/* ============ الماسح بالكاميرا ============ */
let scanStream = null, scanTimer = null, scanCb = null;
async function openScan(cb) {
  scanCb = cb;
  if (!('BarcodeDetector' in window)) { toast('المتصفح ده مش بيدعم مسح الباركود بالكاميرا. اكتب الرقم يدوي.', true); return; }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) { toast('مقدرناش نفتح الكاميرا. اسمح للمتصفح يستخدمها وجرب تاني.', true); return; }
  $('#scanVideo').srcObject = scanStream;
  await $('#scanVideo').play().catch(() => {});
  $('#scanMsg').textContent = 'وجّه الكاميرا ناحية الباركود...';
  $('#dScan').showModal();
  let det;
  try { det = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'data_matrix', 'itf', 'upc_a', 'upc_e'] }); }
  catch (e) { det = new BarcodeDetector(); }
  scanTimer = setInterval(async () => {
    if (!$('#dScan').open) return closeScan();
    try {
      const codes = await det.detect($('#scanVideo'));
      if (codes && codes.length) { const v = codes[0].rawValue; const cb2 = scanCb; closeScan(); if (cb2) cb2(v); }
    } catch (e) {}
  }, 350);
}
function closeScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  if ($('#dScan').open) $('#dScan').close();
}

/* ============ حوار الصنف ============ */
function multiUI() {
  $('#fTaxBox').style.display = $('#fCat').value === 'acc' ? 'none' : '';
  const n = +$('#fQty').value || 0, show = $('#fCat').value !== 'acc' && n > 1;
  $('#multiBox').classList.toggle('hidden', !show);
  $('#fImeiBox').style.display = show ? 'none' : '';
  $('#multiN').textContent = n;
}
function openItem(id) {
  if (!canW()) return toast('مفيش اتصال بالنت دلوقتي — مش هتقدر تحفظ.', true);
  editId = id; delArmed = false; const i = id ? find(id) : null;
  $('#dItemT').textContent = i ? 'تعديل الصنف' : 'صنف جديد';
  $('#fName').value = i ? i.name : ''; $('#fCat').value = i ? i.cat : 'new';
  $('#fQty').value = i ? i.qty : 0; $('#fBuy').value = i ? i.buy : ''; $('#fSell').value = i ? i.sell : '';
  $('#fMin').value = i ? i.min : 2; $('#fNote').value = i ? (i.note || '') : ''; $('#fSpec').value = i ? (i.spec || '') : '';
  $('#fColor').value = i ? (i.color || '') : ''; $('#fBat').value = i ? (i.battery || '') : ''; $('#fImei').value = i ? (i.imei || '') : '';
  $('#fSup').value = i ? (i.supplier || '') : ''; $('#itemMsg').textContent = ''; $('#fImeis').value = ''; multiUI();
  $('#fTaxAmt').value = i ? (taxOf(i) || '') : '';
  $('#itemDel').classList.toggle('hidden', !i); $('#itemDel').textContent = 'حذف الصنف';
  $('#dItem').showModal();
}
async function saveItem() {
  const name = $('#fName').value.trim(); if (!name) { $('#fName').focus(); return; }
  if (busy) return; busy = true;
  const msg = t => { $('#itemMsg').textContent = t; busy = false; };
  const d = { name, cat: $('#fCat').value, qty: Math.max(0, Math.floor(+$('#fQty').value || 0)), buy: +$('#fBuy').value || 0, sell: +$('#fSell').value || 0, min: Math.max(0, Math.floor(+$('#fMin').value || 0)), note: $('#fNote').value.trim(), spec: $('#fSpec').value.trim(), color: $('#fColor').value.trim(), battery: $('#fBat').value.trim(), imei: $('#fImei').value.trim(), supplier: $('#fSup').value.trim(), taxAmt: $('#fCat').value === 'acc' ? 0 : (+$('#fTaxAmt').value || 0) };
  const multi = d.cat !== 'acc' && d.qty > 1;
  if (d.qty > 50) return msg('أقصى عدد 50 جهاز في المرة.');
  const norm = x => normAr(x.trim());
  const list = multi ? $('#fImeis').value.split('\n').map(norm).filter(Boolean) : (d.imei ? [norm(d.imei)] : []);
  if (list.length > d.qty) return msg('عدد الأرقام أكبر من عدد الأجهزة.');
  if (new Set(list).size < list.length) return msg('فيه رقم مكرر في القايمة.');
  const dup = items().find(x => x.imei && list.includes(normAr(x.imei)) && x.id !== editId && x.qty > 0);
  if (dup) return msg('السريال ' + dup.imei + ' مسجل قبل كده على: ' + dup.name);
  try {
    if (multi) {
      const oldBc = editId ? (find(editId) || {}).barcode : '', codes = serials(d.qty); let c = 0;
      const units = Array.from({ length: d.qty }, (_, k) => { const im = list[k] || ''; return { ...d, qty: 1, imei: im, barcode: im || (k === 0 && oldBc) || codes[c++] }; });
      for (let k = 0; k < units.length; k++) {
        if (editId && k === 0) { await DB.putItem(editId, { ...find(editId), ...units[0] }); continue; }
        const u = { ...units[k], added: Date.now() }, id = DB.uid();
        await DB.putItem(id, u);
        if (!editId) await addLog(id, u.name, u.buy, 'in', 1, u.buy);
      }
    } else if (editId) {
      if (d.imei) d.barcode = norm(d.imei);
      const i = find(editId);
      await DB.putItem(editId, { ...i, ...d, imei: d.imei ? norm(d.imei) : '' });
      if (i && d.qty !== i.qty) await addLog(editId, d.name, d.buy, 'adj', d.qty, 0, { from: i.qty });
      if (i && (d.sell !== i.sell || d.buy !== i.buy)) await addLog(editId, d.name, d.buy, 'edit', i.qty, d.sell, { oldSell: i.sell, oldBuy: i.buy });
    } else {
      d.imei = d.imei ? norm(d.imei) : '';
      d.barcode = d.imei || newCode(); d.added = Date.now();
      const id = DB.uid(); await DB.putItem(id, d);
      if (d.qty) await addLog(id, d.name, d.buy, 'in', d.qty, d.buy);
    }
    $('#dItem').close();
  } catch (e) { console.error(e); msg('مقدرناش نحفظ. اتأكد من النت وجرّب تاني.'); }
  busy = false;
}

/* ============ بيع / توريد ============ */
function moveSum() {
  const qt = +$('#mQty').value || 0, pr = +$('#mPrice').value || 0, tx = +$('#bTaxAmt').value || 0;
  $('#sumLine').textContent = 'الإجمالي: ' + num(qt * pr + qt * tx) + ' ج.م' + (tx > 0 ? ' (منها ضريبة ' + num(qt * tx) + ')' : ' (بدون ضريبة)');
  const inst = document.querySelector('input[name=paym]:checked').value === 'inst';
  if (inst) {
    const total = qt * pr + qt * tx, down = +$('#bDown').value || 0, months = Math.max(1, +$('#bMonths').value || 1);
    const fin = Math.max(0, total - down), monthly = Math.ceil(fin / months);
    $('#instCalc').textContent = fin <= 0 ? 'المقدم بيغطي كامل المبلغ.' : 'المتبقي ' + num(fin) + ' ج.م على ' + months + ' شهر = قسط ' + num(monthly) + ' ج.م/شهر';
  }
}
function paymUI() {
  const inst = document.querySelector('input[name=paym]:checked').value === 'inst';
  $('#instBox').classList.toggle('hidden', !inst);
  moveSum();
}
function openMove(id, mode) {
  if (!canW()) return toast('مفيش اتصال بالنت دلوقتي.', true);
  if (!curShift()) { gate(); return; }
  if (!who()) { askWho(); return; }
  moveId = id; moveMode = mode; const i = find(id), sell = mode === 'sell';
  $('#dMoveT').textContent = (sell ? 'بيع: ' : 'توريد: ') + i.name;
  $('#dMoveInfo').textContent = 'المتاح حالياً: ' + num(i.qty);
  $('#moveMsg').textContent = '';
  $('#mQty').value = 1; $('#mQty').max = sell ? i.qty : '';
  $('#mPriceL').textContent = sell ? 'سعر البيع للقطعة' : 'سعر الشراء للقطعة';
  $('#mPrice').value = sell ? i.sell : i.buy;
  const b = $('#moveOk'); b.textContent = sell ? 'تأكيد البيع' : 'تأكيد التوريد'; b.className = sell ? 'sell' : 'pri';
  $('#buyer').style.display = sell ? '' : 'none';
  ['bName', 'bPhone', 'bNid', 'bAddr'].forEach(k => $('#' + k).value = '');
  document.querySelector('input[name=paym][value=cash]').checked = true;
  $('#bDown').value = ''; $('#bMonths').value = 6;
  $('#bFirstDue').value = new Date(addMonths(Date.now(), 1)).toISOString().slice(0, 10);
  $('#bWarranty').value = sell && i.cat !== 'acc' ? 12 : 0;
  $('#bTaxAmt').value = taxOf(i) || 0;
  $('#taxBox').style.display = i.cat === 'acc' && sell ? 'none' : '';
  paymUI();
  $('#dMove').showModal();
}
async function moveOk() {
  const qty = Math.floor(+$('#mQty').value || 0), price = +$('#mPrice').value || 0;
  if (qty < 1 || busy) return; busy = true;
  const fail = t => { $('#moveMsg').textContent = t; busy = false; };
  try {
    const cur = find(moveId);
    if (!cur) return fail('الصنف ده اتحذف.');
    if (moveMode === 'sell') {
      if (qty > cur.qty) return fail('الكمية أكبر من المتاح (' + num(cur.qty) + ')');
      const paym = document.querySelector('input[name=paym]:checked').value;
      if (paym === 'inst' && qty !== 1) return fail('التقسيط لجهاز واحد بس في العملية.');
      const buyer = { name: $('#bName').value.trim(), phone: $('#bPhone').value.trim(), nid: $('#bNid').value.trim(), addr: $('#bAddr').value.trim() };
      if (paym === 'inst' && (!buyer.name || !buyer.phone)) return fail('للتقسيط لازم اسم العميل وتليفونه على الأقل.');
      const taxAmt = +$('#bTaxAmt').value || 0;
      const total = qty * price + qty * taxAmt;
      let planId = null;
      if (paym === 'inst') {
        const down = +$('#bDown').value || 0, months = Math.max(1, Math.floor(+$('#bMonths').value || 1));
        const fin = Math.max(0, total - down);
        if (fin <= 0) return fail('المقدم بيغطي كامل المبلغ — سجلها كاش.');
        const firstDue = new Date($('#bFirstDue').value + 'T12:00:00').getTime();
        if (!firstDue) return fail('اختار تاريخ أول قسط.');
        planId = DB.uid();
        await DB.putPlan(planId, { createdAt: Date.now(), inv: '', iid: moveId, itemName: cur.name, imei: cur.imei || cur.barcode || '', customer: buyer, total, down, months, monthly: Math.ceil(fin / months), firstDue, status: 'active', ...meta() });
      }
      await DB.putItem(moveId, { ...cur, qty: cur.qty - qty });
      const rec = { t: Date.now(), iid: moveId, name: cur.name, type: 'sell', qty, price, cost: cur.buy, inv: invNo(), ...meta(), list: cur.sell || 0, taxAmt, warrantyMonths: +$('#bWarranty').value || 0, paym, planId, spec: cur.spec || '', color: cur.color || '', battery: cur.battery || '', imei: cur.imei || '', barcode: cur.barcode || '', buyer };
      await DB.addLog(rec);
      if (planId) { const p = plans().find(x => x.id === planId); await DB.putPlan(planId, { ...p, inv: rec.inv }); }
      $('#dMove').close();
      showInv({ ...rec, planId });
    } else {
      await DB.putItem(moveId, { ...cur, qty: cur.qty + qty, buy: price || cur.buy });
      await addLog(moveId, cur.name, price || cur.buy, 'in', qty, price);
      $('#dMove').close();
    }
  } catch (e) { console.error(e); fail('العملية متسجلتش. جرّب تاني.'); }
  busy = false;
}

/* ============ شراء من عميل ============ */
function openBuy() {
  if (!canW()) return toast('مفيش اتصال بالنت دلوقتي.', true);
  if (!curShift()) { gate(); return; }
  if (!who()) { askWho(); return; }
  ['sName', 'sPhone', 'sNid', 'sAddr', 'sDev', 'sSpec', 'sColor', 'sBat', 'sImei', 'sBuy', 'sSell', 'sTaxAmt', 'sNote'].forEach(k => $('#' + k).value = '');
  $('#buyMsg').textContent = '';
  $('#dBuy').showModal();
}
async function buyOk() {
  const g = k => $('#' + k).value.trim();
  if (!g('sName') || !g('sDev') || !(+g('sBuy') > 0)) { $('#buyMsg').textContent = 'اكتب اسم البائع واسم الموبايل وسعر الشراء.'; return; }
  const imei = normAr(g('sImei'));
  if (imei && items().some(x => x.imei === imei && x.qty > 0)) { $('#buyMsg').textContent = 'السريال ده موجود في المخزن بالفعل.'; return; }
  if (busy) return; busy = true;
  try {
    const d = { name: g('sDev'), cat: 'used', qty: 1, buy: +g('sBuy'), sell: +g('sSell') || 0, min: 0, note: g('sNote'), spec: g('sSpec'), color: g('sColor'), battery: g('sBat'), imei, barcode: imei || newCode(), supplier: g('sName'), added: Date.now(), taxAmt: +g('sTaxAmt') || 0 };
    const id = DB.uid(); await DB.putItem(id, d);
    const rec = { t: Date.now(), iid: id, name: d.name, type: 'in', qty: 1, price: d.buy, cost: d.buy, inv: invNo().replace('INV', 'BUY'), spec: d.spec, color: d.color, battery: d.battery, imei: d.imei, barcode: d.barcode, devTax: d.taxAmt, ...meta(), seller: { name: g('sName'), phone: g('sPhone'), nid: g('sNid'), addr: g('sAddr') } };
    await DB.addLog(rec);
    $('#dBuy').close(); showInv(rec);
  } catch (e) { console.error(e); $('#buyMsg').textContent = 'العملية متسجلتش. جرّب تاني.'; }
  busy = false;
}

/* ============ الشيفتات ============ */
let shView = null;
const drawShift = () => { if (shView) $('#shBox').innerHTML = shiftHtml(shView, shiftData(shView), $('#shCount').value.trim()); };
function showShift(sh, closing) {
  if (!sh) return; shView = sh; const c = !!closing && sh.status === 'open';
  $('#shCloseIn').style.display = c ? '' : 'none';
  $('#shCloseOk').style.display = c ? '' : 'none';
  if (c) { $('#shCount').value = ''; $('#shCloseNote').value = ''; }
  drawShift(); $('#dShift').showModal();
}
async function shCloseOk() {
  const sh = curShift(); if (!sh || busy) return; busy = true;
  const now = Date.now(), cnt = $('#shCount').value.trim();
  const closed = { ...sh, status: 'closed', closedAt: now, closeCash: cnt === '' ? null : +cnt, closeNote: $('#shCloseNote').value.trim(), closedBy: who() };
  try {
    closed.entries = shiftData({ ...sh, closedAt: now }).L;
    await DB.putShift(sh.id, closed);
    showShift(closed, false);
  } catch (e) { console.error(e); toast('مقدرناش نقفل الشيفت. جرّب تاني.', true); }
  busy = false;
}

/* ============ الأقساط: تسجيل دفعة ============ */
let payPlanId = null;
function openPay(planId) {
  if (!canW()) return toast('مفيش اتصال بالنت دلوقتي.', true);
  if (!who()) { askWho(); return; }
  const p = plans().find(x => x.id === planId); if (!p) return;
  payPlanId = planId;
  $('#dPayT').textContent = 'تسجيل قسط: ' + ((p.customer && p.customer.name) || '');
  $('#dPayInfo').textContent = p.itemName + ' — الباقي: ' + num(planRemaining(p)) + ' ج.م';
  $('#pAmount').value = Math.min(p.monthly, planRemaining(p));
  $('#pNote').value = ''; $('#payMsg').textContent = '';
  $('#dPay').showModal();
}
async function payOk() {
  const amt = +$('#pAmount').value || 0;
  if (amt <= 0 || busy) return; busy = true;
  try {
    const p = plans().find(x => x.id === payPlanId);
    await DB.addPayment({ t: Date.now(), planId: payPlanId, amount: amt, note: $('#pNote').value.trim(), ...meta() });
    const rem = planRemaining(p);
    if (rem <= 0) await DB.putPlan(payPlanId, { ...p, status: 'done', doneAt: Date.now() });
    $('#dPay').close();
    toast('اتسجل القسط: ' + num(amt) + ' ج.م' + (rem <= 0 ? ' — الخطة خلصت ✓' : ' — الباقي ' + num(rem) + ' ج.م'));
  } catch (e) { console.error(e); $('#payMsg').textContent = 'الدفعة متسجلتش. جرّب تاني.'; }
  busy = false;
}
function showPlan(planId) {
  const p = plans().find(x => x.id === planId); if (!p) return;
  $('#planBox').innerHTML = planHtml(p);
  $('#dPlan').showModal();
}

/* ============ ملصق ============ */
async function openLabel(id) {
  const i = find(id); if (!i) return;
  let code = i.barcode;
  if (!code && canW()) { code = newCode(); try { await DB.putItem(id, { ...i, barcode: code }); } catch (e) {} }
  const rows = [['النوع', i.name], ['المساحة', i.spec], ['اللون', i.color], ['البطارية', i.battery ? i.battery + '%' : ''], ['الضريبة', taxOf(i) > 0 ? num(taxOf(i)) + ' ج.م' : 'بدون ضريبة'], ['السريال', i.imei || code]].filter(r => r[1]);
  $('#lblBox').innerHTML = `<div class="inv"><h2>${esc(shopName())}</h2><table>${rows.map(r => `<tr><th style="width:35%">${r[0]}</th><td>${esc(r[1])}</td></tr>`).join('')}</table></div>`;
  $('#dLbl').showModal();
}

/* ============ Excel + نسخ احتياطي ============ */
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function xlsGuard() { if (typeof XLSX === 'undefined') { toast('مكتبة Excel مش متحملة — اتأكد من النت وافتح الصفحة من جديد.', true); return false; } return true; }
function xlsItems() {
  if (!xlsGuard()) return;
  const rows = items().map(i => ({ 'الصنف': i.name, 'النوع': CATS[i.cat], 'الكمية': i.qty, 'سعر الشراء': i.buy, 'سعر البيع': i.sell, 'السريال': serialOf(i), 'الباركود': i.barcode || '', 'المواصفات': i.spec || '', 'اللون': i.color || '', 'البطارية': i.battery || '', 'ضريبة الجهاز': taxOf(i), 'حد التنبيه': i.min, 'المورد': i.supplier || '', 'ملاحظات': i.note || '' }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'المخزن');
  XLSX.writeFile(wb, 'inventory-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
function xlsLog() {
  if (!xlsGuard()) return;
  const [from, to, label] = periodRange();
  const rows = logL().filter(l => l.t >= from && l.t <= to).map(l => ({ 'التاريخ': new Date(l.t).toLocaleString('ar-EG'), 'الموظف': l.by || '', 'الصنف': l.name, 'الحركة': LT(l)[0], 'الكمية': l.qty, 'السعر': l.price || 0, 'التكلفة': l.cost || 0, 'الضريبة': (l.taxAmt || 0) * l.qty, 'السريال': l.imei || '', 'العميل': (l.buyer && l.buyer.name) || (l.seller && l.seller.name) || '', 'تليفون': (l.buyer && l.buyer.phone) || (l.seller && l.seller.phone) || '', 'فاتورة': l.inv || '' }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الحركات');
  XLSX.writeFile(wb, 'log-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
function xlsPlans() {
  if (!xlsGuard()) return;
  const rows = plans().map(p => ({ 'العميل': (p.customer && p.customer.name) || '', 'تليفون': (p.customer && p.customer.phone) || '', 'رقم قومي': (p.customer && p.customer.nid) || '', 'الجهاز': p.itemName, 'سريال': p.imei || '', 'الإجمالي': p.total, 'المقدم': p.down, 'القسط': p.monthly, 'الشهور': p.months, 'المدفوع من الأقساط': planPaid(p), 'الباقي': planRemaining(p), 'القسط الجاي': fdate(planNextDue(p)), 'الحالة': planStatus(p), 'فاتورة': p.inv || '' }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الأقساط');
  XLSX.writeFile(wb, 'installments-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
function backupAll() {
  const data = { exportedAt: new Date().toISOString(), shop: shop(), items: items(), log: logL(), shifts: shifts(), plans: plans(), payments: payments() };
  download('backup-' + new Date().toISOString().slice(0, 10) + '.json', new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
}

/* ============ الموظف ============ */
function askWho() {
  const names = (shop().staff || '').split(/[,،]/).map(x => x.trim()).filter(Boolean);
  $('#whoList').innerHTML = names.map(n => `<button data-n="${esc(n)}">${esc(n)}</button>`).join('') || '<span class="note">أضف أسماء الموظفين من «إعدادات المحل» أو اكتب الاسم تحت.</span>';
  $('#whoName').value = who();
  $('#dWho').showModal();
}

/* ============ المالك ============ */
function ownerSet(v) {
  try { localStorage.setItem('owner', v ? '1' : '0'); } catch (e) {}
  $('#dPin').close(); render();
}
function openPin(setupMode) {
  const setup = setupMode || !shop().ownerPin;
  $('#pinT').textContent = setup ? (shop().ownerPin ? 'تغيير الرقم السري للمالك' : 'اعمل رقم سري للمالك') : 'دخول المالك';
  $('#pin2Box').style.display = setup ? '' : 'none';
  $('#pin1').value = ''; $('#pin2').value = ''; $('#pinMsg').textContent = '';
  $('#dPin').dataset.setup = setup ? '1' : '';
  $('#dPin').showModal();
}
async function pinOk() {
  const a = $('#pin1').value.trim();
  if (a.length < 4) { $('#pinMsg').textContent = 'الرقم السري 4 أرقام على الأقل.'; return; }
  const setup = $('#dPin').dataset.setup === '1';
  try {
    if (setup) {
      if (a !== $('#pin2').value.trim()) { $('#pinMsg').textContent = 'الرقمين مش متطابقين.'; return; }
      const nv = { ...shop(), ownerPin: await sha(a) };
      await DB.saveShop(nv);
      ownerSet(true);
      toast('تم حفظ الرقم السري للمالك.');
      return;
    }
    let until = 0, fails = 0;
    try { until = +localStorage.getItem('pinUntil') || 0; fails = +localStorage.getItem('pinFail') || 0; } catch (e) {}
    if (Date.now() < until) { $('#pinMsg').textContent = 'محاولات كتير غلط. استنى ' + Math.ceil((until - Date.now()) / 60000) + ' دقيقة.'; return; }
    if (await sha(a) === shop().ownerPin) { try { localStorage.removeItem('pinFail'); } catch (e) {} ownerSet(true); return; }
    fails++;
    try { localStorage.setItem('pinFail', fails); if (fails >= 3) { localStorage.setItem('pinUntil', Date.now() + 300000); localStorage.setItem('pinFail', 0); } } catch (e) {}
    $('#pinMsg').textContent = fails >= 3 ? '3 محاولات غلط. اتقفل 5 دقايق.' : 'الرقم السري غلط.';
  } catch (e) { console.error(e); $('#pinMsg').textContent = 'حصلت مشكلة. اتأكد من الاتصال وجرّب تاني.'; }
}

/* ============ الإعدادات ============ */
function openSet() {
  if (shop().ownerPin && !ownerOn()) { openPin(false); return; }
  const s = shop();
  $('#tName').value = s.name || ''; $('#tInfo').value = s.info || ''; $('#tVat').value = s.vat; $('#tPre').value = s.prefix || 'SN'; $('#tStaff').value = s.staff || '';
  $('#tPinChange').classList.toggle('hidden', !s.ownerPin);
  $('#dSet').showModal();
}

/* ============ الأحداث ============ */
function bind() {
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; render(); } };
  $('#main').onclick = e => {
    const rep = e.target.closest('[data-rep]');
    if (rep) { repPeriod = rep.dataset.rep; render(); return; }
    const cat = e.target.closest('[data-cat]');
    if (cat) { renderItems.cat = cat.dataset.cat; render(); return; }
    if (e.target.id === 'add') return openItem(null);
    if (e.target.id === 'buyBtn') return openBuy();
    if (e.target.id === 'setBtn') return openSet();
    if (e.target.id === 'xlsInv') return xlsItems();
    if (e.target.id === 'xlsLog') return xlsLog();
    if (e.target.id === 'xlsPlans') return xlsPlans();
    if (e.target.id === 'backupBtn') return backupAll();
    if (e.target.id === 'scanBtn') return openScan(v => { q = v; const inp = $('#q'); if (inp) inp.value = v; render(); });
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'sh') showShift(shifts()[+b.dataset.i]);
    else if (a === 'inv') showInv(logL()[+b.dataset.i]);
    else if (a === 'code') openLabel(b.dataset.id);
    else if (a === 'edit') openItem(b.dataset.id);
    else if (a === 'view') { const i = find(b.dataset.id); if (i) { $('#detailBox').innerHTML = detailHtml(i); $('#dDetail').showModal(); } }
    else if (a === 'pay') openPay(b.dataset.id);
    else if (a === 'plan') showPlan(b.dataset.id);
    else openMove(b.dataset.id, a);
  };
  $('#main').oninput = e => { if (e.target.id === 'q') { q = e.target.value; } };
  $('#main').addEventListener('keydown', e => {
    if (e.target.id !== 'q' || e.key !== 'Enter') return;
    const t = normAr(q.trim());
    const m = items().filter(i => t && (i.barcode === t || i.imei === t));
    if (m.length === 1 && canW() && m[0].qty > 0) { q = ''; render(); openMove(m[0].id, 'sell'); }
  });

  $('#shiftBar').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'whoBtn') return askWho();
    if (b.id === 'shOpen') { if (!canW()) return toast('مفيش اتصال بالنت دلوقتي.', true); $('#shCash').value = 0; $('#shNote').value = ''; $('#shOpenMsg').textContent = ''; $('#dShOpen').showModal(); }
    else { const x = curShift(); if (x) showShift(x, true); }
  };

  $('#itemSave').onclick = saveItem;
  $('#itemCancel').onclick = () => $('#dItem').close();
  $('#itemDel').onclick = async () => {
    if (!delArmed) { delArmed = true; $('#itemDel').textContent = 'اضغط تاني للتأكيد'; return; }
    try { const it = find(editId) || {}; await addLog(editId, it.name || '', it.buy || 0, 'del', it.qty || 0, it.sell || 0); await DB.delItem(editId); $('#dItem').close(); } catch (e) { toast('مقدرناش نحذف الصنف.', true); }
  };
  $('#fQty').oninput = multiUI; $('#fCat').onchange = multiUI;
  $('#calcTax').onclick = () => { $('#fTaxAmt').value = Math.round((+$('#fSell').value || 0) * (+shop().vat || 0)) / 100; };
  $('#fImeiScan').onclick = () => openScan(v => { $('#fImei').value = v; });
  $('#sImeiScan').onclick = () => openScan(v => { $('#sImei').value = v; });

  $('#moveOk').onclick = moveOk;
  $('#moveCancel').onclick = () => $('#dMove').close();
  ['mQty', 'mPrice', 'bTaxAmt', 'bDown', 'bMonths'].forEach(k => $('#' + k).oninput = moveSum);
  document.querySelectorAll('input[name=paym]').forEach(r => r.onchange = paymUI);

  $('#buyBtn2');
  $('#buyOk').onclick = buyOk;
  $('#buyCancel').onclick = () => $('#dBuy').close();

  $('#invPrint').onclick = () => doPrint('#invBox'); $('#invClose').onclick = () => $('#dInv').close();
  $('#lblPrint').onclick = () => doPrint('#lblBox'); $('#lblClose').onclick = () => $('#dLbl').close();
  $('#planPrint').onclick = () => doPrint('#planBox', true); $('#planClose').onclick = () => $('#dPlan').close();
  $('#shPrint').onclick = () => doPrint('#shBox', true); $('#shShut').onclick = () => $('#dShift').close();
  $('#shCount').oninput = drawShift;
  $('#shCloseOk').onclick = shCloseOk;
  $('#shOpenCancel').onclick = () => $('#dShOpen').close();
  $('#shOpenOk').onclick = async () => {
    if (curShift() || busy || !canW()) return; busy = true;
    try { await DB.addShift({ status: 'open', openedAt: Date.now(), openedBy: who(), openCash: +$('#shCash').value || 0, openNote: $('#shNote').value.trim() }); $('#dShOpen').close(); }
    catch (e) { $('#shOpenMsg').textContent = 'مقدرناش نفتح الشيفت. اتأكد من النت.'; }
    busy = false;
  };

  $('#payOk').onclick = payOk;
  $('#payCancel').onclick = () => $('#dPay').close();
  $('#scanCancel').onclick = closeScan;
  $('#dScan').addEventListener('close', closeScan);
  $('#detailClose').onclick = () => $('#dDetail').close();

  $('#whoList').onclick = e => { const b = e.target.closest('button'); if (b) $('#whoName').value = b.dataset.n; };
  $('#whoCancel').onclick = () => $('#dWho').close();
  $('#whoOk').onclick = () => { const n = $('#whoName').value.trim(); if (!n) return; try { localStorage.setItem('staff', n); } catch (e) {} $('#dWho').close(); render(); };

  $('#ownerBtn').onclick = () => {
    if (ownerOn()) return ownerSet(false);
    if (!DB.ready) return;
    openPin(false);
  };
  $('#pinCancel').onclick = () => $('#dPin').close();
  $('#pinOk').onclick = pinOk;

  $('#setBtn');
  $('#setCancel').onclick = () => $('#dSet').close();
  $('#setOk').onclick = async () => {
    if (!canW()) return toast('مفيش اتصال بالنت دلوقتي.', true);
    const v = { ...shop(), name: $('#tName').value.trim() || 'سيستم المحل', info: $('#tInfo').value.trim(), vat: +$('#tVat').value || 0, prefix: ($('#tPre').value.trim() || 'SN').toUpperCase(), staff: $('#tStaff').value.trim() };
    try { await DB.saveShop(v); $('#dSet').close(); } catch (e) { toast('مقدرناش نحفظ الإعدادات.', true); }
  };
  $('#tPinChange').onclick = () => { $('#dSet').close(); openPin(true); };

  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
    $('#themeBtn').textContent = next === 'dark' ? '☀️' : '🌙';
  };

  window.addEventListener('online', () => { syncUI(); });
  window.addEventListener('offline', () => { syncUI(); });
}

/* ============ تنبيهات المالك اللحظية ============ */
function onDbChange(ev) {
  render();
  if (ev && ev.table === 'log' && ev.inserted && ownerOn() && ev.inserted.dev !== DEV) {
    const l = ev.inserted, T = LT(l);
    toast(T[0] + ': ' + l.name + (l.price && (l.type === 'sell' || l.type === 'in') ? ' — ' + num(l.qty * l.price) + ' ج.م' : '') + (l.by ? ' (' + l.by + ')' : ''));
  }
}

/* ============ التشغيل ============ */
async function boot() {
  try { const th = localStorage.getItem('theme'); if (th) { document.documentElement.dataset.theme = th; $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; } } catch (e) {}
  bind();
  DB.onChange(onDbChange);
  render();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').classList.remove('hidden'); });
  $('#installBtn').onclick = async () => { if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').classList.add('hidden'); } };

  const cfg = window.SHOP_CONFIG || {};
  if (!cfg.url || !cfg.key) {
    $('#bootMsg').textContent = 'السيستم محتاج إعداد الاتصال بقاعدة البيانات (config.js).';
    return;
  }
  try {
    await DB.init(cfg.url, cfg.key);
    $('#boot').classList.add('off');
    if (!who()) askWho();
  } catch (e) {
    console.error(e);
    if (DB.loadCache()) {
      cachedLocal = true;
      $('#boot').classList.add('off');
      say('مفيش اتصال بالسيرفر — واضحة آخر نسخة محفوظة على الجهاز (قراءة بس). لما النت يرجع افتح الصفحة من جديد.');
      if (!who()) askWho();
    } else {
      $('#bootMsg').textContent = 'مقدرناش نوصل لقاعدة البيانات. اتأكد من النت وافتح الصفحة من جديد.';
    }
  }
}
document.addEventListener('DOMContentLoaded', boot);
