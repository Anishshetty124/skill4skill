import { Router } from 'express';
import passport from 'passport';

const router = Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL}/login`,
    session: false,
  }),
  (req, res) => {
    const user = req.user;
    const accessToken = user.generateAccessToken();
    res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${accessToken}`);
  }
);

export default router;
