// Server-side message catalog. Clients send `Accept-Language: hi` (or `en`) and every
// user-facing message the API returns is resolved through `t(req, key, params)`.

const MESSAGES = {
  en: {
    // Generic
    SERVER_ERROR: 'Something went wrong. Please try again.',
    NOT_FOUND: 'The requested item was not found.',
    INVALID_ID: 'Invalid identifier.',
    VALIDATION_FAILED: 'Some details are invalid. Please check and try again.',
    TOO_MANY_REQUESTS: 'Too many requests. Please try again in a few minutes.',

    // Auth
    AUTH_TOKEN_MISSING: 'Please log in to continue.',
    AUTH_TOKEN_INVALID: 'Your session has expired. Please log in again.',
    AUTH_ACCOUNT_INACTIVE: 'This account is not active. Please contact support.',
    ACCOUNT_DELETED: 'Your account has been deleted.',
    ACCOUNT_DELETE_STAFF: 'Staff accounts are removed by the administrator.',
    ACCOUNT_HAS_OPEN_ORDERS: 'You have {count} order(s) still in progress. Cancel them or wait for delivery, then delete your account.',
    AUTH_IDENTIFIER_REQUIRED: 'Please enter your username or mobile number.',
    AUTH_PASSWORD_REQUIRED: 'Please enter your password.',
    AUTH_INVALID_CREDENTIALS: 'Incorrect username/mobile number or password.',
    AUTH_USERNAME_ONLY: 'Please log in with your username.',
    AUTH_MOBILE_ONLY: 'Please log in with your registered mobile number.',
    AUTH_ACCOUNT_LOCKED: 'Too many failed attempts. Please try again after {minutes} minutes.',
    AUTH_FORBIDDEN: 'You do not have permission to perform this action.',
    AUTH_ROLE_FARMER: 'This action is only available to farmers.',
    AUTH_ROLE_PARTNER: 'This action is only available to delivery partners.',
    AUTH_ROLE_ADMIN: 'This action is only available to admins.',
    AUTH_SUPER_ADMIN_ONLY: 'Only the Super Admin can perform this action.',
    PASSWORD_MIN_LENGTH: 'Password must be at least 6 characters long.',
    PASSWORD_MISMATCH: 'New password and confirm password do not match.',
    PASSWORD_OLD_REQUIRED: 'Please enter your current password.',
    PASSWORD_OLD_INCORRECT: 'Current password is incorrect.',
    PASSWORD_UPDATED: 'Password updated successfully.',
    PASSWORD_RESET_REQUESTED: 'Your request has been received. Our team will call your registered mobile number to verify and reset your password.',
    PASSWORD_RESET_DONE: 'Password has been reset.',

    // Registration / users
    PHONE_REQUIRED: 'Mobile number is required.',
    PHONE_INVALID: 'Please enter a valid 10-digit mobile number.',
    PHONE_TAKEN: 'This mobile number is already registered.',
    USERNAME_REQUIRED: 'Username is required.',
    USERNAME_INVALID: 'Username must be 3-20 characters: lowercase letters, numbers and underscores only.',
    USERNAME_TAKEN: 'This username is already taken.',
    USERNAME_AVAILABLE: 'Username is available.',
    NAME_REQUIRED: 'Name is required.',
    USER_NOT_FOUND: 'User not found.',
    STATUS_INVALID: 'Invalid status.',
    ADMIN_ROLE_INVALID: 'Role must be ADMIN or MODERATOR.',
    ADMIN_CANNOT_MODIFY_SUPER: 'The Super Admin account cannot be modified here.',
    ADMIN_CANNOT_MODIFY_SELF: 'You cannot change the status of your own account.',
    ADMIN_DELETE_CONFIRM: 'Please type the admin username to confirm deletion.',
    ADMIN_DELETED: 'Admin account deleted. Historical records are preserved.',
    PERMISSION_INVALID: 'One or more permissions are invalid.',
    PARTNER_OFFLINE_ACTIVE_DELIVERY: 'You have orders out for delivery. Complete or report them before going offline.',

    // Products / offers
    PRODUCT_NOT_FOUND: 'Product not found.',
    PRODUCT_INACTIVE: '"{name}" is currently not available.',
    PRODUCT_OUT_OF_STOCK: 'Sorry, only {available} of "{name}" is available.',
    PRODUCT_PRICE_INVALID: 'Selling price must be greater than 0 and cannot exceed MRP.',
    OFFER_NOT_FOUND: 'Offer not found.',
    OFFER_TITLE_REQUIRED: 'Offer title is required.',
    OFFER_PRODUCTS_REQUIRED: 'Select at least one product for this offer.',
    OFFER_DISCOUNT_INVALID: 'Enter a valid discount. Percentage must be between 1 and 90.',
    OFFER_DATES_INVALID: 'Expiry date must be after the start date.',

    // Cart / checkout
    CART_EMPTY: 'Your cart is empty.',
    CART_QTY_INVALID: 'Quantity must be at least 1.',
    ADDRESS_REQUIRED: 'Please add a delivery address.',
    PAYMENT_METHOD_INVALID: 'Please select a valid payment mode.',
    PAYMENT_METHOD_DISABLED: 'This payment mode is currently not available.',
    PAYMENT_REFERENCE_REQUIRED: 'Please enter the UPI / transaction reference number.',
    PAYMENT_REFERENCE_INVALID: 'Enter the 12-digit UPI transaction reference (UTR) shown in your UPI app.',
    UPI_ID_INVALID: 'Enter a valid UPI ID, for example 9876543210@ybl or name@okhdfcbank.',
    UPI_ID_REQUIRED: 'Add the UPI ID before turning on online payments.',
    PAYMENT_REFERENCE_USED: 'This transaction reference has already been used for another order.',
    ORDER_DUPLICATE: 'This order was already placed.',
    PRICE_CHANGED: 'Prices have changed since you opened the cart. Please review the updated total.',

    // Orders
    ORDER_NOT_FOUND: 'Order not found.',
    ORDER_CHANGED: 'This order was just updated by someone else. Please refresh and try again.',
    ORDER_TRANSITION_INVALID: 'This action is not allowed while the order is "{status}".',
    ORDER_REASON_REQUIRED: 'Please enter a reason.',
    ORDER_VERIFICATION_REQUIRED: 'Record a successful phone verification with the farmer before approving.',
    ORDER_VERIFICATION_INVALID: 'Invalid verification outcome.',
    ORDER_ALREADY_TAKEN: 'This order has already been taken by another delivery partner.',
    ORDER_NOT_ASSIGNED_TO_YOU: 'This order is not assigned to you.',
    PARTNER_NOT_AVAILABLE: 'Selected delivery partner is not active.',
    PARTNER_OFFLINE: 'You are offline. Go online to accept delivery orders.',
    COLLECTION_AMOUNT_INVALID: 'Enter the cash amount collected (0 or more).',
    COLLECTION_ONLINE_FORBIDDEN: 'Online payments are verified by the admin. You cannot mark them as paid.',
    PAYMENT_NOT_AWAITING: 'There is no payment waiting for verification on this order.',
    REFUND_NOT_APPLICABLE: 'No refund is pending for this order.',

    // Settlements
    SETTLEMENT_NOT_FOUND: 'Settlement not found.',
    SETTLEMENT_NOTHING_OUTSTANDING: 'There is no outstanding cash to hand over.',
    SETTLEMENT_AMOUNT_INVALID: 'Enter a valid handover amount.',
    SETTLEMENT_TRANSITION_INVALID: 'This settlement is already "{status}".',

    // Settings
    SETTINGS_INVALID: 'Invalid settings values.',
  },
  hi: {
    SERVER_ERROR: 'कुछ गलत हो गया। कृपया पुनः प्रयास करें।',
    NOT_FOUND: 'अनुरोधित जानकारी नहीं मिली।',
    INVALID_ID: 'अमान्य पहचान संख्या।',
    VALIDATION_FAILED: 'कुछ जानकारी अमान्य है। कृपया जाँचें और पुनः प्रयास करें।',
    TOO_MANY_REQUESTS: 'बहुत अधिक अनुरोध। कृपया कुछ मिनट बाद पुनः प्रयास करें।',

    AUTH_TOKEN_MISSING: 'जारी रखने के लिए कृपया लॉग इन करें।',
    AUTH_TOKEN_INVALID: 'आपका सत्र समाप्त हो गया है। कृपया फिर से लॉग इन करें।',
    AUTH_ACCOUNT_INACTIVE: 'यह खाता सक्रिय नहीं है। कृपया सहायता से संपर्क करें।',
    ACCOUNT_DELETED: 'आपका खाता हटा दिया गया है।',
    ACCOUNT_DELETE_STAFF: 'स्टाफ खाते एडमिन द्वारा हटाए जाते हैं।',
    ACCOUNT_HAS_OPEN_ORDERS: 'आपके {count} ऑर्डर अभी चल रहे हैं। उन्हें रद्द करें या डिलीवरी का इंतज़ार करें, फिर खाता हटाएँ।',
    AUTH_IDENTIFIER_REQUIRED: 'कृपया अपना यूज़रनेम या मोबाइल नंबर दर्ज करें।',
    AUTH_PASSWORD_REQUIRED: 'कृपया अपना पासवर्ड दर्ज करें।',
    AUTH_INVALID_CREDENTIALS: 'यूज़रनेम/मोबाइल नंबर या पासवर्ड गलत है।',
    AUTH_USERNAME_ONLY: 'कृपया अपने यूज़रनेम से लॉग इन करें।',
    AUTH_MOBILE_ONLY: 'कृपया अपने पंजीकृत मोबाइल नंबर से लॉग इन करें।',
    AUTH_ACCOUNT_LOCKED: 'बहुत अधिक असफल प्रयास। कृपया {minutes} मिनट बाद पुनः प्रयास करें।',
    AUTH_FORBIDDEN: 'आपको यह कार्य करने की अनुमति नहीं है।',
    AUTH_ROLE_FARMER: 'यह सुविधा केवल किसानों के लिए है।',
    AUTH_ROLE_PARTNER: 'यह सुविधा केवल डिलीवरी पार्टनर के लिए है।',
    AUTH_ROLE_ADMIN: 'यह सुविधा केवल एडमिन के लिए है।',
    AUTH_SUPER_ADMIN_ONLY: 'यह कार्य केवल सुपर एडमिन कर सकते हैं।',
    PASSWORD_MIN_LENGTH: 'पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।',
    PASSWORD_MISMATCH: 'नया पासवर्ड और पुष्टि पासवर्ड मेल नहीं खाते।',
    PASSWORD_OLD_REQUIRED: 'कृपया अपना वर्तमान पासवर्ड दर्ज करें।',
    PASSWORD_OLD_INCORRECT: 'वर्तमान पासवर्ड गलत है।',
    PASSWORD_UPDATED: 'पासवर्ड सफलतापूर्वक बदल दिया गया।',
    PASSWORD_RESET_REQUESTED: 'आपका अनुरोध प्राप्त हो गया है। हमारी टीम सत्यापन और पासवर्ड रीसेट के लिए आपके पंजीकृत मोबाइल नंबर पर कॉल करेगी।',
    PASSWORD_RESET_DONE: 'पासवर्ड रीसेट कर दिया गया है।',

    PHONE_REQUIRED: 'मोबाइल नंबर आवश्यक है।',
    PHONE_INVALID: 'कृपया मान्य 10 अंकों का मोबाइल नंबर दर्ज करें।',
    PHONE_TAKEN: 'यह मोबाइल नंबर पहले से पंजीकृत है।',
    USERNAME_REQUIRED: 'यूज़रनेम आवश्यक है।',
    USERNAME_INVALID: 'यूज़रनेम 3-20 अक्षरों का हो: केवल छोटे अंग्रेज़ी अक्षर, अंक और अंडरस्कोर।',
    USERNAME_TAKEN: 'यह यूज़रनेम पहले से लिया जा चुका है।',
    USERNAME_AVAILABLE: 'यूज़रनेम उपलब्ध है।',
    NAME_REQUIRED: 'नाम आवश्यक है।',
    USER_NOT_FOUND: 'उपयोगकर्ता नहीं मिला।',
    STATUS_INVALID: 'अमान्य स्थिति।',
    ADMIN_ROLE_INVALID: 'भूमिका ADMIN या MODERATOR होनी चाहिए।',
    ADMIN_CANNOT_MODIFY_SUPER: 'सुपर एडमिन खाते को यहाँ से बदला नहीं जा सकता।',
    ADMIN_CANNOT_MODIFY_SELF: 'आप अपने स्वयं के खाते की स्थिति नहीं बदल सकते।',
    ADMIN_DELETE_CONFIRM: 'हटाने की पुष्टि के लिए कृपया एडमिन का यूज़रनेम लिखें।',
    ADMIN_DELETED: 'एडमिन खाता हटा दिया गया। पुराने रिकॉर्ड सुरक्षित हैं।',
    PERMISSION_INVALID: 'एक या अधिक अनुमतियाँ अमान्य हैं।',
    PARTNER_OFFLINE_ACTIVE_DELIVERY: 'आपके ऑर्डर डिलीवरी के लिए निकले हुए हैं। ऑफ़लाइन होने से पहले उन्हें पूरा करें या रिपोर्ट करें।',

    PRODUCT_NOT_FOUND: 'उत्पाद नहीं मिला।',
    PRODUCT_INACTIVE: '"{name}" अभी उपलब्ध नहीं है।',
    PRODUCT_OUT_OF_STOCK: 'क्षमा करें, "{name}" की केवल {available} मात्रा उपलब्ध है।',
    PRODUCT_PRICE_INVALID: 'बिक्री मूल्य 0 से अधिक और MRP से कम या बराबर होना चाहिए।',
    OFFER_NOT_FOUND: 'ऑफ़र नहीं मिला।',
    OFFER_TITLE_REQUIRED: 'ऑफ़र का शीर्षक आवश्यक है।',
    OFFER_PRODUCTS_REQUIRED: 'इस ऑफ़र के लिए कम से कम एक उत्पाद चुनें।',
    OFFER_DISCOUNT_INVALID: 'मान्य छूट दर्ज करें। प्रतिशत 1 से 90 के बीच होना चाहिए।',
    OFFER_DATES_INVALID: 'समाप्ति तिथि शुरू होने की तिथि के बाद होनी चाहिए।',

    CART_EMPTY: 'आपकी कार्ट खाली है।',
    CART_QTY_INVALID: 'मात्रा कम से कम 1 होनी चाहिए।',
    ADDRESS_REQUIRED: 'कृपया डिलीवरी पता जोड़ें।',
    PAYMENT_METHOD_INVALID: 'कृपया मान्य भुगतान माध्यम चुनें।',
    PAYMENT_METHOD_DISABLED: 'यह भुगतान माध्यम अभी उपलब्ध नहीं है।',
    PAYMENT_REFERENCE_REQUIRED: 'कृपया UPI / लेनदेन संदर्भ संख्या दर्ज करें।',
    PAYMENT_REFERENCE_INVALID: 'अपने UPI ऐप में दिखा 12 अंकों का UPI लेनदेन संदर्भ (UTR) दर्ज करें।',
    UPI_ID_INVALID: 'सही UPI ID दर्ज करें, जैसे 9876543210@ybl या name@okhdfcbank',
    UPI_ID_REQUIRED: 'ऑनलाइन भुगतान चालू करने से पहले UPI ID जोड़ें।',
    PAYMENT_REFERENCE_USED: 'यह लेनदेन संदर्भ पहले ही किसी अन्य ऑर्डर के लिए उपयोग हो चुका है।',
    ORDER_DUPLICATE: 'यह ऑर्डर पहले ही दिया जा चुका है।',
    PRICE_CHANGED: 'कार्ट खोलने के बाद कीमतें बदल गई हैं। कृपया नया कुल देखें।',

    ORDER_NOT_FOUND: 'ऑर्डर नहीं मिला।',
    ORDER_CHANGED: 'यह ऑर्डर अभी किसी और ने अपडेट किया है। कृपया रीफ़्रेश करके पुनः प्रयास करें।',
    ORDER_TRANSITION_INVALID: 'ऑर्डर "{status}" होने पर यह कार्य संभव नहीं है।',
    ORDER_REASON_REQUIRED: 'कृपया कारण दर्ज करें।',
    ORDER_VERIFICATION_REQUIRED: 'स्वीकृति से पहले किसान से फ़ोन पर सफल सत्यापन दर्ज करें।',
    ORDER_VERIFICATION_INVALID: 'अमान्य सत्यापन परिणाम।',
    ORDER_ALREADY_TAKEN: 'यह ऑर्डर पहले ही किसी अन्य डिलीवरी पार्टनर ने ले लिया है।',
    ORDER_NOT_ASSIGNED_TO_YOU: 'यह ऑर्डर आपको सौंपा नहीं गया है।',
    PARTNER_NOT_AVAILABLE: 'चयनित डिलीवरी पार्टनर सक्रिय नहीं है।',
    PARTNER_OFFLINE: 'आप ऑफ़लाइन हैं। डिलीवरी ऑर्डर स्वीकार करने के लिए ऑनलाइन हों।',
    COLLECTION_AMOUNT_INVALID: 'एकत्रित नकद राशि दर्ज करें (0 या अधिक)।',
    COLLECTION_ONLINE_FORBIDDEN: 'ऑनलाइन भुगतान एडमिन द्वारा सत्यापित होते हैं। आप उन्हें भुगतान हुआ नहीं कर सकते।',
    PAYMENT_NOT_AWAITING: 'इस ऑर्डर पर कोई भुगतान सत्यापन के लिए लंबित नहीं है।',
    REFUND_NOT_APPLICABLE: 'इस ऑर्डर पर कोई रिफ़ंड लंबित नहीं है।',

    SETTLEMENT_NOT_FOUND: 'सेटलमेंट नहीं मिला।',
    SETTLEMENT_NOTHING_OUTSTANDING: 'जमा करने के लिए कोई बकाया नकद नहीं है।',
    SETTLEMENT_AMOUNT_INVALID: 'मान्य जमा राशि दर्ज करें।',
    SETTLEMENT_TRANSITION_INVALID: 'यह सेटलमेंट पहले से "{status}" है।',

    SETTINGS_INVALID: 'अमान्य सेटिंग्स मान।',
  },
};

const getLang = (req) => {
  const header = String((req && req.headers && req.headers['accept-language']) || '').toLowerCase();
  return header.startsWith('hi') ? 'hi' : 'en';
};

const format = (template, params = {}) =>
  String(template).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));

const t = (req, key, params) => {
  const lang = getLang(req);
  const template = (MESSAGES[lang] && MESSAGES[lang][key]) || MESSAGES.en[key] || key;
  return format(template, params);
};

/**
 * Error carrying an i18n key; thrown from controllers/services and rendered by the global
 * error handler so responses are always localized and never leak internals.
 */
class AppError extends Error {
  constructor(status, key, params) {
    super(key);
    this.status = status;
    this.key = key;
    this.params = params;
  }
}

module.exports = { t, getLang, AppError, MESSAGES };
