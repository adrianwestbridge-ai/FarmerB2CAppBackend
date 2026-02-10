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

//App Config
const app = express();
const port = process.env.PORT || 4000;

connectDB();

//Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.SECONDARY_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow server-to-server & Postman
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false); // ❌ don't throw error
      }
    },
    credentials: true,
  })
);


app.set("trust proxy", 1); // REQUIRED for Vercel

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,        // ✅ HTTPS only
      sameSite: "none",    // ✅ cross-domain
      maxAge: 1000 * 60 * 60 * 24,
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

// app.listen(port, () => {
//   console.log(`Server started on PORT : ${port}`);
// });
