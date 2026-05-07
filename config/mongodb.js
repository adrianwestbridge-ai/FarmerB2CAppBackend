const mongoose = require("mongoose");
const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = {
    conn: null,
    promise: null,
  };
}

const connectDB = async () => {
  if (cached.conn) {
    return cached.conn;
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

    if (!cached.promise) {
      cached.promise = mongoose.connect(process.env.MONGODB_URI, {
        dbName: "thetechtimes",

        family: 4,

        maxPoolSize: 10,
        minPoolSize: 5,

        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
    }

    cached.conn = await cached.promise;

    return cached.conn;

  } catch (error) {
    cached.promise = null;

    console.log("❌ Connection Failed:", error.message);

    throw error;
  }
};

module.exports = connectDB;