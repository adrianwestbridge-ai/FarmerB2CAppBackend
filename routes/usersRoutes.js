const express = require("express");
const router = express.Router();

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
