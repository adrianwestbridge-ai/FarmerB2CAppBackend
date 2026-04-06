const express = require("express");
const cors = require("cors");
require("dotenv").config(); // instead of import "dotenv/config"
const connectDB = require("./config/mongodb");
const newsRoutes = require("./routes/newsRoutes.js");
const categoryRoutes = require("./routes/categoryRoutes.js");
const tagRoutes = require("./routes/tagRoutes.js");
const userRoutes = require("./routes/usersRoutes");
const authRoutes = require("./routes/auth");
const passport = require("passport");
const session = require("express-session");
require("./config/passport"); // just require it, no variable needed
const cron = require("node-cron");
const mongoose = require("mongoose");
const User = require("./models/User");

//App Config
const app = express();
const port = process.env.PORT || 4000;

connectDB();

//Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const allowedOrigins = [process.env.FRONTEND_URL, process.env.SECONDARY_URL, process.env.Third_URL].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);


// Session (required for passport-google-oauth)
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // true only in HTTPS
      maxAge: 1000 * 60 * 60 * 24, // 1 day
      sameSite: "lax",//diffrent front and backend
    },
  })
);


// Passport
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/news",newsRoutes );
app.use("/api/tags", tagRoutes);
app.use("/api/users", userRoutes);


app.get("/", (req, res) => {
  res.send("API Working");
});

// Run at specific time (e.g., every day at 11:59 PM)
cron.schedule("30 14 * * *", async () => {
  console.log("Running MongoDB query at 2:25 PM");

  const users = await User.find({ isActive: true });
  console.log(users);

//   * * * * *
// | | | | |
// | | | | └ day of week (0-7)
// | | | └── month
// | | └──── day of month
// | └────── hour
// └──────── minute
});


app.listen(port, () => {
  console.log(`Server started on PORT : ${port}`);
});
