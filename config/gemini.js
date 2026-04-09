const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const textModel = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

const embeddingModel = genAI.getGenerativeModel({
  model: "text-embedding-004",
});

module.exports = { textModel, embeddingModel };