const mongoose = require('mongoose');
const Product = require('../models/Product');
const Offer = require('../models/Offer');
const { AppError } = require('../utils/i18n');
const { getSettings } = require('../utils/settings');
const { toMoney } = require('../utils/validators');

/*
 * Single source of truth for prices. Product listings, product details, the cart quote and
 * order placement all go through these functions, so the farmer always sees exactly the amount
 * the server will charge, and nothing the client sends can change it.
 *
 *   MRP            printed maximum retail price (informational savings)
 *   unitPrice      everyday selling price (tax inclusive)
 *   offer discount best eligible active offer, applied once per product line
 *   subtotal       Σ unitPrice × qty            ("original subtotal before discounts")
 *   discount       Σ offer discount
 *   delivery       admin-configured fee, free above the configured threshold
 *   total          subtotal − discount + delivery
 */

const discountPerUnitFor = (offer, unitPrice) => {
  if (!offer) return 0;
  const raw = offer.discountType === 'PERCENT'
    ? (unitPrice * offer.discountValue) / 100
    : offer.discountValue;
  return toMoney(Math.max(0, Math.min(unitPrice, raw)));
};

const activeOffersFor = async (productIds, now = new Date()) => {
  if (!productIds.length) return [];
  return Offer.find({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
    products: { $in: productIds },
  }).lean();
};

const offersByProduct = (offers) => {
  const map = new Map();
  offers.forEach((offer) => {
    (offer.products || []).forEach((pid) => {
      const key = String(pid);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(offer);
    });
  });
  return map;
};

const offerSummary = (offer) => offer && ({
  _id: offer._id,
  title: offer.title,
  titleHi: offer.titleHi || '',
  discountType: offer.discountType,
  discountValue: offer.discountValue,
  minPurchaseAmount: offer.minPurchaseAmount || 0,
  minQuantity: offer.minQuantity || 1,
  startDate: offer.startDate,
  endDate: offer.endDate,
});

// Best offer for display on a product card: the largest per-unit discount among active offers.
const bestDisplayOffer = (product, candidates = []) => {
  let best = null;
  let bestDiscount = 0;
  candidates.forEach((offer) => {
    const d = discountPerUnitFor(offer, product.price);
    if (d > bestDiscount) { best = offer; bestDiscount = d; }
  });
  return { offer: best, discountPerUnit: bestDiscount };
};

/** Pricing block attached to every product returned by the API. */
const productPricing = (product, candidates = []) => {
  const mrp = toMoney(product.mrp || product.price);
  const price = toMoney(product.price);
  const { offer, discountPerUnit } = bestDisplayOffer(product, candidates);
  const offerPrice = toMoney(price - discountPerUnit);
  const finalPrice = offer ? offerPrice : price;
  const totalSavings = toMoney(Math.max(0, mrp - finalPrice));
  return {
    currency: 'INR',
    mrp,
    price,
    offerPrice: offer ? offerPrice : null,
    finalPrice,
    discountPerUnit,
    savingsFromMrp: totalSavings,
    savingsPercent: mrp > 0 ? Math.round((totalSavings / mrp) * 100) : 0,
    offer: offerSummary(offer),
    // An offer with a minimum purchase is shown, but only applies in the cart when eligible.
    offerConditional: !!(offer && ((offer.minPurchaseAmount || 0) > 0 || (offer.minQuantity || 1) > 1)),
  };
};

/** Decorate product documents (or lean objects) with their current pricing. */
const withPricing = async (products, now = new Date()) => {
  const list = Array.isArray(products) ? products : [products];
  const offers = await activeOffersFor(list.map((p) => p._id), now);
  const byProduct = offersByProduct(offers);
  const out = list.map((p) => {
    const obj = typeof p.toObject === 'function' ? p.toObject() : { ...p };
    obj.pricing = productPricing(obj, byProduct.get(String(obj._id)) || []);
    return obj;
  });
  return Array.isArray(products) ? out : out[0];
};

/**
 * Price a cart. `items` = [{ productId, quantity }]. Throws localized errors for unknown,
 * inactive or out-of-stock products when `strict` is true (checkout); in non-strict mode
 * (cart preview) such lines are returned with an `issue` instead.
 */
const priceCart = async (items, { strict = true, now = new Date() } = {}) => {
  if (!Array.isArray(items) || items.length === 0) throw new AppError(400, 'CART_EMPTY');

  // Merge duplicate product lines so a discount can never be applied twice to the same product.
  const merged = new Map();
  items.forEach((item) => {
    const id = String(item && item.productId || '');
    const qty = Math.floor(Number(item && item.quantity));
    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (strict) throw new AppError(400, 'PRODUCT_NOT_FOUND');
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      if (strict) throw new AppError(400, 'CART_QTY_INVALID');
      return;
    }
    merged.set(id, (merged.get(id) || 0) + qty);
  });
  if (merged.size === 0) throw new AppError(400, 'CART_EMPTY');

  const ids = [...merged.keys()];
  const [products, offers, settings] = await Promise.all([
    Product.find({ _id: { $in: ids } }),
    activeOffersFor(ids, now),
    getSettings(),
  ]);
  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const byProduct = offersByProduct(offers);

  const lines = [];
  const issues = [];
  ids.forEach((id) => {
    const product = productMap.get(id);
    const quantity = merged.get(id);
    if (!product) {
      if (strict) throw new AppError(400, 'PRODUCT_NOT_FOUND');
      issues.push({ productId: id, issue: 'NOT_FOUND' });
      return;
    }
    if (!product.isActive) {
      if (strict) throw new AppError(400, 'PRODUCT_INACTIVE', { name: product.name });
      issues.push({ productId: id, issue: 'INACTIVE', name: product.name });
      return;
    }
    if ((product.quantityAvailable || 0) < quantity) {
      if (strict) throw new AppError(400, 'PRODUCT_OUT_OF_STOCK', { name: product.name, available: product.quantityAvailable || 0 });
      // Excluded from the preview totals; the farmer must reduce the quantity before checkout.
      issues.push({ productId: id, issue: 'OUT_OF_STOCK', name: product.name, available: product.quantityAvailable || 0, requested: quantity });
      return;
    }
    lines.push({ product, quantity });
  });

  // Offer eligibility uses the cart subtotal at selling price (before any offer discount).
  const subtotal = toMoney(lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0));

  const priced = lines.map(({ product, quantity }) => {
    const unitPrice = toMoney(product.price);
    const mrp = toMoney(product.mrp || product.price);
    let best = null;
    let bestPerUnit = 0;
    (byProduct.get(String(product._id)) || []).forEach((offer) => {
      if (quantity < (offer.minQuantity || 1)) return;
      if (subtotal < (offer.minPurchaseAmount || 0)) return;
      const d = discountPerUnitFor(offer, unitPrice);
      if (d > bestPerUnit) { best = offer; bestPerUnit = d; }
    });
    const lineSubtotal = toMoney(unitPrice * quantity);
    const lineDiscount = toMoney(bestPerUnit * quantity);
    const image = (product.images && product.images[0]) || (product.imageUrls && product.imageUrls[0]) || '';
    return {
      productId: product._id,
      productName: product.name,
      productNameHi: product.nameHi || '',
      image,
      unit: product.unit,
      unitQuantity: product.unitQuantity,
      mrp,
      unitPrice,
      quantity,
      lineMrpTotal: toMoney(mrp * quantity),
      lineSubtotal,
      offerId: best ? best._id : null,
      offerTitle: best ? best.title : '',
      offerTitleHi: best ? (best.titleHi || '') : '',
      offerDiscountType: best ? best.discountType : '',
      offerDiscountValue: best ? best.discountValue : 0,
      discountPerUnit: bestPerUnit,
      lineDiscount,
      lineTotal: toMoney(lineSubtotal - lineDiscount),
      availableStock: product.quantityAvailable || 0,
    };
  });

  const discount = toMoney(priced.reduce((s, l) => s + l.lineDiscount, 0));
  const mrpTotal = toMoney(priced.reduce((s, l) => s + l.lineMrpTotal, 0));
  const itemsTotal = toMoney(subtotal - discount);
  const freeAbove = settings.freeDeliveryAbove || 0;
  const deliveryCharge = priced.length === 0
    ? 0
    : (freeAbove > 0 && itemsTotal >= freeAbove ? 0 : toMoney(settings.deliveryFee || 0));

  return {
    currency: 'INR',
    items: priced,
    issues,
    mrpTotal,
    mrpSavings: toMoney(Math.max(0, mrpTotal - subtotal)),
    subtotal,
    discount,
    itemsTotal,
    deliveryCharge,
    freeDeliveryAbove: freeAbove,
    totalAmount: toMoney(itemsTotal + deliveryCharge),
    pricedAt: now,
  };
};

module.exports = { priceCart, withPricing, productPricing, discountPerUnitFor, activeOffersFor };
