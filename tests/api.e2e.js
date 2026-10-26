/*
 * End-to-end API workflow tests. Runs against a live server with freshly seeded data:
 *
 *   npm run seed
 *   AUTH_RATE_LIMIT_MULTIPLIER=100 npm start          (separate terminal)
 *   npm run test:e2e                                  (API_URL defaults to http://localhost:4000/api)
 *
 * Every scenario from the requirements is exercised through the HTTP API, including the
 * unhappy paths: rejected / cancelled orders, unavailable partners, failed deliveries,
 * payment failures, expired offers and disputed settlements.
 */
const assert = require('node:assert/strict');

const API = process.env.API_URL || 'http://localhost:4000/api';
const rnd = () => Math.floor(Math.random() * 1e6);
const phone = () => `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
const money = (n) => Math.round(n * 100) / 100;
// Real UPI transaction references are 12 digits.
const utr12 = () => `${Date.now()}${Math.floor(Math.random() * 10)}`.slice(-12);

let passed = 0;
const failures = [];

async function call(method, path, { token, body, lang } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (lang) headers['Accept-Language'] = lang;
  const res = await fetch(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json, headers: res.headers };
}

async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}

const expectStatus = (res, status, label = '') => {
  assert.equal(res.status, status, `${label} expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`);
  return res.body;
};

async function login(identifier, password) {
  const res = await call('POST', '/auth/login', { body: { identifier, password } });
  return expectStatus(res, 200, `login ${identifier}`);
}

(async () => {
  console.log(`API: ${API}\n`);
  const ctx = {};

  // ═══ 1. Authentication & access control ════════════════════════════════════
  console.log('1. Authentication & access control');

  await step('login requires a password', async () => {
    const r = await call('POST', '/auth/login', { body: { identifier: 'ramesh_patel' } });
    expectStatus(r, 400);
    assert.equal(r.body.code, 'AUTH_PASSWORD_REQUIRED');
  });

  await step('wrong password gives a clear error (English & Hindi)', async () => {
    const en = await call('POST', '/auth/login', { body: { identifier: 'gurpreet_singh', password: 'nope' } });
    expectStatus(en, 401);
    assert.equal(en.body.message, 'Incorrect username/mobile number or password.');
    const hi = await call('POST', '/auth/login', { body: { identifier: 'gurpreet_singh', password: 'nope' }, lang: 'hi' });
    expectStatus(hi, 401);
    assert.match(hi.body.message, /पासवर्ड गलत है/);
  });

  await step('unknown user gives the same generic error', async () => {
    const r = await call('POST', '/auth/login', { body: { identifier: 'no_such_user_x', password: 'whatever1' } });
    expectStatus(r, 401);
    assert.equal(r.body.code, 'AUTH_INVALID_CREDENTIALS');
  });

  await step('farmer logs in with mobile number and with username', async () => {
    const byPhone = await login('9999999999', '123456');
    const byUser = await login('Ramesh_Patel', '123456');
    assert.equal(byPhone.userType, 'farmer');
    assert.equal(byUser.data._id, byPhone.data._id);
    assert.equal(byPhone.data.password, undefined, 'password hash must never be returned');
    ctx.farmer = byPhone;
  });

  await step('all roles log in and get their permissions', async () => {
    ctx.superAdmin = await login('admin_username', 'Admin@123');
    ctx.opsAdmin = await login('ops_admin', 'Ops@1234');
    ctx.moderator = await login('mod_username', 'Mod@123');
    ctx.partnerA = await login('9888877777', '123456');
    ctx.partnerB = await login('9777766666', '123456');
    assert.equal(ctx.superAdmin.userType, 'admin');
    assert.ok(ctx.superAdmin.permissions.includes('REPORTS_VIEW'));
    assert.deepEqual(ctx.moderator.permissions.sort(), ['ORDERS_APPROVE', 'ORDERS_ASSIGN']);
    assert.equal(ctx.partnerA.userType, 'partner');
  });

  await step('farmer self-registration validates and requires a password', async () => {
    const p = phone();
    const u = `farmer_${rnd()}`;
    let r = await call('POST', '/auth/register', { body: { phoneNumber: p, username: u, name: 'Test Farmer' } });
    expectStatus(r, 400);
    assert.equal(r.body.code, 'PASSWORD_MIN_LENGTH');
    r = await call('POST', '/auth/register', { body: { phoneNumber: '12345', username: u, name: 'Test Farmer', password: 'secret1' } });
    assert.equal(r.body.code, 'PHONE_INVALID');
    r = await call('POST', '/auth/register', { body: { phoneNumber: p, username: 'ramesh_patel', name: 'Test', password: 'secret1' } });
    assert.equal(r.body.code, 'USERNAME_TAKEN');
    r = await call('POST', '/auth/register', { body: { phoneNumber: '9999999999', username: u, name: 'Test', password: 'secret1' } });
    assert.equal(r.body.code, 'PHONE_TAKEN');
    r = await call('POST', '/auth/register', { body: { phoneNumber: p, username: u, name: 'Lock Test Farmer', password: 'secret1', confirmPassword: 'secret1' } });
    const body = expectStatus(r, 201);
    assert.ok(body.token);
    ctx.lockFarmer = { phone: p, username: u, token: body.token };
  });

  await step('account locks after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await call('POST', '/auth/login', { body: { identifier: ctx.lockFarmer.username, password: 'wrong-pass' } });
    }
    const r = await call('POST', '/auth/login', { body: { identifier: ctx.lockFarmer.username, password: 'secret1' } });
    expectStatus(r, 429);
    assert.equal(r.body.code, 'AUTH_ACCOUNT_LOCKED');
  });

  await step('protected routes reject missing / invalid tokens', async () => {
    expectStatus(await call('GET', '/orders'), 401);
    expectStatus(await call('GET', '/orders', { token: 'garbage' }), 401);
    expectStatus(await call('GET', '/cart'), 401);
  });

  await step('roles cannot reach other roles\' APIs', async () => {
    const f = ctx.farmer.token;
    expectStatus(await call('GET', '/admins', { token: f }), 403);
    expectStatus(await call('GET', '/reports/summary', { token: f }), 403);
    expectStatus(await call('GET', '/farmers', { token: f }), 403);
    expectStatus(await call('POST', '/offers', { token: f, body: {} }), 403);
    expectStatus(await call('POST', '/orders', { token: ctx.partnerA.token, body: {} }), 403);
    expectStatus(await call('GET', '/cart', { token: ctx.partnerA.token }), 403);
    expectStatus(await call('GET', '/admins', { token: ctx.opsAdmin.token }), 403);
    expectStatus(await call('POST', '/admins', { token: ctx.opsAdmin.token, body: {} }), 403);
    expectStatus(await call('PUT', '/settings', { token: ctx.opsAdmin.token, body: {} }), 403);
    expectStatus(await call('POST', '/offers', { token: ctx.moderator.token, body: {} }), 403);
    expectStatus(await call('GET', '/reports/summary', { token: ctx.opsAdmin.token }), 403);
  });

  await step('forgot password → admin verifies by phone and resets', async () => {
    const r = await call('POST', '/auth/forgot-password', { body: { identifier: ctx.lockFarmer.phone } });
    const generic = expectStatus(r, 200).message;
    const unknown = expectStatus(await call('POST', '/auth/forgot-password', { body: { identifier: 'nobody_here' } }), 200).message;
    assert.equal(generic, unknown, 'must not reveal whether an account exists');
    const list = expectStatus(await call('GET', '/password-resets', { token: ctx.opsAdmin.token }), 200);
    const req = list.data.find((x) => x.phoneNumber === ctx.lockFarmer.phone);
    assert.ok(req, 'reset request visible to admin');
    expectStatus(await call('PATCH', `/password-resets/${req._id}/resolve`, { token: ctx.opsAdmin.token, body: { newPassword: 'newpass1', confirmPassword: 'newpass1' } }), 200);
    // Old session revoked, lock cleared, new password works.
    expectStatus(await call('GET', '/auth/me', { token: ctx.lockFarmer.token }), 401);
    const relog = await login(ctx.lockFarmer.phone, 'newpass1');
    ctx.lockFarmer.token = relog.token;
  });

  await step('password change requires current password and revokes other sessions', async () => {
    const t = ctx.lockFarmer.token;
    let r = await call('PUT', '/auth/update-password', { token: t, body: { oldPassword: 'bad', newPassword: 'another1', confirmPassword: 'another1' } });
    expectStatus(r, 401);
    r = await call('PUT', '/auth/update-password', { token: t, body: { oldPassword: 'newpass1', newPassword: 'another1', confirmPassword: 'another1' } });
    const body = expectStatus(r, 200);
    expectStatus(await call('GET', '/auth/me', { token: t }), 401);
    expectStatus(await call('GET', '/auth/me', { token: body.token }), 200);
  });

  // ═══ 2. Products, MRP pricing and offers ═══════════════════════════════════
  console.log('\n2. Products, pricing & offers');

  await step('products expose MRP, selling price, unit and offer pricing', async () => {
    const r = expectStatus(await call('GET', '/products?limit=200'), 200);
    ctx.products = r.data;
    const seed = r.data.find((p) => p.name.startsWith('Pusa Basmati'));
    assert.equal(seed.pricing.currency, 'INR');
    assert.equal(seed.mrp, 850);
    assert.equal(seed.price, 765);           // 10% below MRP
    assert.equal(seed.unit, 'kg');
    assert.ok(seed.nameHi.length > 0);
    assert.equal(seed.pricing.offer.discountType, 'PERCENT');
    assert.equal(seed.pricing.offerPrice, money(765 * 0.9));
    const pesticide = r.data.find((p) => p.name.startsWith('Bayer Confidor'));
    assert.equal(pesticide.pricing.offer, null, 'expired offer must not apply');
    const sprayer = r.data.find((p) => p.name.startsWith('ASPEE'));
    assert.equal(sprayer.pricing.offer, null, 'scheduled offer must not apply yet');
  });

  await step('farmer Offers section lists only currently active offers', async () => {
    const r = expectStatus(await call('GET', '/offers/active'), 200);
    const titles = r.data.map((o) => o.title);
    assert.ok(titles.some((t) => t.startsWith('Kharif Seed Sale')));
    assert.ok(!titles.some((t) => t.includes('expired')));
    assert.ok(!titles.some((t) => t.startsWith('Sprayer')));
    const offer = r.data[0];
    assert.ok(offer.products[0].offerPricing.offerPrice < offer.products[0].mrp);
  });

  await step('admin offer management: create, list by status, deactivate', async () => {
    const neem = ctx.products.find((p) => p.name.startsWith('Neemix'));
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const plus10 = new Date(Date.now() + 330 * 60000 + 10 * 864e5).toISOString().slice(0, 10);
    let r = await call('POST', '/offers', { token: ctx.opsAdmin.token, body: { title: 'Bad', discountType: 'PERCENT', discountValue: 95, products: [neem._id], startDate: today, endDate: plus10 } });
    assert.equal(r.body.code, 'OFFER_DISCOUNT_INVALID');
    r = await call('POST', '/offers', { token: ctx.opsAdmin.token, body: { title: 'Bad', discountType: 'FIXED', discountValue: neem.price, products: [neem._id], startDate: today, endDate: plus10 } });
    assert.equal(r.body.code, 'OFFER_DISCOUNT_INVALID', 'fixed discount cannot exceed price');
    r = await call('POST', '/offers', { token: ctx.opsAdmin.token, body: { title: 'Bad dates', discountType: 'PERCENT', discountValue: 5, products: [neem._id], startDate: plus10, endDate: today } });
    assert.equal(r.body.code, 'OFFER_DATES_INVALID');
    r = await call('POST', '/offers', {
      token: ctx.opsAdmin.token,
      body: { title: 'Neem Week', titleHi: 'नीम सप्ताह', discountType: 'FIXED', discountValue: 30, products: [neem._id], startDate: today, endDate: plus10, minQuantity: 2 },
    });
    const offer = expectStatus(r, 201).data;
    assert.equal(offer.status, 'ACTIVE');
    assert.equal(offer.createdByName, 'Operations Admin');
    ctx.neemOffer = offer;
    ctx.neem = neem;
    const active = expectStatus(await call('GET', '/offers?status=ACTIVE', { token: ctx.opsAdmin.token }), 200).data;
    assert.ok(active.some((o) => o._id === offer._id));
    const expired = expectStatus(await call('GET', '/offers?status=EXPIRED', { token: ctx.opsAdmin.token }), 200).data;
    assert.ok(expired.every((o) => o.status === 'EXPIRED') && expired.length >= 1);
    const scheduled = expectStatus(await call('GET', '/offers?status=SCHEDULED', { token: ctx.opsAdmin.token }), 200).data;
    assert.ok(scheduled.length >= 1);
  });

  await step('cart quote: offers, minimum purchase, delivery charge, no double discount', async () => {
    const basmati = ctx.products.find((p) => p.name.startsWith('Pusa Basmati'));
    const npk = ctx.products.find((p) => p.name.startsWith('IFFCO NPK'));
    ctx.basmati = basmati;
    ctx.npk = npk;
    // NPK alone: subtotal below ₹500 → fixed offer not eligible
    let q = expectStatus(await call('POST', '/orders/quote', { token: ctx.farmer.token, body: { items: [{ productId: npk._id, quantity: 2 }] } }), 200).data;
    assert.equal(q.discount, 0, 'min purchase not met');
    assert.equal(q.deliveryCharge, 50);
    assert.equal(q.totalAmount, money(npk.price * 2 + 50));
    // Neem: minQuantity 2
    q = expectStatus(await call('POST', '/orders/quote', { token: ctx.farmer.token, body: { items: [{ productId: ctx.neem._id, quantity: 1 }] } }), 200).data;
    assert.equal(q.discount, 0, 'min quantity not met');
    // Duplicate lines are merged; each product discounted once per unit.
    q = expectStatus(await call('POST', '/orders/quote', {
      token: ctx.farmer.token,
      body: { items: [{ productId: basmati._id, quantity: 1 }, { productId: basmati._id, quantity: 1 }, { productId: npk._id, quantity: 1 }] },
    }), 200).data;
    assert.equal(q.items.length, 2);
    const bLine = q.items.find((l) => l.productId === basmati._id);
    const nLine = q.items.find((l) => l.productId === npk._id);
    assert.equal(bLine.quantity, 2);
    assert.equal(bLine.lineDiscount, money(basmati.price * 0.1 * 2));
    assert.equal(nLine.lineDiscount, 25, 'subtotal ≥ 500 unlocks fixed offer');
    assert.equal(q.subtotal, money(basmati.price * 2 + npk.price));
    assert.equal(q.discount, money(bLine.lineDiscount + 25));
    assert.equal(q.totalAmount, money(q.subtotal - q.discount + 50));
    ctx.quote = q;
  });

  await step('server cart is per-farmer and returns a priced quote', async () => {
    const t = ctx.farmer.token;
    expectStatus(await call('DELETE', '/cart', { token: t }), 200);
    expectStatus(await call('POST', '/cart', { token: t, body: { productId: ctx.basmati._id, quantity: 2 } }), 201);
    const c = expectStatus(await call('PUT', `/cart/${ctx.npk._id}`, { token: t, body: { quantity: 1 } }), 200);
    assert.equal(c.count, 2);
    assert.equal(c.quote.totalAmount, ctx.quote.totalAmount);
    const tooMany = await call('PUT', `/cart/${ctx.npk._id}`, { token: t, body: { quantity: 999999 } });
    assert.equal(tooMany.body.code, 'PRODUCT_OUT_OF_STOCK');
  });

  // ═══ 3. Order placement & admin approval ═══════════════════════════════════
  console.log('\n3. Order placement & admin approval');

  const items = () => [{ productId: ctx.basmati._id, quantity: 2 }, { productId: ctx.npk._id, quantity: 1 }];

  await step('client cannot dictate prices: total mismatch is refused with a fresh quote', async () => {
    const r = await call('POST', '/orders', { token: ctx.farmer.token, body: { items: items(), deliveryAddress: 'Farm 42, Navli', paymentMethod: 'COD', expectedTotal: 1 } });
    expectStatus(r, 409);
    assert.equal(r.body.code, 'PRICE_CHANGED');
    assert.equal(r.body.data.totalAmount, ctx.quote.totalAmount);
  });

  await step('COD order is created as Pending Admin Approval; duplicate submit is idempotent', async () => {
    const before = expectStatus(await call('GET', `/products/${ctx.basmati._id}`), 200).data.quantityAvailable;
    const key = `k-${rnd()}`;
    const body = { items: items(), deliveryAddress: 'Farm 42, Navli', paymentMethod: 'COD', expectedTotal: ctx.quote.totalAmount, idempotencyKey: key };
    const r1 = await call('POST', '/orders', { token: ctx.farmer.token, body });
    const o = expectStatus(r1, 201).data;
    assert.match(o.orderNumber, /^ORD-\d{6}-\d{4}$/);
    assert.equal(o.status, 'PENDING_APPROVAL');
    assert.equal(o.totalAmount, ctx.quote.totalAmount);
    assert.equal(o.discount, ctx.quote.discount);
    assert.equal(o.paymentStatus, 'PENDING');
    assert.equal(o.expectedCollection, o.totalAmount);
    const r2 = await call('POST', '/orders', { token: ctx.farmer.token, body });
    const dup = expectStatus(r2, 200);
    assert.equal(dup.duplicate, true);
    assert.equal(dup.data._id, o._id);
    const after = expectStatus(await call('GET', `/products/${ctx.basmati._id}`), 200).data.quantityAvailable;
    assert.equal(after, before - 2, 'stock reserved exactly once');
    const cart = expectStatus(await call('GET', '/cart', { token: ctx.farmer.token }), 200);
    assert.equal(cart.count, 0, 'ordered products removed from cart');
    ctx.order1 = o;
  });

  await step('pending orders are not visible or actionable for delivery partners', async () => {
    const pool = expectStatus(await call('GET', '/orders?scope=pool', { token: ctx.partnerA.token }), 200).data;
    assert.ok(!pool.some((x) => x._id === ctx.order1._id));
    const r = await call('PATCH', `/orders/${ctx.order1._id}/accept`, { token: ctx.partnerA.token });
    expectStatus(r, 409);
    expectStatus(await call('GET', `/orders/${ctx.order1._id}`, { token: ctx.partnerA.token }), 404);
  });

  await step('admin sees full order details incl. farmer mobile and payment info', async () => {
    const o = expectStatus(await call('GET', `/orders/${ctx.order1._id}`, { token: ctx.moderator.token }), 200).data;
    assert.equal(o.farmerPhone, '9999999999');
    assert.equal(o.items.length, 2);
    assert.ok(o.mrpTotal >= o.subtotal);
    const list = expectStatus(await call('GET', '/orders?status=PENDING_APPROVAL&sort=oldest', { token: ctx.moderator.token }), 200);
    assert.ok(list.data.some((x) => x._id === ctx.order1._id));
  });

  await step('approval requires a confirmed phone verification', async () => {
    const id = ctx.order1._id;
    let r = await call('PATCH', `/orders/${id}/approve`, { token: ctx.moderator.token });
    assert.equal(r.body.code, 'ORDER_VERIFICATION_REQUIRED');
    r = await call('PATCH', `/orders/${id}/verification`, { token: ctx.moderator.token, body: { outcome: 'NOT_REACHABLE', note: 'No answer' } });
    expectStatus(r, 200);
    r = await call('PATCH', `/orders/${id}/approve`, { token: ctx.moderator.token });
    assert.equal(r.body.code, 'ORDER_VERIFICATION_REQUIRED');
    r = await call('PATCH', `/orders/${id}/verification`, { token: ctx.moderator.token, body: { outcome: 'CONFIRMED', note: 'Farmer confirmed' } });
    assert.equal(expectStatus(r, 200).data.verificationCalls.length, 2);
    expectStatus(await call('PATCH', `/orders/${id}/approve`, { token: ctx.partnerA.token }), 403);
    expectStatus(await call('PATCH', `/orders/${id}/approve`, { token: ctx.farmer.token }), 403);
    const o = expectStatus(await call('PATCH', `/orders/${id}/approve`, { token: ctx.moderator.token }), 200).data;
    assert.equal(o.status, 'APPROVED');
    assert.equal(o.decisionByName, 'Agricultural Moderator');
    assert.ok(o.approvedAt);
    // Cannot approve twice
    expectStatus(await call('PATCH', `/orders/${id}/approve`, { token: ctx.moderator.token }), 409);
  });

  await step('farmer sees status history without internal admin identities', async () => {
    const o = expectStatus(await call('GET', `/orders/${ctx.order1._id}`, { token: ctx.farmer.token }), 200).data;
    assert.equal(o.status, 'APPROVED');
    assert.equal(o.verificationCalls, undefined);
    assert.ok(o.statusHistory.every((h) => h.byId === undefined));
  });

  await step('farmer cannot see another farmer\'s order', async () => {
    const other = await login('gurpreet_singh', '123456');
    expectStatus(await call('GET', `/orders/${ctx.order1._id}`, { token: other.token }), 404);
    ctx.farmer2 = other;
  });

  // ═══ 4. Delivery: open pool, unavailability, delivery & COD collection ═════
  console.log('\n4. Delivery workflow');

  await step('approved order appears in the pool; first partner to accept gets it', async () => {
    const pool = expectStatus(await call('GET', '/orders?scope=pool', { token: ctx.partnerA.token }), 200).data;
    assert.ok(pool.some((x) => x._id === ctx.order1._id));
    const a = expectStatus(await call('PATCH', `/orders/${ctx.order1._id}/accept`, { token: ctx.partnerA.token }), 200).data;
    assert.equal(a.status, 'ASSIGNED');
    assert.equal(a.assignedPartnerName, 'Harpreet Singh');
    const b = await call('PATCH', `/orders/${ctx.order1._id}/accept`, { token: ctx.partnerB.token });
    expectStatus(b, 409);
    assert.equal(b.body.code, 'ORDER_ALREADY_TAKEN');
  });

  await step('partner reports unavailability → back to the pool for others', async () => {
    let r = await call('PATCH', `/orders/${ctx.order1._id}/unavailable`, { token: ctx.partnerB.token, body: { reason: 'not mine' } });
    expectStatus(r, 403);
    r = await call('PATCH', `/orders/${ctx.order1._id}/unavailable`, { token: ctx.partnerA.token, body: {} });
    assert.equal(r.body.code, 'ORDER_REASON_REQUIRED');
    const o = expectStatus(await call('PATCH', `/orders/${ctx.order1._id}/unavailable`, { token: ctx.partnerA.token, body: { reason: 'Vehicle breakdown' } }), 200).data;
    assert.equal(o.status, 'APPROVED');
    assert.equal(o.assignedPartnerId, null);
    expectStatus(await call('PATCH', `/orders/${ctx.order1._id}/accept`, { token: ctx.partnerB.token }), 200);
  });

  await step('partner picks up and delivers; COD cash recorded and payment completed', async () => {
    const id = ctx.order1._id;
    let r = await call('PATCH', `/orders/${id}/deliver`, { token: ctx.partnerB.token, body: { amountCollected: 10 } });
    expectStatus(r, 409); // must pick up first
    const picked = expectStatus(await call('PATCH', `/orders/${id}/pickup`, { token: ctx.partnerB.token }), 200).data;
    assert.equal(picked.status, 'OUT_FOR_DELIVERY');
    r = await call('PATCH', `/orders/${id}/deliver`, { token: ctx.partnerB.token, body: {} });
    assert.equal(r.body.code, 'COLLECTION_AMOUNT_INVALID');
    const d = expectStatus(await call('PATCH', `/orders/${id}/deliver`, {
      token: ctx.partnerB.token,
      body: { amountCollected: ctx.order1.totalAmount, deliveryNote: 'Handed to farmer', deliveryProofUrl: 'file:///proof.jpg' },
    }), 200).data;
    assert.equal(d.status, 'DELIVERED');
    assert.equal(d.paymentStatus, 'PAID');
    assert.equal(d.collectionStatus, 'COLLECTED');
    assert.equal(d.settlementStatus, 'PENDING');
    assert.equal(d.amountCollected, ctx.order1.totalAmount);
    assert.equal(d.deliveryProofUrl, '', 'phone-local file paths are rejected');
    const farmerView = expectStatus(await call('PATCH', `/orders/${id}/cancel`, { token: ctx.farmer.token, body: { reason: 'Too late now' } }), 409);
    assert.equal(farmerView.code, 'ORDER_TRANSITION_INVALID');
  });

  const placeCod = async (token = ctx.farmer.token, its = [{ productId: ctx.npk._id, quantity: 1 }]) => {
    const r = await call('POST', '/orders', { token, body: { items: its, deliveryAddress: 'Plot 7, Khanna', paymentMethod: 'COD' } });
    return expectStatus(r, 201).data;
  };
  const approve = async (id) => {
    expectStatus(await call('PATCH', `/orders/${id}/verification`, { token: ctx.opsAdmin.token, body: { outcome: 'CONFIRMED' } }), 200);
    return expectStatus(await call('PATCH', `/orders/${id}/approve`, { token: ctx.opsAdmin.token }), 200).data;
  };

  await step('rejected order: reason required, stock restored, nothing to pay', async () => {
    const stockBefore = expectStatus(await call('GET', `/products/${ctx.npk._id}`), 200).data.quantityAvailable;
    const o = await placeCod();
    expectStatus(await call('PATCH', `/orders/${o._id}/verification`, { token: ctx.opsAdmin.token, body: { outcome: 'DENIED', note: 'Farmer says not placed' } }), 200);
    let r = await call('PATCH', `/orders/${o._id}/reject`, { token: ctx.opsAdmin.token, body: { reason: '' } });
    assert.equal(r.body.code, 'ORDER_REASON_REQUIRED');
    r = await call('PATCH', `/orders/${o._id}/reject`, { token: ctx.opsAdmin.token, body: { reason: 'Farmer denied placing the order' } });
    const rej = expectStatus(r, 200).data;
    assert.equal(rej.status, 'REJECTED');
    assert.equal(rej.paymentStatus, 'CANCELLED');
    assert.equal(rej.decisionByName, 'Operations Admin');
    const stockAfter = expectStatus(await call('GET', `/products/${ctx.npk._id}`), 200).data.quantityAvailable;
    assert.equal(stockAfter, stockBefore);
    const fv = expectStatus(await call('GET', `/orders/${o._id}`, { token: ctx.farmer.token }), 200).data;
    assert.equal(fv.rejectionReason, 'Farmer denied placing the order');
    expectStatus(await call('PATCH', `/orders/${o._id}/accept`, { token: ctx.partnerA.token }), 409);
    expectStatus(await call('PATCH', `/orders/${o._id}/assign`, { token: ctx.opsAdmin.token, body: { partnerId: ctx.partnerA.data._id } }), 409);
  });

  await step('farmer cancels own pending order with a reason; cancelled orders cannot be assigned', async () => {
    const o = await placeCod();
    const c = expectStatus(await call('PATCH', `/orders/${o._id}/cancel`, { token: ctx.farmer.token, body: { reason: 'Ordered by mistake' } }), 200).data;
    assert.equal(c.status, 'CANCELLED');
    assert.equal(c.cancelReason, 'Ordered by mistake');
    expectStatus(await call('PATCH', `/orders/${o._id}/assign`, { token: ctx.opsAdmin.token, body: { partnerId: ctx.partnerA.data._id } }), 409);
    expectStatus(await call('PATCH', `/orders/${o._id}/cancel`, { token: ctx.farmer2.token, body: { reason: 'not mine at all' } }), 404);
  });

  await step('failed delivery → admin reassigns → short cash collection is flagged', async () => {
    const o = await placeCod();
    await approve(o._id);
    expectStatus(await call('PATCH', `/orders/${o._id}/accept`, { token: ctx.partnerB.token }), 200);
    expectStatus(await call('PATCH', `/orders/${o._id}/pickup`, { token: ctx.partnerB.token }), 200);
    const f = expectStatus(await call('PATCH', `/orders/${o._id}/fail`, { token: ctx.partnerB.token, body: { reason: 'Farmer not at home' } }), 200).data;
    assert.equal(f.status, 'DELIVERY_FAILED');
    assert.equal(f.failureReason, 'Farmer not at home');
    const re = expectStatus(await call('PATCH', `/orders/${o._id}/assign`, { token: ctx.moderator.token, body: { partnerId: ctx.partnerA.data._id } }), 200).data;
    assert.equal(re.status, 'ASSIGNED');
    assert.equal(re.assignedPartnerName, 'Harpreet Singh');
    expectStatus(await call('PATCH', `/orders/${o._id}/pickup`, { token: ctx.partnerB.token }), 403);
    expectStatus(await call('PATCH', `/orders/${o._id}/pickup`, { token: ctx.partnerA.token }), 200);
    const d = expectStatus(await call('PATCH', `/orders/${o._id}/deliver`, { token: ctx.partnerA.token, body: { amountCollected: o.totalAmount - 20 } }), 200).data;
    assert.equal(d.collectionStatus, 'DISPUTED');
    assert.equal(d.paymentStatus, 'PENDING');
    assert.equal(d.amountCollected, money(o.totalAmount - 20));
    ctx.shortOrder = d;
  });

  await step('partner going offline releases accepted orders; cannot go offline mid-delivery', async () => {
    const o = await placeCod();
    await approve(o._id);
    expectStatus(await call('PATCH', `/orders/${o._id}/accept`, { token: ctx.partnerA.token }), 200);
    expectStatus(await call('PUT', '/auth/me', { token: ctx.partnerA.token, body: { online: false } }), 200);
    let cur = expectStatus(await call('GET', `/orders/${o._id}`, { token: ctx.opsAdmin.token }), 200).data;
    assert.equal(cur.status, 'APPROVED');
    const offlineAccept = await call('PATCH', `/orders/${o._id}/accept`, { token: ctx.partnerA.token });
    assert.equal(offlineAccept.body.code, 'PARTNER_OFFLINE');
    expectStatus(await call('PUT', '/auth/me', { token: ctx.partnerA.token, body: { online: true } }), 200);
    expectStatus(await call('PATCH', `/orders/${o._id}/accept`, { token: ctx.partnerA.token }), 200);
    expectStatus(await call('PATCH', `/orders/${o._id}/pickup`, { token: ctx.partnerA.token }), 200);
    const off = await call('PUT', '/auth/me', { token: ctx.partnerA.token, body: { online: false } });
    assert.equal(off.body.code, 'PARTNER_OFFLINE_ACTIVE_DELIVERY');
    expectStatus(await call('PATCH', `/orders/${o._id}/deliver`, { token: ctx.partnerA.token, body: { amountCollected: o.totalAmount } }), 200);
    cur = expectStatus(await call('GET', `/orders/${o._id}`, { token: ctx.farmer.token }), 200).data;
    assert.equal(cur.status, 'DELIVERED');
  });

  await step('proof-of-delivery photo is stored inline and kept out of order lists', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const o = await placeCod();
    await approve(o._id);
    expectStatus(await call('PATCH', `/orders/${o._id}/accept`, { token: ctx.partnerA.token }), 200);
    expectStatus(await call('PATCH', `/orders/${o._id}/pickup`, { token: ctx.partnerA.token }), 200);
    expectStatus(await call('PATCH', `/orders/${o._id}/deliver`, { token: ctx.partnerA.token, body: { amountCollected: o.totalAmount, deliveryProofUrl: png } }), 200);
    const detail = expectStatus(await call('GET', `/orders/${o._id}`, { token: ctx.opsAdmin.token }), 200).data;
    assert.equal(detail.deliveryProofUrl, png);
    const list = expectStatus(await call('GET', `/orders?search=${o.orderNumber}`, { token: ctx.opsAdmin.token }), 200).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].deliveryProofUrl, undefined);
  });

  // ═══ 5. Online payments (admin verified) & refunds ═════════════════════════
  console.log('\n5. Online payments');

  await step('online order needs a transaction reference and awaits admin verification', async () => {
    let res = await call('POST', '/orders', { token: ctx.farmer.token, body: { items: [{ productId: ctx.npk._id, quantity: 1 }], deliveryAddress: 'Farm', paymentMethod: 'ONLINE' } });
    assert.equal(res.body.code, 'PAYMENT_REFERENCE_REQUIRED');
    res = await call('POST', '/orders', { token: ctx.farmer.token, body: { items: [{ productId: ctx.npk._id, quantity: 1 }], deliveryAddress: 'Farm', paymentMethod: 'ONLINE', paymentReference: '12' } });
    assert.equal(res.body.code, 'PAYMENT_REFERENCE_INVALID');
    res = await call('POST', '/orders', { token: ctx.farmer.token, body: { items: [{ productId: ctx.npk._id, quantity: 1 }], deliveryAddress: 'Farm', paymentMethod: 'ONLINE', paymentReference: 'TXN12345ABCDE' } });
    assert.equal(res.body.code, 'PAYMENT_REFERENCE_INVALID', 'only 12-digit UTRs are accepted');
    ctx.utr = utr12();
    const o = expectStatus(await call('POST', '/orders', { token: ctx.farmer.token, body: { items: [{ productId: ctx.npk._id, quantity: 1 }], deliveryAddress: 'Farm', paymentMethod: 'ONLINE', paymentReference: ctx.utr } }), 201).data;
    assert.equal(o.paymentStatus, 'AWAITING_VERIFICATION');
    assert.equal(o.expectedCollection, 0);
    res = await call('POST', '/orders', { token: ctx.farmer2.token, body: { items: [{ productId: ctx.npk._id, quantity: 1 }], deliveryAddress: 'Farm', paymentMethod: 'ONLINE', paymentReference: ctx.utr } });
    assert.equal(res.body.code, 'PAYMENT_REFERENCE_USED');
    ctx.online = o;
  });

  await step('payment failure → farmer resubmits → admin verifies → paid', async () => {
    const id = ctx.online._id;
    expectStatus(await call('PATCH', `/orders/${id}/payment/verify`, { token: ctx.moderator.token, body: { approved: true } }), 403);
    let o = expectStatus(await call('PATCH', `/orders/${id}/payment/verify`, { token: ctx.opsAdmin.token, body: { approved: false, reason: 'UTR not found in bank statement' } }), 200).data;
    assert.equal(o.paymentStatus, 'FAILED');
    const newUtr = utr12();
    o = expectStatus(await call('PATCH', `/orders/${id}/payment-reference`, { token: ctx.farmer.token, body: { paymentReference: newUtr } }), 200).data;
    assert.equal(o.paymentStatus, 'AWAITING_VERIFICATION');
    o = expectStatus(await call('PATCH', `/orders/${id}/payment/verify`, { token: ctx.opsAdmin.token, body: { approved: true } }), 200).data;
    assert.equal(o.paymentStatus, 'PAID');
    assert.equal(o.paymentVerifiedByName, 'Operations Admin');
  });

  await step('delivery partner can never mark an online payment as paid', async () => {
    const id = ctx.online._id;
    await approve(id);
    expectStatus(await call('PATCH', `/orders/${id}/accept`, { token: ctx.partnerA.token }), 200);
    expectStatus(await call('PATCH', `/orders/${id}/pickup`, { token: ctx.partnerA.token }), 200);
    const res = await call('PATCH', `/orders/${id}/deliver`, { token: ctx.partnerA.token, body: { markAsPaid: true } });
    expectStatus(res, 403);
    assert.equal(res.body.code, 'COLLECTION_ONLINE_FORBIDDEN');
    const d = expectStatus(await call('PATCH', `/orders/${id}/deliver`, { token: ctx.partnerA.token, body: {} }), 200).data;
    assert.equal(d.status, 'DELIVERED');
    assert.equal(d.collectionStatus, 'NOT_APPLICABLE');
  });

  await step('paid online order cancelled by admin → refund pending → refunded', async () => {
    const utr = utr12();
    const o = expectStatus(await call('POST', '/orders', { token: ctx.farmer.token, body: { items: [{ productId: ctx.npk._id, quantity: 1 }], deliveryAddress: 'Farm', paymentMethod: 'ONLINE', paymentReference: utr } }), 201).data;
    expectStatus(await call('PATCH', `/orders/${o._id}/payment/verify`, { token: ctx.opsAdmin.token, body: { approved: true } }), 200);
    let c = expectStatus(await call('PATCH', `/orders/${o._id}/cancel`, { token: ctx.opsAdmin.token, body: { reason: 'Product damaged in warehouse' } }), 200).data;
    assert.equal(c.status, 'CANCELLED');
    assert.equal(c.paymentStatus, 'REFUND_PENDING');
    assert.equal(c.refundAmount, o.totalAmount);
    c = expectStatus(await call('PATCH', `/orders/${o._id}/payment/refund`, { token: ctx.opsAdmin.token, body: { refundReference: 'RFND778899', reason: 'Order cancelled' } }), 200).data;
    assert.equal(c.paymentStatus, 'REFUNDED');
    expectStatus(await call('PATCH', `/orders/${o._id}/payment/refund`, { token: ctx.opsAdmin.token, body: {} }), 409);
  });

  // ═══ 6. Cash collection & settlement ═══════════════════════════════════════
  console.log('\n6. Collections & settlement');

  await step('partner sees outstanding cash and submits a handover with a difference', async () => {
    const mine = expectStatus(await call('GET', '/settlements/mine', { token: ctx.partnerA.token }), 200).data;
    assert.ok(mine.outstanding.orders.length >= 2);
    assert.ok(mine.outstanding.total > 0);
    let res = await call('POST', '/settlements', { token: ctx.partnerA.token, body: {} });
    assert.equal(res.body.code, 'SETTLEMENT_AMOUNT_INVALID');
    const s = expectStatus(await call('POST', '/settlements', { token: ctx.partnerA.token, body: { submittedAmount: mine.outstanding.total - 5, handoverReference: 'RCPT-1', handedOverTo: 'Hub cashier' } }), 201).data;
    assert.equal(s.status, 'SUBMITTED');
    assert.equal(s.expectedAmount, mine.outstanding.total);
    assert.equal(s.difference, -5);
    const again = await call('POST', '/settlements', { token: ctx.partnerA.token, body: { submittedAmount: 1 } });
    assert.equal(again.body.code, 'SETTLEMENT_NOTHING_OUTSTANDING');
    ctx.settlement = s;
  });

  await step('admin disputes then verifies settlement; orders follow the settlement status', async () => {
    const id = ctx.settlement._id;
    expectStatus(await call('PATCH', `/settlements/${id}/verify`, { token: ctx.moderator.token }), 403);
    let s = expectStatus(await call('PATCH', `/settlements/${id}/dispute`, { token: ctx.opsAdmin.token, body: { reason: '₹5 short in cash count' } }), 200).data;
    assert.equal(s.status, 'DISPUTED');
    let ord = expectStatus(await call('GET', `/orders/${ctx.shortOrder._id}`, { token: ctx.opsAdmin.token }), 200).data;
    assert.equal(ord.settlementStatus, 'DISPUTED');
    s = expectStatus(await call('PATCH', `/settlements/${id}/verify`, { token: ctx.opsAdmin.token, body: { note: 'Partner paid ₹5 later' } }), 200).data;
    assert.equal(s.status, 'VERIFIED');
    assert.equal(s.resolutionNote, 'Partner paid ₹5 later');
    ord = expectStatus(await call('GET', `/orders/${ctx.shortOrder._id}`, { token: ctx.opsAdmin.token }), 200).data;
    assert.equal(ord.settlementStatus, 'VERIFIED');
    const outstanding = expectStatus(await call('GET', '/settlements/outstanding', { token: ctx.opsAdmin.token }), 200).data;
    assert.ok(outstanding.some((row) => row.partnerName === 'Rajesh Patil' && row.pendingHandover > 0));
  });

  await step('admin records a handover on behalf of a partner', async () => {
    const s = expectStatus(await call('POST', '/settlements/record', { token: ctx.opsAdmin.token, body: { partnerId: ctx.partnerB.data._id, submittedAmount: ctx.order1.totalAmount, handoverReference: 'CASH-DESK-9' } }), 201).data;
    assert.equal(s.submittedByRole, 'ADMIN');
    assert.equal(s.difference, 0);
  });

  // ═══ 7. Super Admin: admin account management ══════════════════════════════
  console.log('\n7. Super Admin – admin accounts');

  await step('create admin with custom permissions; permissions are enforced', async () => {
    const username = `approver_${rnd()}`;
    let res = await call('POST', '/admins', { token: ctx.superAdmin.token, body: { username, name: 'Approver Only', password: 'Approve@1', role: 'SUPER_ADMIN' } });
    assert.equal(res.body.code, 'ADMIN_ROLE_INVALID');
    res = await call('POST', '/admins', { token: ctx.superAdmin.token, body: { username, name: 'Approver Only', password: 'Approve@1', role: 'ADMIN', permissions: ['ORDERS_APPROVE', 'BOGUS'] } });
    assert.equal(res.body.code, 'PERMISSION_INVALID');
    const a = expectStatus(await call('POST', '/admins', { token: ctx.superAdmin.token, body: { username, name: 'Approver Only', password: 'Approve@1', role: 'ADMIN', permissions: ['ORDERS_APPROVE'] } }), 201).data;
    assert.deepEqual(a.effectivePermissions, ['ORDERS_APPROVE']);
    const s = await login(username, 'Approve@1');
    expectStatus(await call('POST', '/offers', { token: s.token, body: {} }), 403);
    expectStatus(await call('GET', '/settlements', { token: s.token }), 403);
    const o = await placeCod();
    expectStatus(await call('PATCH', `/orders/${o._id}/verification`, { token: s.token, body: { outcome: 'CONFIRMED' } }), 200);
    expectStatus(await call('PATCH', `/orders/${o._id}/approve`, { token: s.token }), 200);
    ctx.approver = { ...a, token: s.token, username };
  });

  await step('edit permissions takes effect immediately', async () => {
    const a = expectStatus(await call('PUT', `/admins/${ctx.approver._id}`, { token: ctx.superAdmin.token, body: { permissions: ['ORDERS_APPROVE', 'OFFERS_MANAGE'], name: 'Approver & Offers' } }), 200).data;
    assert.equal(a.name, 'Approver & Offers');
    const list = await call('GET', '/offers', { token: ctx.approver.token });
    expectStatus(list, 200);
  });

  await step('deactivated admin cannot log in and existing sessions stop working', async () => {
    expectStatus(await call('PATCH', `/admins/${ctx.superAdmin.data._id}/status`, { token: ctx.superAdmin.token, body: { status: 'Deactivated' } }), 400);
    const a = expectStatus(await call('PATCH', `/admins/${ctx.approver._id}/status`, { token: ctx.superAdmin.token, body: { status: 'Deactivated', reason: 'Left company' } }), 200).data;
    assert.equal(a.status, 'Deactivated');
    expectStatus(await call('GET', '/orders', { token: ctx.approver.token }), 401);
    const res = await call('POST', '/auth/login', { body: { identifier: ctx.approver.username, password: 'Approve@1' } });
    expectStatus(res, 403);
    assert.equal(res.body.code, 'AUTH_ACCOUNT_INACTIVE');
    expectStatus(await call('PATCH', `/admins/${ctx.approver._id}/status`, { token: ctx.superAdmin.token, body: { status: 'Active' } }), 200);
    ctx.approver.token = (await login(ctx.approver.username, 'Approve@1')).token;
  });

  await step('super admin account cannot be modified; normal admins cannot manage admins', async () => {
    const list = expectStatus(await call('GET', '/admins', { token: ctx.superAdmin.token }), 200).data;
    const sa = list.find((x) => x.role === 'SUPER_ADMIN');
    expectStatus(await call('PUT', `/admins/${sa._id}`, { token: ctx.superAdmin.token, body: { name: 'x' } }), 403);
    expectStatus(await call('PATCH', `/admins/${ctx.approver._id}/status`, { token: ctx.opsAdmin.token, body: { status: 'Deactivated' } }), 403);
    expectStatus(await call('DELETE', `/admins/${ctx.approver._id}`, { token: ctx.opsAdmin.token, body: { confirmUsername: ctx.approver.username } }), 403);
  });

  await step('activity history shows who approved orders and managed offers', async () => {
    const act = expectStatus(await call('GET', `/admins/${ctx.approver._id}/activity`, { token: ctx.superAdmin.token }), 200);
    assert.ok(act.summary.some((s) => s.action === 'ORDER_APPROVED'));
    const opsList = expectStatus(await call('GET', '/admins', { token: ctx.superAdmin.token }), 200).data;
    const ops = opsList.find((x) => x.username === 'ops_admin');
    const opsAct = expectStatus(await call('GET', `/admins/${ops._id}/activity`, { token: ctx.superAdmin.token }), 200);
    const actions = opsAct.summary.map((s) => s.action);
    ['OFFER_CREATED', 'ORDER_REJECTED', 'PAYMENT_VERIFIED', 'SETTLEMENT_VERIFIED', 'SETTLEMENT_DISPUTED'].forEach((a) => assert.ok(actions.includes(a), `missing ${a}`));
  });

  await step('delete requires confirmation; deleted admin is blocked but history kept', async () => {
    let res = await call('DELETE', `/admins/${ctx.approver._id}`, { token: ctx.superAdmin.token, body: { confirmUsername: 'wrong' } });
    assert.equal(res.body.code, 'ADMIN_DELETE_CONFIRM');
    res = await call('DELETE', `/admins/${ctx.approver._id}`, { token: ctx.superAdmin.token, body: { confirmUsername: ctx.approver.username, reason: 'Account closed' } });
    expectStatus(res, 200);
    expectStatus(await call('GET', '/orders', { token: ctx.approver.token }), 401);
    expectStatus(await call('POST', '/auth/login', { body: { identifier: ctx.approver.username, password: 'Approve@1' } }), 403);
    const act = expectStatus(await call('GET', `/admins/${ctx.approver._id}/activity`, { token: ctx.superAdmin.token }), 200);
    assert.ok(act.total > 0, 'activity history preserved');
    const approvedOrders = expectStatus(await call('GET', `/reports/orders?adminId=${ctx.approver._id}`, { token: ctx.superAdmin.token }), 200);
    assert.ok(approvedOrders.total >= 1, 'orders decided by the deleted admin are preserved');
  });

  // ═══ 8. Reports & audit ════════════════════════════════════════════════════
  console.log('\n8. Reports & audit');

  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  await step('summary separates order value, sales, collections, refunds and settlements', async () => {
    const s = expectStatus(await call('GET', `/reports/summary?from=${today}&to=${today}`, { token: ctx.superAdmin.token }), 200).data;
    assert.ok(s.orders.total >= 8);
    assert.ok(s.orders.rejected >= 1 && s.orders.cancelled >= 2 && s.orders.delivered >= 4 && s.orders.accepted >= 4);
    assert.ok(s.financial.completedSales > 0 && s.financial.completedSales < s.financial.orderValue);
    assert.ok(s.financial.collected.cod > 0 && s.financial.collected.online > 0);
    assert.ok(s.financial.refunds.refunded > 0);
    assert.ok(s.financial.settlements.verified > 0);
    assert.ok(s.financial.discounts > 0);
    assert.equal(s.daily.length, 1);
    assert.ok(s.byPaymentMode.length === 2);
  });

  await step('filters: payment mode, status, partner, farmer, order id', async () => {
    const t = ctx.superAdmin.token;
    const online = expectStatus(await call('GET', '/reports/orders?paymentMethod=ONLINE', { token: t }), 200);
    assert.ok(online.data.every((o) => o.paymentMethod === 'ONLINE'));
    const rejected = expectStatus(await call('GET', '/reports/orders?status=REJECTED', { token: t }), 200);
    assert.ok(rejected.data.every((o) => o.status === 'REJECTED') && rejected.total >= 1);
    const byPartner = expectStatus(await call('GET', `/reports/orders?partnerId=${ctx.partnerB.data._id}`, { token: t }), 200);
    assert.ok(byPartner.total >= 1);
    const byFarmer = expectStatus(await call('GET', `/reports/orders?farmerId=${ctx.farmer2.data._id}`, { token: t }), 200);
    assert.equal(byFarmer.total, 0);
    const byNumber = expectStatus(await call('GET', `/reports/orders?orderNumber=${ctx.order1.orderNumber}`, { token: t }), 200);
    assert.equal(byNumber.total, 1);
    const future = expectStatus(await call('GET', '/reports/summary?from=2099-01-01&to=2099-01-31', { token: t }), 200).data;
    assert.equal(future.orders.total, 0);
  });

  await step('admin-wise, partner-wise, farmer-wise, offer and product reports', async () => {
    const t = ctx.superAdmin.token;
    const admins = expectStatus(await call('GET', '/reports/admins', { token: t }), 200).data;
    const mod = admins.find((a) => a.username === 'mod_username');
    assert.ok(mod.approved >= 1 && mod.verificationCalls >= 2 && mod.reassigned >= 1);
    const partners = expectStatus(await call('GET', '/reports/partners', { token: t }), 200).data;
    const b = partners.find((p) => p.name === 'Rajesh Patil');
    assert.ok(b.delivered >= 1 && b.failed >= 1 && b.unavailable === 0);
    const a = partners.find((p) => p.name === 'Harpreet Singh');
    assert.ok(a.unavailable >= 2 && a.delivered >= 3);
    const farmers = expectStatus(await call('GET', '/reports/farmers', { token: t }), 200).data;
    assert.ok(farmers.find((f) => f.name === 'Ramesh Patel').orders >= 6);
    const offers = expectStatus(await call('GET', '/reports/offers', { token: t }), 200).data;
    assert.ok(offers.some((o) => o.title.startsWith('Kharif') && o.totalDiscount > 0));
    const products = expectStatus(await call('GET', `/reports/products?productId=${ctx.basmati._id}`, { token: t }), 200).data;
    assert.equal(products.length, 1);
  });

  await step('CSV export', async () => {
    const res = await fetch(`${API}/reports/orders?format=csv&from=${today}`, { headers: { Authorization: `Bearer ${ctx.superAdmin.token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const text = await res.text();
    assert.match(text, /Order ID,Placed at,Status/);
    assert.ok(text.includes(ctx.order1.orderNumber));
  });

  await step('audit log records logins, failures, denials and business actions', async () => {
    const t = ctx.superAdmin.token;
    const denied = expectStatus(await call('GET', '/reports/activity?action=ACCESS_DENIED', { token: t }), 200);
    assert.ok(denied.total >= 5);
    const failed = expectStatus(await call('GET', '/reports/activity?action=LOGIN_FAILED', { token: t }), 200);
    assert.ok(failed.total >= 5);
    const orderTrail = expectStatus(await call('GET', `/reports/activity?entityRef=${ctx.order1.orderNumber}`, { token: t }), 200).data.map((l) => l.action);
    ['ORDER_PLACED', 'ORDER_VERIFICATION_RECORDED', 'ORDER_APPROVED', 'DELIVERY_ACCEPTED', 'DELIVERY_UNAVAILABLE', 'DELIVERY_PICKED_UP', 'ORDER_DELIVERED']
      .forEach((a) => assert.ok(orderTrail.includes(a), `missing ${a}`));
    const farmerActivity = expectStatus(await call('GET', '/reports/activity?role=FARMER', { token: t }), 200);
    assert.ok(farmerActivity.data.every((l) => l.actorRole === 'FARMER'));
    // There is no API to edit or delete audit entries.
    expectStatus(await call('DELETE', '/reports/activity', { token: t }), 404);
  });

  // ═══ 9. Settings ═══════════════════════════════════════════════════════════
  console.log('\n9. Settings');

  await step('delivery fee and free-delivery threshold are applied by the server', async () => {
    const t = ctx.superAdmin.token;
    expectStatus(await call('PUT', '/settings', { token: t, body: { deliveryFee: -1 } }), 400);
    expectStatus(await call('PUT', '/settings', { token: t, body: { deliveryFee: 40, freeDeliveryAbove: 1000 } }), 200);
    const pub = expectStatus(await call('GET', '/settings/public'), 200).data;
    assert.equal(pub.deliveryFee, 40);
    let q = expectStatus(await call('POST', '/orders/quote', { token: ctx.farmer.token, body: { items: [{ productId: ctx.npk._id, quantity: 1 }] } }), 200).data;
    assert.equal(q.deliveryCharge, 40);
    q = expectStatus(await call('POST', '/orders/quote', { token: ctx.farmer.token, body: { items: [{ productId: ctx.basmati._id, quantity: 2 }] } }), 200).data;
    assert.equal(q.deliveryCharge, 0);
    expectStatus(await call('PUT', '/settings', { token: t, body: { deliveryFee: 50, freeDeliveryAbove: 0 } }), 200);
  });

  await step('UPI ID must be a real UPI ID; online payments need one', async () => {
    const t = ctx.superAdmin.token;
    for (const bad of ['abc', 'name@', '@ybl', 'my name@ybl', 'name@ybl.com']) {
      const res = await call('PUT', '/settings', { token: t, body: { upiId: bad } });
      assert.equal(res.body.code, 'UPI_ID_INVALID', bad);
    }
    let res = await call('PUT', '/settings', { token: t, body: { upiId: '', onlineEnabled: true } });
    assert.equal(res.body.code, 'UPI_ID_REQUIRED');
    for (const good of ['9876543210@ybl', 'KamAgro@OKHDFCBANK', 'farm.store-1@paytm']) {
      const d = expectStatus(await call('PUT', '/settings', { token: t, body: { upiId: good } }), 200).data;
      assert.equal(d.upiId, good.toLowerCase());
    }
    const pub = expectStatus(await call('GET', '/settings/public'), 200).data;
    assert.equal(pub.upiId, 'farm.store-1@paytm');
  });

  await step('login method setting is enforced', async () => {
    const t = ctx.superAdmin.token;
    expectStatus(await call('PUT', '/settings', { token: t, body: { loginMethod: 'MOBILE' } }), 200);
    let res = await call('POST', '/auth/login', { body: { identifier: 'ramesh_patel', password: '123456' } });
    assert.equal(res.body.code, 'AUTH_MOBILE_ONLY');
    expectStatus(await call('POST', '/auth/login', { body: { identifier: '9999999999', password: '123456' } }), 200);
    expectStatus(await call('POST', '/auth/login', { body: { identifier: 'admin_username', password: 'Admin@123' } }), 200);
    expectStatus(await call('PUT', '/settings', { token: t, body: { loginMethod: 'USERNAME' } }), 200);
    res = await call('POST', '/auth/login', { body: { identifier: '9999999999', password: '123456' } });
    assert.equal(res.body.code, 'AUTH_USERNAME_ONLY');
    expectStatus(await call('PUT', '/settings', { token: t, body: { loginMethod: 'USERNAME_OR_MOBILE' } }), 200);
  });

  await step('offer deactivation stops discounts on new orders but keeps history', async () => {
    expectStatus(await call('PATCH', `/offers/${ctx.neemOffer._id}/status`, { token: ctx.opsAdmin.token, body: { isActive: false } }), 200);
    const q = expectStatus(await call('POST', '/orders/quote', { token: ctx.farmer.token, body: { items: [{ productId: ctx.neem._id, quantity: 3 }] } }), 200).data;
    assert.equal(q.discount, 0);
    const active = expectStatus(await call('GET', '/offers/active'), 200).data;
    assert.ok(!active.some((o) => o._id === ctx.neemOffer._id));
  });

  // ═══ 10. Super Admin overview, user details & Excel ═══════════════════════
  console.log('\n10. Super Admin overview, user details & Excel');

  await step('business overview: Super Admin only (or REPORTS_VIEW), figures are consistent', async () => {
    expectStatus(await call('GET', '/reports/overview', { token: ctx.farmer.token }), 403);
    expectStatus(await call('GET', '/reports/overview', { token: ctx.partnerA.token }), 403);
    const o = expectStatus(await call('GET', '/reports/overview', { token: ctx.superAdmin.token }), 200).data;
    for (const p of ['today', 'month', 'allTime']) {
      assert.ok(o[p].orders >= o[p].delivered, `${p}: delivered <= orders`);
      assert.ok(o[p].sales <= o[p].orderValue + 0.01, `${p}: sales <= order value`);
    }
    assert.ok(o.allTime.orders >= o.month.orders && o.month.orders >= o.today.orders);
    assert.ok(o.people.farmers.total >= o.people.farmers.active && o.people.farmers.total > 0);
    assert.ok(o.people.partners.total >= 2 && o.people.admins.total >= 3);
    assert.ok(typeof o.attention.pendingApproval === 'number' && typeof o.attention.cashWithPartners === 'number');
    assert.ok(Array.isArray(o.topFarmers) && o.topFarmers.length <= 5);
    assert.ok(o.adminDecisions.some((a) => a.approved > 0), 'admin approvals this month are counted');
  });

  await step('farmer directory shows each farmer\'s orders; detail matches their order history', async () => {
    const list = expectStatus(await call('GET', '/farmers?search=9999999999', { token: ctx.superAdmin.token }), 200).data;
    const me = list[0];
    assert.ok(me.stats && me.stats.orders > 0, 'list carries order stats');
    assert.equal(me.password, undefined);
    const detail = expectStatus(await call('GET', `/farmers/${me._id}`, { token: ctx.superAdmin.token }), 200).data;
    const own = expectStatus(await call('GET', '/orders?limit=200', { token: ctx.farmer.token }), 200);
    assert.equal(detail.stats.orders, own.total);
    const active = own.data.filter((x) => !['REJECTED', 'CANCELLED'].includes(x.status));
    assert.equal(detail.stats.orderValue, money(active.reduce((s, x) => s + x.totalAmount, 0)));
    assert.equal(detail.stats.delivered, own.data.filter((x) => x.status === 'DELIVERED').length);
    assert.ok(detail.orders.length === Math.min(100, own.total) && detail.orders[0].orderNumber);
    assert.ok(detail.stats.mrpSavings >= detail.stats.discount);
  });

  await step('delivery partner detail: deliveries, cash position and handovers add up', async () => {
    const list = expectStatus(await call('GET', '/partners', { token: ctx.superAdmin.token }), 200).data;
    const a = list.find((p) => p.phoneNumber === '9888877777');
    assert.ok(a.stats.delivered >= 1);
    const d = expectStatus(await call('GET', `/partners/${a._id}`, { token: ctx.superAdmin.token }), 200).data;
    const st = d.stats;
    assert.equal(money(st.cashPendingHandover + st.cashSubmitted + st.cashDisputed + st.cashVerified), st.cashCollected);
    assert.ok(d.orders.length >= st.delivered);
    assert.ok(d.settlements.some((s) => s.settlementNumber === ctx.settlement.settlementNumber));
    assert.equal(d.password, undefined);
  });

  await step('Excel export: single-use link, real .xlsx, admin sheets only for Super Admin', async () => {
    const ExcelJS = require('exceljs');
    const fetchXlsx = async (url) => {
      const res = await fetch(url);
      return { status: res.status, type: res.headers.get('content-type') || '', buf: Buffer.from(await res.arrayBuffer()) };
    };
    expectStatus(await call('POST', '/reports/export-link', { token: ctx.farmer.token, body: {} }), 403);
    expectStatus(await call('POST', '/reports/export-link', { token: ctx.superAdmin.token, body: { from: 'not-a-date' } }), 400);

    const link = expectStatus(await call('POST', '/reports/export-link', { token: ctx.superAdmin.token, body: {} }), 200).data;
    const first = await fetchXlsx(link.url);
    assert.equal(first.status, 200);
    assert.ok(first.type.includes('spreadsheetml'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(first.buf);
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ['Summary', 'Orders', 'Farmers', 'Delivery partners', 'Admins', 'Admin decisions', 'Settlements', 'Activity log']) {
      assert.ok(names.includes(n), `sheet ${n}`);
    }
    const ordersSheet = wb.getWorksheet('Orders');
    const all = expectStatus(await call('GET', '/reports/orders?limit=1', { token: ctx.superAdmin.token }), 200);
    assert.equal(ordersSheet.rowCount - 1, all.total, 'every order is exported');

    assert.equal((await fetchXlsx(link.url)).status, 401, 'a link works once');
    assert.equal((await fetchXlsx(link.url.replace(/token=.*/, `token=${ctx.superAdmin.token}`))).status, 401, 'session tokens are not accepted');
    assert.equal((await fetchXlsx(link.url.replace(/token=.*/, 'token=garbage'))).status, 401);

    // An admin who was granted REPORTS_VIEW gets the business sheets but not the admin accounts.
    const username = `reports_${rnd()}`;
    const adm = expectStatus(await call('POST', '/admins', { token: ctx.superAdmin.token, body: { username, name: 'Reports Viewer', password: 'Report@123', role: 'ADMIN', permissions: ['REPORTS_VIEW'] } }), 201).data;
    const s = await login(username, 'Report@123');
    const l2 = expectStatus(await call('POST', '/reports/export-link', { token: s.token, body: {} }), 200).data;
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load((await fetchXlsx(l2.url)).buf);
    const names2 = wb2.worksheets.map((w) => w.name);
    assert.ok(names2.includes('Orders') && !names2.includes('Admins') && !names2.includes('Admin decisions'));

    // Deactivating the admin invalidates a link that was already issued.
    const l3 = expectStatus(await call('POST', '/reports/export-link', { token: s.token, body: {} }), 200).data;
    expectStatus(await call('PATCH', `/admins/${adm._id}/status`, { token: ctx.superAdmin.token, body: { status: 'Deactivated', reason: 'test' } }), 200);
    assert.equal((await fetchXlsx(l3.url)).status, 401);

    const logs = expectStatus(await call('GET', '/reports/activity?action=REPORT_EXPORTED', { token: ctx.superAdmin.token }), 200);
    assert.ok(logs.total >= 2, 'exports are audit-logged');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
