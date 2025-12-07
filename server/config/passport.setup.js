import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/user.model.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/api/v1/auth/google/callback',
      scope: ['profile', 'email'],
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
       
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          
          return done(null, user);
        }

      
        user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
         
          user.googleId = profile.id;
          user.profilePicture = user.profilePicture || profile.photos[0].value; 
          user.isVerified = true; 
          await user.save();
          return done(null, user);
        }

     
        const newUser = await User.create({
          googleId: profile.id,
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          email: profile.emails[0].value,
          username: profile.emails[0].value.split('@')[0] + Math.floor(Math.random() * 1000), 
          profilePicture: profile.photos[0].value,
          isVerified: true, 
        });

        return done(null, newUser);

      } catch (error) {
        return done(error, null);
      }
    }
  )
);
