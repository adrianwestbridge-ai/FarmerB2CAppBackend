// const mongoose =require("mongoose");
// const dns = require('dns');

// // Force Google DNS for SRV resolution if local DNS fails
// dns.setServers(['8.8.8.8', '8.8.4.4']);

// const connectDB = async () => {
//     try {
//         mongoose.connection.on('connected', () => {
//             console.log("DB Connected");
//         });

//         mongoose.connection.on('error', (err) => {
//             console.error("DB Connection Error:", err);
//         });

//         // Force IPv4 (family: 4) to resolve local DNS/SRV issues on some networks
//         await mongoose.connect(`${process.env.MONGODB_URI}/thetechtimes`, {
//             family: 4
//         });
//     } catch (error) {
//         console.error("Failed to connect to MongoDB:", error.message);
//         // Don't exit here, let the server handle it or retry
//     }
// }

// module.exports = connectDB;
const mongoose = require("mongoose");

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = {
    conn: null,
    promise: null,
  };
}

const connectDB = async () => {
  try {
    // Return existing connection
    if (cached.conn) {
      return cached.conn;
    }

    // Create new connection promise if not exists
    if (!cached.promise) {
      cached.promise = mongoose.connect(
        `${process.env.MONGODB_URI}/thetechtimes`,
        {
          bufferCommands: false,
          family: 4,
        }
      );
    }

    cached.conn = await cached.promise;

    console.log("✅ MongoDB Connected");

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB Error:", err);
    });

    return cached.conn;

  } catch (error) {
    console.error("❌ MongoDB Connection Failed:", error);

    throw error;
  }
};

module.exports = connectDB;