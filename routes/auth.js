const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");

const router = express.Router();

// Google login
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);

// Google callback
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/hello" }),
  (req, res) => {
    const token = jwt.sign(
          { id: req.user._id, role: req.user.role },
          process.env.JWT_SECRET,
          { expiresIn: "1d" }
        );
    res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
  },
);

module.exports = router;
