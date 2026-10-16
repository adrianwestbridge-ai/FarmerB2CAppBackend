const jwt = require("jsonwebtoken");
const Farmer = require("../models/Farmer");
const Admin = require("../models/Admin");
const Partner = require("../models/Partner");

/**
 * Protect routes (JWT token required)
 */
const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, token missing",
      });
    }

    // Verify token
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not set");
    const decoded = jwt.verify(token, secret);

    // Try finding user across Farmer, Admin, Partner models based on role or id
    let user = null;
    if (decoded.role === "ADMIN" || decoded.role === "SUPER_ADMIN" || decoded.userType === "admin") {
      user = await Admin.findById(decoded.id).select("-password");
      if (user) user.userType = "admin";
    } else if (decoded.userType === "partner") {
      user = await Partner.findById(decoded.id).select("-password");
      if (user) user.userType = "partner";
    } else {
      // Default to Farmer or general lookup
      user = await Farmer.findById(decoded.id).select("-password");
      if (user) {
        user.userType = "farmer";
      } else {
        user = await Admin.findById(decoded.id).select("-password");
        if (user) {
          user.userType = "admin";
        } else {
          user = await Partner.findById(decoded.id).select("-password");
          if (user) user.userType = "partner";
        }
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found or account inactive",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized, token invalid or expired",
    });
  }
};

/**
 * Admin only access
 */
const adminOnly = (req, res, next) => {
  if (
    req.user &&
    (req.user.userType === "admin" ||
      ["SUPER_ADMIN", "ADMIN", "MODERATOR"].includes(req.user.role))
  ) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Admin access only",
    });
  }
};

/**
 * Super Admin only access
 */
const superAdminOnly = (req, res, next) => {
  if (req.user && req.user.role === "SUPER_ADMIN") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Only the Super Admin can perform this action",
    });
  }
};

/**
 * Farmer only access
 */
const farmerOnly = (req, res, next) => {
  if (req.user && req.user.userType === "farmer") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Farmer access required",
    });
  }
};

/**
 * Partner/Agent only access
 */
const partnerOnly = (req, res, next) => {
  if (req.user && req.user.userType === "partner") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Partner access required",
    });
  }
};

module.exports = {
  protect,
  adminOnly,
  superAdminOnly,
  farmerOnly,
  partnerOnly,
};
