const express = require('express');

const router = express.Router();

// Public pages linked from the Google Play listing (privacy policy and account deletion).
// The contact address comes from SUPPORT_EMAIL / SUPPORT_PHONE in the server's .env.

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const contactLine = () => {
  const email = process.env.SUPPORT_EMAIL;
  const phone = process.env.SUPPORT_PHONE;
  const parts = [];
  if (email) parts.push(`<a href="mailto:${esc(email)}">${esc(email)}</a>`);
  if (phone) parts.push(`<a href="tel:${esc(phone)}">${esc(phone)}</a>`);
  return parts.length ? parts.join(' · ') : 'the contact details shown in the AgriHarvest app';
};

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AgriHarvest</title>
<style>
  body{margin:0;background:#F2F3EE;color:#1A1A1A;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
  h1{color:#1E6B2E;font-size:28px;margin:8px 0 4px} h2{font-size:19px;margin:28px 0 6px}
  .card{background:#fff;border:1px solid #E5E5E0;border-radius:14px;padding:18px 20px;margin-top:16px}
  .muted{color:#6B7280;font-size:14px} li{margin:4px 0} a{color:#1E6B2E}
  .hi{border-top:1px solid #E5E5E0;margin-top:24px;padding-top:8px}
</style></head><body><main>${body}</main></body></html>`;

router.get('/privacy', (req, res) => {
  res.type('html').send(page('Privacy policy', `
<h1>AgriHarvest privacy policy</h1>
<p class="muted">Last updated: 26 October 2026</p>
<div class="card">
<p>AgriHarvest is an app for ordering farm inputs (seeds, fertilisers, crop protection and tools) with home delivery.
This policy explains what we collect, why, who can see it and how to delete your account.</p>

<h2>What we collect</h2>
<ul>
  <li><b>Account details:</b> name, mobile number, username, password (stored only as a secure hash), language preference.</li>
  <li><b>Farm and delivery details:</b> delivery address, village, district, state, PIN code, crop and land size if you enter them.</li>
  <li><b>Orders and payments:</b> products, quantities, prices, discounts, payment mode, UPI transaction reference (UTR) you enter, cash collected on delivery and refunds.</li>
  <li><b>Photos:</b> a profile or cover photo if you add one; delivery partners take a photo as proof of delivery; staff add product photos.</li>
  <li><b>Location:</b> only when you allow it — approximate location to show local weather, and precise location only when you tap "use my location" to fill in your delivery address. We do not track location in the background.</li>
  <li><b>Activity records:</b> sign-ins and important actions (such as order approvals and payment checks) for security and auditing.</li>
</ul>

<h2>Why we use it</h2>
<ul>
  <li>To create your account, take and deliver your orders, and confirm orders by phone before dispatch.</li>
  <li>To verify UPI payments, record cash collected on delivery and process refunds.</li>
  <li>To keep accounts secure and prevent misuse.</li>
</ul>

<h2>Who can see it</h2>
<ul>
  <li><b>Our staff (admins)</b> who approve orders, verify payments and manage deliveries.</li>
  <li><b>The delivery partner</b> assigned to your order sees your name, mobile number, delivery address and what to deliver and collect.</li>
  <li>We do not sell your data and do not share it for advertising. We may disclose it if required by law.</li>
</ul>

<h2>Payments</h2>
<p>We do not collect card or bank account details. UPI payments are made in your own UPI app; we only store the transaction reference you type in.</p>

<h2>How long we keep it</h2>
<p>Account details are kept while your account is active. Order and payment records are kept for as long as required by Indian tax and accounting law, even after an account is deleted.</p>

<h2>Security</h2>
<p>Data is sent over encrypted connections (HTTPS). Passwords are hashed and never stored in plain text.</p>

<h2>Delete your account</h2>
<p>Farmers can delete their account in the app: <b>Profile → Delete my account</b>. See <a href="/delete-account">how account deletion works</a>.</p>

<h2>Contact</h2>
<p>Questions about your data: ${contactLine()}.</p>

<div class="hi">
<h2>हिंदी सारांश</h2>
<p>AgriHarvest खेती के सामान के ऑर्डर और होम डिलीवरी का ऐप है। हम आपका नाम, मोबाइल नंबर, पता, ऑर्डर, भुगतान का UTR और आपके द्वारा जोड़ी गई फ़ोटो रखते हैं ताकि आपका ऑर्डर लिया, पुष्टि किया और डिलीवर किया जा सके।
आपकी अनुमति से ही लोकेशन ली जाती है (मौसम और पता भरने के लिए)। डिलीवरी पार्टनर को सिर्फ़ आपका नाम, मोबाइल नंबर, पता और ऑर्डर दिखता है। हम आपका डेटा बेचते नहीं हैं।
आप ऐप में <b>प्रोफ़ाइल → मेरा खाता हटाएँ</b> से अपना खाता हटा सकते हैं।</p>
</div>
</div>`));
});

router.get('/delete-account', (req, res) => {
  res.type('html').send(page('Delete your account', `
<h1>Delete your AgriHarvest account</h1>
<div class="card">
<h2>In the app (fastest)</h2>
<ol>
  <li>Open AgriHarvest and log in.</li>
  <li>Open <b>Profile</b> (tap your photo at the top left).</li>
  <li>Tap <b>Delete my account</b>, enter your password and confirm.</li>
</ol>
<p class="muted">If an order is still in progress, cancel it or wait until it is delivered first.</p>

<h2>Without the app</h2>
<p>Contact us at ${contactLine()} from your registered mobile number and ask us to delete your account. We will confirm within 7 days.</p>

<h2>What is deleted</h2>
<ul>
  <li>Your name, username, address, farm details, profile and cover photos, saved cart and password.</li>
  <li>Your mobile number is released, so it can be used to register again.</li>
</ul>

<h2>What is kept</h2>
<p>Records of orders you placed (products, amounts, payment references and the name and number recorded on the order) are kept as business and tax records for as long as Indian law requires. They are not used for anything else.</p>

<div class="hi">
<h2>हिंदी में</h2>
<p>ऐप में <b>प्रोफ़ाइल → मेरा खाता हटाएँ</b> दबाएँ, पासवर्ड डालें और पुष्टि करें। आपका नाम, पता, फ़ोटो और पासवर्ड हटा दिए जाते हैं।
पुराने ऑर्डर का रिकॉर्ड कानून के अनुसार रखा जाता है। ऐप के बिना: ${contactLine()} पर अपने पंजीकृत नंबर से संपर्क करें।</p>
</div>
</div>`));
});

module.exports = router;
