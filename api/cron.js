module.exports = async (req, res) => {
  try {
    console.log("Cron triggered at:", new Date().toISOString());

    // ✅ Your MongoDB logic here
    // await connectDB();
    // await User.updateMany(...);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Cron Error:", err);
    res.status(500).json({ error: err.message });
  }
};