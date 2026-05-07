const mongoose = require("mongoose");

const newsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    summary: {
      type: String,
      required: true,
      maxlength: 500,
    },

    content: {
      type: String, // HTML or Markdown
      required: true,
    },

    image: {
      type: String,
      default: "",
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tag",
      },
    ],

    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    status: {
      type: String,
      enum: ["draft","pending","published", "archived"],
      default: "pending",
      index: true,
    },

    isBreaking: {
      type: Boolean,
      default: false,
    },

    views: {
      type: Number,
      default: 0,
    },

    likesCount: {
      type: Number,
      default: 0,
    },

    commentsCount: {
      type: Number,
      default: 0,
    },

    publishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt & updatedAt
  }
);

newsSchema.index({ status: 1, publishedAt: -1, createdAt: -1 });

module.exports = mongoose.model("News", newsSchema);