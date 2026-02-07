// middleware/authMiddleware.js

const User = require("../models/User");
const jwt = require("jsonwebtoken");

/**
 * Protect routes (JWT required)
 */
const protect = async (req, res, next) => {
  try {
    let token;

    // Check Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
      // console.log(token);
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, token missing",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from token
    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized, token invalid",
    });
  }
};

/**
 * Admin only access
 */
const adminOnly = (req, res, next) => {
    next();
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Admin access only",
    });
  }
};

/**
 * Admin or Editor access
 */
const adminOrEditor = (req, res, next) => {
  if (req.user && ["admin", "editor"].includes(req.user.role)) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Admin or Editor access required",
    });
  }
};

/**
 * Admin, Editor, or Author access
 */
const adminEditorAuthor = (req, res, next) => {
  if (req.user && ["admin", "editor", "author"].includes(req.user.role)) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Permission denied",
    });
  }
};

// Export all middleware functions (CommonJS)
module.exports = {
  protect,
  adminOnly,
  adminOrEditor,
  adminEditorAuthor,
};
