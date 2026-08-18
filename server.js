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

// Connect Database
connectDB();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.SECONDARY_URL,
  process.env.THIRD_URL,
  process.env.FORTH_URL,
  process.env.FIFTH_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests / Postman / Mobile Apps
      if (!origin) {
        return callback(null, true);
      }

      // Allow localhost
      if (origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("10.0.2.2")) {
        return callback(null, true);
      }

      // Allow Vercel preview deployments
      if (origin.includes(".vercel.app")) {
        return callback(null, true);
      }

      // Allow configured domains
      const allowed = allowedOrigins.some((allowedOrigin) =>
        origin.startsWith(allowedOrigin)
      );

      if (allowed) {
        return callback(null, true);
      }

      return callback(null, true); // Fallback allow for React Native mobile API calls
    },
    credentials: true,
  })
);

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