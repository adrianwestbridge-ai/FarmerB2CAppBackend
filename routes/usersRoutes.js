const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/authMiddleware");

const {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  blockUser,
  unblockUser,
  deleteUser,
  registerUser,
  loginUser,
  adminLogin,
} = require("../controllers/userController.js");

router.get("/me", protect, (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
});

router.post("/register", registerUser);

router.post("/login", loginUser);

router.post("/admin", adminLogin);

// CREATE okkk
router.post("/", createUser);

// READ okkk
router.get("/", getAllUsers);
router.get("/:id", getUserById);

// UPDATE okkk
router.put("/:id", updateUser);
router.patch("/:id/block", blockUser);
router.patch("/:id/unblock", unblockUser);

// DELETE okkk
router.delete("/:id", deleteUser);

module.exports = router;
