const Offer = require('../models/Offer');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { AppError } = require('../utils/i18n');
const { audit } = require('../utils/audit');
const { requireValidId, isValidId, cleanText, toMoney, parseDate } = require('../utils/validators');
const { withPricing, discountPerUnitFor } = require('../services/pricingService');

const offerFields = async (body, existing) => {
  const out = {};
  if (body.title !== undefined || !existing) {
    out.title = cleanText(body.title, 120);
    if (!out.title) throw new AppError(400, 'OFFER_TITLE_REQUIRED');
  }
  if (body.titleHi !== undefined) out.titleHi = cleanText(body.titleHi, 120);
  if (body.description !== undefined) out.description = cleanText(body.description, 1000);
  if (body.descriptionHi !== undefined) out.descriptionHi = cleanText(body.descriptionHi, 1000);

  const type = body.discountType !== undefined ? String(body.discountType).toUpperCase() : (existing && existing.discountType);
  const value = body.discountValue !== undefined ? toMoney(body.discountValue) : (existing && existing.discountValue);
  if (!['PERCENT', 'FIXED'].includes(type) || !(value > 0) || (type === 'PERCENT' && (value < 1 || value > 90))) {
    throw new AppError(400, 'OFFER_DISCOUNT_INVALID');
  }
  out.discountType = type;
  out.discountValue = value;

  if (body.products !== undefined || !existing) {
    const ids = [...new Set((Array.isArray(body.products) ? body.products : []).map(String))].filter(isValidId);
    if (!ids.length) throw new AppError(400, 'OFFER_PRODUCTS_REQUIRED');
    const found = await Product.find({ _id: { $in: ids } }).select('_id price');
    if (found.length !== ids.length) throw new AppError(400, 'OFFER_PRODUCTS_REQUIRED');
    // A fixed discount can never exceed the selling price of an eligible product.
    if (type === 'FIXED' && found.some((p) => value >= p.price)) throw new AppError(400, 'OFFER_DISCOUNT_INVALID');
    out.products = ids;
  } else if (type === 'FIXED' && existing) {
    const found = await Product.find({ _id: { $in: existing.products } }).select('price');
    if (found.some((p) => value >= p.price)) throw new AppError(400, 'OFFER_DISCOUNT_INVALID');
  }

  if (body.minPurchaseAmount !== undefined) out.minPurchaseAmount = Math.max(0, toMoney(body.minPurchaseAmount));
  if (body.minQuantity !== undefined) out.minQuantity = Math.max(1, Math.floor(Number(body.minQuantity) || 1));

  const start = body.startDate !== undefined ? parseDate(body.startDate) : (existing && existing.startDate);
  const end = body.endDate !== undefined ? parseDate(body.endDate, true) : (existing && existing.endDate);
  if (!start || !end || end.getTime() <= start.getTime()) throw new AppError(400, 'OFFER_DATES_INVALID');
  out.startDate = start;
  out.endDate = end;

  if (body.isActive !== undefined) out.isActive = body.isActive === true || body.isActive === 'true';
  return out;
};

// Usage = how many non-cancelled orders used the offer and the total discount given.
const usageFor = async (offerIds) => {
  if (!offerIds.length) return new Map();
  const rows = await Order.aggregate([
    { $match: { 'items.offerId': { $in: offerIds }, status: { $nin: ['REJECTED', 'CANCELLED'] } } },
    { $unwind: '$items' },
    { $match: { 'items.offerId': { $in: offerIds } } },
    {
      $group: {
        _id: '$items.offerId',
        orders: { $addToSet: '$_id' },
        unitsSold: { $sum: '$items.quantity' },
        totalDiscount: { $sum: '$items.lineDiscount' },
        salesValue: { $sum: '$items.lineTotal' },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), {
    orderCount: r.orders.length,
    unitsSold: r.unitsSold,
    totalDiscount: toMoney(r.totalDiscount),
    salesValue: toMoney(r.salesValue),
  }]));
};

const serialize = (offer, usage, now) => {
  const o = offer.toObject();
  o.status = offer.statusAt(now);
  o.usage = usage.get(String(offer._id)) || { orderCount: 0, unitsSold: 0, totalDiscount: 0, salesValue: 0 };
  return o;
};

// @route GET /api/offers  (admin) ?status=ACTIVE|SCHEDULED|EXPIRED|INACTIVE
exports.listOffers = async (req, res) => {
  const now = new Date();
  const status = String(req.query.status || '').toUpperCase();
  const filter = {};
  if (status === 'INACTIVE') filter.isActive = false;
  else if (status === 'ACTIVE') Object.assign(filter, { isActive: true, startDate: { $lte: now }, endDate: { $gte: now } });
  else if (status === 'SCHEDULED') Object.assign(filter, { isActive: true, startDate: { $gt: now } });
  else if (status === 'EXPIRED') Object.assign(filter, { isActive: true, endDate: { $lt: now } });

  const offers = await Offer.find(filter).populate('products', 'name nameHi images price mrp unit unitQuantity isActive').sort({ createdAt: -1 });
  const usage = await usageFor(offers.map((o) => o._id));
  res.status(200).json({ success: true, count: offers.length, data: offers.map((o) => serialize(o, usage, now)) });
};

// @route GET /api/offers/:id  (admin)
exports.getOffer = async (req, res) => {
  const offer = await Offer.findById(requireValidId(req.params.id)).populate('products', 'name nameHi images price mrp unit unitQuantity isActive');
  if (!offer) throw new AppError(404, 'OFFER_NOT_FOUND');
  const usage = await usageFor([offer._id]);
  res.status(200).json({ success: true, data: serialize(offer, usage, new Date()) });
};

// @route GET /api/offers/active  (public) — for the farmer Offers section
exports.activeOffers = async (req, res) => {
  const now = new Date();
  const offers = await Offer.find({ isActive: true, startDate: { $lte: now }, endDate: { $gte: now } }).sort({ endDate: 1 });
  const productIds = [...new Set(offers.flatMap((o) => o.products.map(String)))];
  const products = await Product.find({ _id: { $in: productIds }, isActive: true });
  const priced = new Map((await withPricing(products, now)).map((p) => [String(p._id), p]));

  const data = offers.map((offer) => {
    const offerProducts = offer.products.map(String).map((id) => priced.get(id)).filter(Boolean).map((p) => {
      // Price of the product under THIS offer (the product card may show a better offer).
      const discountPerUnit = discountPerUnitFor(offer, p.price);
      return {
        ...p,
        offerPricing: {
          mrp: p.mrp,
          price: p.price,
          discountPerUnit,
          offerPrice: toMoney(p.price - discountPerUnit),
          savingsFromMrp: toMoney(p.mrp - (p.price - discountPerUnit)),
        },
      };
    });
    return {
      _id: offer._id,
      title: offer.title,
      titleHi: offer.titleHi,
      description: offer.description,
      descriptionHi: offer.descriptionHi,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      minPurchaseAmount: offer.minPurchaseAmount,
      minQuantity: offer.minQuantity,
      startDate: offer.startDate,
      endDate: offer.endDate,
      products: offerProducts,
    };
  }).filter((o) => o.products.length > 0);

  res.status(200).json({ success: true, count: data.length, data });
};

// @route POST /api/offers
exports.createOffer = async (req, res) => {
  const fields = await offerFields(req.body || {}, null);
  const offer = await Offer.create({
    ...fields,
    createdBy: String(req.user._id),
    createdByName: req.user.name || req.user.username,
    updatedBy: String(req.user._id),
    updatedByName: req.user.name || req.user.username,
  });
  await audit(req, { action: 'OFFER_CREATED', entityType: 'OFFER', entityId: offer._id, entityRef: offer.title, metadata: fields });
  const usage = await usageFor([offer._id]);
  res.status(201).json({ success: true, data: serialize(offer, usage, new Date()) });
};

// @route PUT /api/offers/:id
exports.updateOffer = async (req, res) => {
  const offer = await Offer.findById(requireValidId(req.params.id));
  if (!offer) throw new AppError(404, 'OFFER_NOT_FOUND');
  const before = offer.toObject();
  const fields = await offerFields(req.body || {}, offer);
  Object.assign(offer, fields, { updatedBy: String(req.user._id), updatedByName: req.user.name || req.user.username });
  await offer.save();
  await audit(req, {
    action: 'OFFER_UPDATED',
    entityType: 'OFFER',
    entityId: offer._id,
    entityRef: offer.title,
    metadata: {
      before: { discountType: before.discountType, discountValue: before.discountValue, startDate: before.startDate, endDate: before.endDate, isActive: before.isActive, products: before.products.map(String) },
      after: fields,
    },
  });
  const usage = await usageFor([offer._id]);
  res.status(200).json({ success: true, data: serialize(offer, usage, new Date()) });
};

// @route PATCH /api/offers/:id/status  { isActive }
exports.setOfferStatus = async (req, res) => {
  const offer = await Offer.findById(requireValidId(req.params.id));
  if (!offer) throw new AppError(404, 'OFFER_NOT_FOUND');
  const isActive = (req.body || {}).isActive === true || (req.body || {}).isActive === 'true';
  const from = offer.statusAt();
  offer.isActive = isActive;
  offer.updatedBy = String(req.user._id);
  offer.updatedByName = req.user.name || req.user.username;
  await offer.save();
  await audit(req, {
    action: isActive ? 'OFFER_ACTIVATED' : 'OFFER_DEACTIVATED',
    entityType: 'OFFER',
    entityId: offer._id,
    entityRef: offer.title,
    fromStatus: from,
    toStatus: offer.statusAt(),
  });
  const usage = await usageFor([offer._id]);
  res.status(200).json({ success: true, data: serialize(offer, usage, new Date()) });
};
