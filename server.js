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
  process.env.THIRD_URL,
].filter(Boolean);

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
  }),
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
      sameSite: "lax", //diffrent front and backend
    },
  }),
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/tags", tagRoutes);
app.use("/api/users", userRoutes);

app.get("/api/cron", async (req, res) => {
  //  try {
  //   if (req.query.secret !== process.env.CRON_SECRET) {
  //     return res.status(403).json({ error: "Unauthorized" });
  //   }

  //   console.log("Cron job triggered");

  //   const model = genAI.getGenerativeModel({
  //     model: "gemini-1.5-flash"
  //   });

  //   const embeddingModel = genAI.getGenerativeModel({
  //     model: "text-embedding-004"
  //   });

  //   // 👉 Prompt to generate 5 news articles
  //   const prompt = `
  //   Generate 5 latest tech news articles in JSON format.
  //   Each article must include:
  //   title, slug, summary, content (HTML), image URL, category, tags.

  //   Keep it realistic like tech news website.
  //   `;

  //   const result = await model.generateContent(prompt);
  //   const text = result.response.text();

  //   const articles = JSON.parse(text); // Ensure Gemini returns valid JSON

  //   const savedDocs = [];

  //   for (let article of articles) {
  //     // 👉 Create embedding from title + summary
  //     const embeddingRes = await embeddingModel.embedContent({
  //       content: {
  //         parts: [
  //           { text: article.title + " " + article.summary }
  //         ]
  //       }
  //     });

  //     const embedding = embeddingRes.embedding.values;

  //     Console.log(article)

  //     // const doc = await News.create({
  //     //   title: article.title,
  //     //   slug: article.slug,
  //     //   summary: article.summary,
  //     //   content: article.content,
  //     //   image: article.image,

  //     //   // 👉 Use your existing category + author IDs
  //     //   category: new mongoose.Types.ObjectId("69763d68c2960c8d8f5323f8"), // Gadgets :contentReference[oaicite:0]{index=0}
  //     //   author: new mongoose.Types.ObjectId("69763dc1c2960c8d8f532403"),   // Admin :contentReference[oaicite:1]{index=1}

  //     //   tags: ["AI"],

  //     //   status: "published",
  //     //   isBreaking: true,

  //     //   embedding: embedding, // 🔥 IMPORTANT

  //     //   views: 0,
  //     //   likesCount: 0,
  //     //   commentsCount: 0,
  //     //   publishedAt: new Date()
  //     // });

  //     // savedDocs.push(doc);

  //   }

  //   res.status(200).json({
  //     success: true,
  //     // count: savedDocs.length,
  //     // data: savedDocs
  //   });

  // }
  //  catch (error) {
  //   console.error(error);
  //   res.status(500).json({ error: "Cron failed" });
  // }
});

app.get("/", (req, res) => {
  res.send("API Working");
});

app.listen(port, () => {
  console.log(`Server started on PORT : ${port}`);
});
