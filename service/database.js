// database
const mongoose = require("mongoose");
const dns = require("dns");
require("dotenv").config();

// Force Google DNS for SRV lookups (fixes ECONNREFUSED on some networks)
dns.setServers(["8.8.8.8", "8.8.4.4"]);


// MongoDB Connection
const connectDB = async () => {
   try {

     await mongoose.connect(process.env.MONGODB_URI);
     console.log("MongoDB connected!");

   } catch (error) {

    console.error(error.message);
    process.exit(1);//exit the process
    
   }
}



module.exports = connectDB;