import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/user.model.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // ▼▼▼ KEY FIX: Hardcode the production URL to ensure HTTPS is used ▼▼▼
      callbackURL: process.env.NODE_ENV === 'production' 
        ? 'https://skillswap-production-32b3.up.railway.app/api/v1/auth/google/callback' 
        : '/api/v1/auth/google/callback',
      scope: ['profile', 'email'],
      proxy: true, 
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // 1. Check if user exists by Google ID
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          return done(null, user);
        }

        // 2. Check if user exists by Email (linking accounts)
        user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
          user.googleId = profile.id;
          user.profilePicture = user.profilePicture || profile.photos[0].value;
          user.isVerified = true;
          await user.save();
          return done(null, user);
        }

        // 3. Create new user
        const newUser = await User.create({
          googleId: profile.id,
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          email: profile.emails[0].value,
          // Generate unique username
          username: profile.emails[0].value.split('@')[0] + Math.floor(Math.random() * 1000),
          profilePicture: profile.photos[0].value,
          isVerified: true,
        });

        return done(null, newUser);

      } catch (error) {
        // Log the error to see it in Railway logs if it happens
        console.error("🔥 GOOGLE AUTH STRATEGY ERROR:", error); 
        return done(error, null);
      }
    }
  )
);

// ▼▼▼ SERIALIZATION (Required to fix 500 Error) ▼▼▼

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    console.error("🔥 DESERIALIZE ERROR:", error);
    done(error, null);
  }
});
