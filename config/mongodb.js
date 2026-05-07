const mongoose =require("mongoose");
const dns = require('dns');

// Force Google DNS for SRV resolution if local DNS fails
dns.setServers(['8.8.8.8', '8.8.4.4']);

const connectDB = async () => {
    try {
        mongoose.connection.on('connected', () => {
            console.log("DB Connected");
        });

        mongoose.connection.on('error', (err) => {
            console.error("DB Connection Error:", err);
        });

        // Force IPv4 (family: 4) to resolve local DNS/SRV issues on some networks
        await mongoose.connect(`${process.env.MONGODB_URI}/thetechtimes`, {
            family: 4
        });
    } catch (error) {
        console.error("Failed to connect to MongoDB:", error.message);
        // Don't exit here, let the server handle it or retry
    }
}

module.exports = connectDB;
