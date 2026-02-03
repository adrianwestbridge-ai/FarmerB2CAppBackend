const mongoose =require("mongoose");

const connectDB = async()=>{
    mongoose.connection.on('connected',()=>{
        console.log("DB Connected")
    })

    await mongoose.connect(`${process.env.MONGODB_URI}/thetechtimes`)

}

module.exports = connectDB;
