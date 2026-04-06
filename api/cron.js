import connectDB from "../config/mongodb";
import News from "../models/news";

export default async function handler(req, res) {
  try {
    await connectDB();

    console.log("Cron job started");

    // Example: publish scheduled news
    // const result = await News.updateMany(
    //   {
    //     isPublished: false,
    //     publishAt: { $lte: new Date() }
    //   },
    //   {
    //     $set: { isPublished: true }
    //   }
    // );

    // console.log("Updated:", result.modifiedCount);

    res.status(200).json({
      success: true,
      updated: result.modifiedCount
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Cron failed" });
  }
}