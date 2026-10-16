const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Farmer = require('../models/Farmer');
const CartItem = require('../models/CartItem');

// @desc    Create a new Order with Farmer & Product Verification
// @route   POST /api/orders
exports.createOrder = async (req, res) => {
  try {
    const body = req.body || {};
    const {
      farmerId: reqFarmerId,
      owner_id: reqOwnerId,
      items = [],
      totalAmount,
      taxRate = 0,
      deliveryAddress,
      paymentMethod = 'COD',
      paymentStatus = 'PENDING',
      paymentReference = '',
      trackingNote = '',
    } = body;

    const safeTaxRate = Math.max(0, Number(taxRate) || 0);

    const inputFarmerId = reqFarmerId || (req.user ? req.user._id.toString() : null);
    const inputOwnerId = reqOwnerId || (req.user ? req.user.owner_id : null) || inputFarmerId;

    if (!inputFarmerId && !inputOwnerId) {
      return res.status(400).json({
        success: false,
        message: 'farmerId or owner_id is required',
      });
    }

    if (!deliveryAddress || !items || !items.length) {
      return res.status(400).json({
        success: false,
        message: 'deliveryAddress and at least one item are required',
      });
    }

    // 1. Verify and Match Farmer from Database
    let farmer = null;

    if (inputFarmerId && mongoose.Types.ObjectId.isValid(inputFarmerId)) {
      farmer = await Farmer.findById(inputFarmerId);
    }
    if (!farmer && inputOwnerId) {
      farmer = await Farmer.findOne({ owner_id: inputOwnerId });
    }
    if (!farmer && inputFarmerId) {
      farmer = await Farmer.findOne({ owner_id: inputFarmerId });
    }
    if (!farmer && (inputFarmerId || inputOwnerId)) {
      const searchKey = inputFarmerId || inputOwnerId;
      farmer = await Farmer.findOne({ phoneNumber: searchKey });
    }
    if (!farmer) {
      // Fallback: Get first active farmer or use provided owner_id
      farmer = await Farmer.findOne() || { _id: new mongoose.Types.ObjectId(), owner_id: inputOwnerId || 'farmer_001' };
    }

    const matchedFarmerId = farmer._id ? farmer._id.toString() : (inputFarmerId || 'farmer_001');
    const matchedOwnerId = farmer.owner_id || inputOwnerId || 'farmer_001';

    // 2. Process & Create Single Product Orders
    const createdOrders = [];

    for (const item of items) {
      const { productId, productName, quantity = 1, price = 0, image, productImage } = item;
      let prod = null;

      if (productId && mongoose.Types.ObjectId.isValid(productId)) {
        prod = await Product.findById(productId);
      }

      const qty = Math.max(1, Number(quantity));
      const itemPrice = prod ? Number(prod.price || price || 0) : Number(price || 0);

      if (prod) {
        const availableStock = prod.quantityAvailable !== undefined ? prod.quantityAvailable : (prod.stockQuantity !== undefined ? prod.stockQuantity : 0);
        if (availableStock <= 0 || availableStock < qty) {
          return res.status(400).json({
            success: false,
            message: `Sorry, "${prod.name}" is OUT OF STOCK! Available quantity is ${availableStock}.`
          });
        }

        // Deduct remaining quantityAvailable upon successful order
        const newAvailable = Math.max(0, availableStock - qty);
        prod.quantityAvailable = newAvailable;
        await prod.save();
      }

      const prodImg = prod ? (prod.imageUrls?.[0] || prod.images?.[0] || image || productImage || '') : (image || productImage || '');
      const finalProductName = prod ? prod.name : (productName || item.name || 'Agri Product');
      const itemTotal = Number((itemPrice * qty * (1 + safeTaxRate)).toFixed(2));

      const newOrder = await Order.create({
        owner_id: matchedOwnerId,
        farmerId: matchedFarmerId,
        farmerName: farmer.name || '',
        farmerPhone: farmer.phoneNumber || '',
        status: 'PLACED',
        paymentMethod: paymentMethod || 'COD',
        paymentStatus: paymentStatus || (paymentMethod === 'ONLINE' ? 'PAID' : 'PENDING'),
        paymentReference,
        totalAmount: itemTotal,
        deliveryAddress,
        trackingNote: trackingNote || 'Order placed successfully',
        productId: prod ? prod._id : (productId && mongoose.Types.ObjectId.isValid(productId) ? productId : null),
        productName: finalProductName,
        productImage: prodImg,
        quantity: qty,
        price: itemPrice,
      });

      createdOrders.push(newOrder);
    }

    // 3. Automatically Clear Purchased Items from User's Cart
    try {
      await CartItem.deleteMany({ owner_id: matchedOwnerId });
    } catch (e) {
      // Non-blocking cart clear
    }

    res.status(201).json({
      success: true,
      message: `${createdOrders.length} order(s) created successfully`,
      data: createdOrders.length === 1 ? createdOrders[0] : createdOrders,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get orders (Farmer's orders or all orders for Admin)
// @route   GET /api/orders
exports.getOrders = async (req, res) => {
  try {
    const query = req.query || {};
    const { farmerId, owner_id, status, assignedPartnerId } = query;
    let filter = {};

    // Strict User Isolation for Farmers
    const targetId = owner_id || farmerId || (req.user && req.user.userType === 'farmer' ? (req.user.owner_id || req.user._id?.toString()) : null);

    if (targetId) {
      filter.$or = [
        { farmerId: targetId },
        { owner_id: targetId },
      ];
    }

    if (status) filter.status = status;
    if (assignedPartnerId) filter.assignedPartnerId = assignedPartnerId;

    const orders = await Order.find(filter)
      .populate('productId')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const findOrderById = async (id) => {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    const order = await Order.findById(id).populate('productId');
    if (order) return order;
  }
  return await Order.findOne({ owner_id: id }).populate('productId');
};

// @desc    Get single order details
// @route   GET /api/orders/:id
exports.getOrderById = async (req, res) => {
  try {
    const params = req.params || {};
    const order = await findOrderById(params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update order status / tracking note (Admin / Agent)
// @route   PATCH /api/orders/:id/status
exports.updateOrderStatus = async (req, res) => {
  try {
    const params = req.params || {};
    const body = req.body || {};
    const { status, trackingNote } = body;

    const order = await findOrderById(params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (status) order.status = status;
    if (trackingNote !== undefined) order.trackingNote = trackingNote;

    await order.save();
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update payment status
// @route   PATCH /api/orders/:id/payment
exports.updatePaymentStatus = async (req, res) => {
  try {
    const params = req.params || {};
    const body = req.body || {};
    const { paymentStatus, paymentReference } = body;

    const order = await findOrderById(params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (paymentStatus) order.paymentStatus = paymentStatus;
    if (paymentReference !== undefined) order.paymentReference = paymentReference;

    await order.save();
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Accept order by partner (moves from PLACED/CANCELLED -> SHIPPED)
// @route   PATCH /api/orders/:id/accept
exports.acceptOrder = async (req, res) => {
  try {
    const { partnerId, partnerName, partnerPhone } = req.body || {};
    const order = await findOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (partnerId && mongoose.Types.ObjectId.isValid(partnerId)) {
      const Partner = require('../models/Partner');
      const partnerObj = await Partner.findById(partnerId);
      if (partnerObj && partnerObj.online === false) {
        return res.status(400).json({
          success: false,
          message: 'You are offline! Please go online from your dashboard to accept delivery orders.'
        });
      }
    }

    if (order.status !== 'PLACED' && order.status !== 'CANCELLED') {
      return res.status(400).json({ success: false, message: `Cannot accept order with status '${order.status}'` });
    }

    order.status = 'SHIPPED';
    if (partnerId && mongoose.Types.ObjectId.isValid(partnerId)) {
      order.assignedPartnerId = partnerId;
    }
    if (partnerName) order.assignedPartnerName = partnerName;
    if (partnerPhone) order.assignedPartnerPhone = partnerPhone;
    order.trackingNote = `Accepted by partner ${partnerName || ''}. Order is out for delivery.`.trim();

    await order.save();
    res.status(200).json({ success: true, message: 'Order accepted successfully', data: order });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Cancel delivery by partner (moves status back to PLACED so other partners can accept)
// @route   PATCH /api/orders/:id/cancel-delivery
exports.cancelDelivery = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const order = await findOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.status = 'PLACED';
    order.assignedPartnerId = null;
    order.assignedPartnerName = '';
    order.assignedPartnerPhone = '';
    order.trackingNote = reason ? `Delivery cancelled: ${reason}. Order re-opened for new partners.` : 'Delivery cancelled by partner. Order is re-opened for new partners to accept.';

    await order.save();
    res.status(200).json({ success: true, message: 'Delivery cancelled. Order is now open for other partners to accept.', data: order });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Complete delivery by partner (moves from SHIPPED -> DELIVERED)
// @route   PATCH /api/orders/:id/deliver
exports.completeDelivery = async (req, res) => {
  try {
    const { deliveryProofUrl, deliveryNote, trackingNote, markAsPaid } = req.body || {};
    const order = await findOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.status = 'DELIVERED';
    if (deliveryProofUrl) {
      order.deliveryProofUrl = deliveryProofUrl;
    }
    if (markAsPaid || order.paymentMethod === 'COD') {
      order.paymentStatus = 'PAID';
    }
    order.trackingNote = deliveryNote || trackingNote || 'Order delivered successfully to farmer.';

    await order.save();
    res.status(200).json({ success: true, message: 'Order marked as DELIVERED', data: order });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};


