const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;

        // 1️⃣ Already linked Google user
        let user = await User.findOne({ googleId: profile.id });
        if (user) return done(null, user);

        // 2️⃣ Password user exists → LINK Google
        user = await User.findOne({ email });
        if (user) {
          user.googleId = profile.id;
          user.avatar = profile.photos?.[0]?.value || user.avatar;
          user.isVerified = true;

          await user.save();
          return done(null, user);
        }

        // 3️⃣ New Google user
        user = await User.create({
          googleId: profile.id,
          name: profile.displayName,
          email,
          avatar: profile.photos?.[0]?.value,
          role: "user",
          bio: "",
          status: "active",
          isVerified: true,
        });

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// Session handling
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
