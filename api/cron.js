export default async function handler(req, res) {
  console.log("Cron job triggered");
  res.status(200).json({ success: true });
}