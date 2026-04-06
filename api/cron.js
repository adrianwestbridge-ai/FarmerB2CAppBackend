module.exports = async function (req, res) {
  try {
    console.log("Cron job triggered at:", new Date().toISOString());

    // ✅ Your DB logic here
    // await connectDB();
    // await User.updateMany(...);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Cron Error:", err);
    return res.status(500).json({ error: err.message });
  }
};