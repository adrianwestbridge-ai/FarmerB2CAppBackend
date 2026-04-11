const express = require("express");
const cors = require("cors");
require("dotenv").config(); // instead of import "dotenv/config"
const connectDB = require("./config/mongodb");
const newsRoutes = require("./routes/newsRoutes.js");
const categoryRoutes = require("./routes/categoryRoutes.js");
const calendarRoutes = require("./routes/calendarRoutes");
const tagRoutes = require("./routes/tagRoutes.js");
const userRoutes = require("./routes/usersRoutes");
const authRoutes = require("./routes/auth");
const passport = require("passport");
const session = require("express-session");

require("./config/passport"); // just require it, no variable needed

const { GoogleGenerativeAI } = require("@google/generative-ai");
const News = require("./models/News");
const Category = require("./models/Category");
const Tag = require("./models/Tag");
const User = require("./models/User");
const slugify = require("slugify");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
//App Config
const app = express();
const port = process.env.PORT || 4000;
connectDB().catch((err) => {
  console.error("Database connection failed during startup:", err.message);
});

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
app.use("/api/calendar", calendarRoutes);

app.get("/api/cron", async (req, res) => {
  try {
    if (req.query.secret !== process.env.CRON_SECRET) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    console.log("Cron job triggered");

    // 1. Fetch Admin User
    const adminUser = await User.findOne({ role: "admin" });
    if (!adminUser) {
      return res.status(500).json({ error: "No admin user found" });
    }

    // 2. Fetch Categories and Tags
    const categories = await Category.find({ isActive: true });
    const tags = await Tag.find();

    if (categories.length === 0) {
      return res.status(500).json({ error: "No categories found" });
    }

    const categoryNames = categories.map((c) => c.name).join(", ");
    const tagNames = tags.map((t) => t.name).join(", ");

    // 3. Initialize Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    // 4. Prompt to generate 5 news articles
    const prompt = `
    Generate 5 latest tech news articles in JSON format.
    Return ONLY a JSON array of objects.
    Avoid repeating previous topics.

    Current time: ${new Date().toISOString()}

Focus on:
-Tech
-Jobs
-India
-World
-Sport
-Data
-Health
-Opinion
-Science
-Business
- AI
- Startups
- Gadgets
- Cybersecurity
- Trending technologies

    Each object MUST have:
    - title: string
    - summary: string (max 500 chars)
    - content: string (detailed HTML content)
    - image: string (placeholder image URL from Unsplash: https://images.unsplash.com/photo-...)
    - categoryName: string (MUST be one of: [${categoryNames}])
    - tagNames: array of strings (choose relevant ones from: [${tagNames}])

    Keep it realistic like a premium tech news website.
    Example JSON:
    [
      {
        "title": "Example Title",
        "summary": "Short summary...",
        "content": "<p>Full content...</p>",
        "image": "https://images.unsplash.com...",
        "categoryName": "Gadgets",
        "tagNames": ["AI", "Apple"]
      }
    ]
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // Clean up text if Gemini adds markdown code blocks
    text = text.replace(/```json|```/g, "").trim();

    let articles;
    try {
      articles = JSON.parse(text);
    } catch (parseError) {
      console.error("Failed to parse Gemini response:", text);
      return res.status(500).json({ error: "Invalid JSON from AI" });
    }

    const savedDocs = [];

    for (const articleData of articles) {
      // Find Category ID
      const category =
        categories.find((c) => c.name === articleData.categoryName) ||
        categories[0];

      // Find Tag IDs
      const tagIds = (articleData.tagNames || [])
        .map((tn) => tags.find((t) => t.name === tn)?._id)
        .filter((id) => id);

      // Generate UNIQUE Slug
      let slug = slugify(articleData.title, { lower: true, strict: true });
      const existingNews = await News.findOne({ slug });
      if (existingNews) {
        slug = `${slug}-${Date.now()}`;
      }

      const newsDoc = new News({
        title: articleData.title,
        slug: slug,
        summary: articleData.summary,
        content: articleData.content,
        image: articleData.image,
        category: category._id,
        tags: tagIds,
        author: adminUser._id,
        status: "published",
        isBreaking: Math.random() > 0.8, // 20% chance to be breaking news
        publishedAt: new Date(),
        views: 0,
        likesCount: 0,
        commentsCount: 0,
      });

      await newsDoc.save();
      savedDocs.push(newsDoc);
    }

    res.status(200).json({
      success: true,
      count: savedDocs.length,
      message: "News generated and saved successfully",
    });
  } catch (error) {
    console.error("Cron Error:", error);
    res
      .status(500)
      .json({ error: "Cron execution failed", details: error.message });
  }
});

app.get("/", (req, res) => {
  res.send("API Working");
});

app.listen(port, () => {
  console.log(`Server started on PORT : ${port}`);
});
