const mongoose =require("mongoose");
const dns = require('dns');

// Force Google DNS for SRV resolution if local DNS fails
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Global variable to hold connection state across serverless invocations
let isConnected = false;

const connectDB = async () => {
    if (isConnected) {
        console.log("=> using existing database connection");
        return;
    }

    try {
        mongoose.connection.on('connected', () => {
            console.log("DB Connected");
        });

        mongoose.connection.on('error', (err) => {
            console.error("DB Connection Error:", err);
        });

        // Force IPv4 (family: 4) to resolve local DNS/SRV issues on some networks
        const db = await mongoose.connect(`${process.env.MONGODB_URI}/thetechtimes`, {
            family: 4
        });
        
        isConnected = db.connections[0].readyState === 1;
    } catch (error) {
        console.error("Failed to connect to MongoDB:", error.message);
        // Don't exit here, let the server handle it or retry
    }
}

module.exports = connectDB;
