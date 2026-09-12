const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./config/mongodb");

// Import Route Handlers
const authRoutes = require("./routes/authRoutes");
const farmerRoutes = require("./routes/farmerRoutes");
const adminRoutes = require("./routes/adminRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const farmerVisitRoutes = require("./routes/farmerVisitRoutes");
const partnerRoutes = require("./routes/partnerRoutes");

// App Config
const app = express();
const port = process.env.PORT || 4000;

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

app.set("trust proxy", 1); // REQUIRED behind Caddy
app.use(helmet());
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// Connect Database
connectDB();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Configuration (Native Android sends no Origin header; disable CORS to prevent arbitrary browser cross-origin access)
app.use(cors({ origin: false, credentials: false }));

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Farmer B2C Backend API Running" });
});

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
app.use("/api/reviews", reviewRoutes);
app.use("/api/visits", farmerVisitRoutes);
app.use("/api/partners", partnerRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// Start Server if directly executed
if (require.main === module) {
  app.listen(port, () => {
    console.log(`🚀 Farmer B2C Backend Server running on PORT: ${port}`);
  });
}

module.exports = app;