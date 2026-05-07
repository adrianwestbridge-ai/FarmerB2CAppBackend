const mongoose = require("mongoose");
const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    return;
  }

  try {
    mongoose.connection.on("connected", () => {
      console.log("✅ MongoDB Connected");
    });

    mongoose.connection.on("error", (err) => {
      console.log("❌ MongoDB Error:", err.message);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("⚠️ MongoDB Disconnected");
    });

    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: "thetechtimes",
      family: 4,
    });

    isConnected = true;

  } catch (error) {
    console.log("❌ Connection Failed:", error.message);
  }
};

module.exports = connectDB;