const express = require("express");
const cors = require("cors");
require("dotenv").config(); // instead of import "dotenv/config"
const connectDB = require("./config/mongodb");
const newsRoutes = require("./routes/newsRoutes.js");
const categoryRoutes = require("./routes/categoryRoutes.js");
const tagRoutes = require("./routes/tagRoutes.js");
const userRoutes = require("./routes/usersRoutes");

//App Config
const app = express();
const port = process.env.PORT || 4000;

connectDB();

//Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

//api endpoints
app.use("/api/categories", categoryRoutes);
app.use("/api/news",newsRoutes );
app.use("/api/tags", tagRoutes);
app.use("/api/users", userRoutes);


app.get("/", (req, res) => {
  res.send("API Working");
});

app.listen(port, () => {
  console.log(`Server started on PORT : ${port}`);
});
