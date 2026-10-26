const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./config/mongodb");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { t, AppError } = require("./utils/i18n");
const { audit } = require("./utils/audit");

// Import Route Handlers
const authRoutes = require("./routes/authRoutes");
const farmerRoutes = require("./routes/farmerRoutes");
const adminRoutes = require("./routes/adminRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const offerRoutes = require("./routes/offerRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const farmerVisitRoutes = require("./routes/farmerVisitRoutes");
const partnerRoutes = require("./routes/partnerRoutes");
const settlementRoutes = require("./routes/settlementRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const reportRoutes = require("./routes/reportRoutes");
const passwordResetRoutes = require("./routes/passwordResetRoutes");
const legalRoutes = require("./routes/legalRoutes");

// App Config
const app = express();
const port = process.env.PORT || 4000;

app.set("trust proxy", 1); // REQUIRED behind Caddy
app.use(helmet());
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT || 1000),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, code: "TOO_MANY_REQUESTS", message: t(req, "TOO_MANY_REQUESTS") }),
}));

// Connect Database
if (require.main === module) connectDB();

// Middlewares
// Allows compressed inline photos (product images, proof of delivery).
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// CORS Configuration (Native Android sends no Origin header; disable CORS to prevent arbitrary browser cross-origin access)
app.use(cors({ origin: false, credentials: false }));

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Farmer B2C Backend API Running" });
});

// Privacy policy and account-deletion pages for the Play Store listing.
app.use("/", legalRoutes);

app.get("/", (req, res) => {
  res.send("Farmer B2C Backend API Working");
});

// API Routes Mounting
app.use("/api/auth", authRoutes);
app.use("/api/farmers", farmerRoutes);
app.use("/api/admins", adminRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/visits", farmerVisitRoutes);
app.use("/api/partners", partnerRoutes);
app.use("/api/settlements", settlementRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/password-resets", passwordResetRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ success: false, code: "NOT_FOUND", message: t(req, "NOT_FOUND") });
});

// Global Error Handler — responses are localized and never expose internal details.
// eslint-disable-next-line no-unused-vars
app.use(async (err, req, res, next) => {
  if (err instanceof AppError) {
    if (err.status === 403) {
      await audit(req, { action: "ACCESS_DENIED", entityType: "AUTH", reason: `${req.method} ${req.originalUrl}`, metadata: { code: err.key } });
    }
    return res.status(err.status).json({ success: false, code: err.key, message: t(req, err.key, err.params) });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, code: "VALIDATION_FAILED", message: t(req, "VALIDATION_FAILED") });
  }
  if (err && (err.name === "ValidationError" || err.name === "CastError")) {
    return res.status(400).json({ success: false, code: "VALIDATION_FAILED", message: t(req, "VALIDATION_FAILED") });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ success: false, code: "VALIDATION_FAILED", message: t(req, "VALIDATION_FAILED") });
  }
  console.error("❌ Unhandled Error:", err && err.stack ? err.stack : err);
  await audit(req, { action: "SERVER_ERROR", entityType: "SYSTEM", reason: `${req.method} ${req.originalUrl}`, metadata: { message: err && err.message } });
  return res.status(500).json({ success: false, code: "SERVER_ERROR", message: t(req, "SERVER_ERROR") });
});

// Start Server if directly executed
if (require.main === module) {
  app.listen(port, () => {
    console.log(`🚀 Farmer B2C Backend Server running on PORT: ${port}`);
  });
}

module.exports = app;
