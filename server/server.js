import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression'; 
import passport from 'passport';
import session from 'express-session';
import { app, server } from './socket/socket.js'; 
import cron from 'node-cron';
import { cleanupUnverifiedUsers } from './utils/cronJobs.js';

import connectDB from './config/db.js';
import './config/passport.setup.js'; 

import { ApiError } from './utils/ApiError.js';

import userRouter from './routes/user.routes.js';
import skillRouter from './routes/skill.routes.js';
import proposalRouter from './routes/proposal.routes.js';
import messageRouter from './routes/message.routes.js';
import authRouter from './routes/auth.routes.js'; 
import feedbackRouter from './routes/feedback.routes.js';
import pushRouter from './routes/push.routes.js';
import rewardRouter from './routes/reward.routes.js';
import reputationRouter from './routes/reputation.routes.js';
import chatRequestRouter from './routes/chatRequest.routes.js';
import notificationRouter from './routes/notification.routes.js';
import teamRouter from './routes/team.routes.js';
import adminRouter from './routes/admin.routes.js';


dotenv.config({ path: './.env' });

const PORT = process.env.PORT || 8000;

connectDB();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : [];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg));
    }
    return callback(null, true);
  },
  credentials: true,
}));

app.set('trust proxy', 1);

app.use(session({
    secret: process.env.SESSION_SECRET || 'a_default_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
    }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(compression()); 
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(cookieParser());

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/skills', skillRouter);
app.use('/api/v1/proposals', proposalRouter);
app.use('/api/v1/messages', messageRouter);
app.use('/api/v1/feedback', feedbackRouter);
app.use('/api/v1/push', pushRouter);
app.use('/api/v1/rewards', rewardRouter);
app.use('/api/v1/reputation', reputationRouter);
app.use('/api/v1/chat-requests', chatRequestRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/teams', teamRouter);
app.use('/api/v1/admin', adminRouter);

app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: err.success,
      message: err.message,
      errors: err.errors,
    });
  }
  console.error(err);
  return res.status(500).json({
    success: false,
    message: 'Internal Server Error',
  });
});

cron.schedule('0 22 * * *', cleanupUnverifiedUsers);

server.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
