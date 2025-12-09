import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { User } from '../models/user.model.js';
import { Skill } from '../models/skill.model.js';
import { calculateUserStats } from '../utils/BadgeManager.js';
// CHANGE 1: Swapped SendGrid for Resend
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';
import opencage from 'opencage-api-client';
import { Proposal } from '../models/proposal.model.js';
import { Conversation } from '../models/conversation.model.js';
import { ChatRequest } from '../models/chatRequest.model.js';

// CHANGE 2: Initialize Resend with your API Key
const resend = new Resend(process.env.RESEND_API_KEY);

// --- 1. REGISTER USER (Updated Email Logic) ---
const registerUser = asyncHandler(async (req, res) => {
    const { firstName, lastName, username, email, password } = req.body;

    if ([firstName, lastName, username, email, password].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }
    
    if (password.length < 8) throw new ApiError(400, "Password must be at least 8 characters long.");
    if (!/[a-z]/.test(password)) throw new ApiError(400, "Password must contain at least one lowercase letter.");
    if (!/[A-Z]/.test(password)) throw new ApiError(400, "Password must contain at least one uppercase letter.");
    if (!/\d/.test(password)) throw new ApiError(400, "Password must contain at least one number.");
    if (!/[@$!%*?&]/.test(password)) throw new ApiError(400, "Password must contain at least one special character (@$!%*?&).");

    const existedUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existedUser) {
        throw new ApiError(409, "User with this email or username already exists");
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const user = await User.create({
        firstName,
        lastName,
        username: username.toLowerCase(),
        email,
        password,
        verificationOtp: otp,
        verificationOtpExpiry: otpExpiry,
    });

    const msg = {
        to: user.email,
        // IMPORTANT: Use 'onboarding@resend.dev' until you verify your custom domain
        from: 'onboarding@resend.dev',
        subject: 'Your skill4skill Verification Code',
        html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
                <h2>Welcome to skill4skill!</h2>
                <p>Your verification code is:</p>
                <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; background: #f0f0f0; padding: 10px; border-radius: 5px;">${otp}</p>
                <p style="font-size: 12px; color: #777;">This code will expire in 10 minutes.</p>
            </div>
        `,
    };

    try {
        await resend.emails.send(msg);
    } catch (error) {
        console.error("Resend Error (Register):", error);
        // Note: I kept your logic to delete user if email fails, 
        // but now that Resend is reliable, you might not need to be this harsh.
        await User.findByIdAndDelete(user._id); 
        throw new ApiError(500, "Could not send verification email. Please try again later.");
    }

    return res.status(201).json(new ApiResponse(201, { email: user.email }, "Verification OTP sent to your email."));
});

// --- NO CHANGES TO LOGIN/LOGOUT ---
const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new ApiError(400, "Username/email and password are required");
    }

    const user = await User.findOne({ $or: [{ email }, { username: email }] }).select("+password");
    if (!user) {
        throw new ApiError(404, "User does not exist");
    }

    if (!user.isVerified) {
        throw new ApiError(403, "Please verify your email before logging in.");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user credentials");
    }
    
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();
    
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");
    
    const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production' };
    
    return res
        .status(200)
        .cookie("refreshToken", refreshToken, options)
        .cookie("accessToken", accessToken, options)
        .json(
            new ApiResponse(
                200,
                { user: loggedInUser, accessToken },
                "User logged in successfully"
            )
        );
});

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.user._id, { $set: { refreshToken: undefined } }, { new: true });
    const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production' };
    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options).json(new ApiResponse(200, {}, "User logged out successfully"));
});

// --- 2. FORGOT PASSWORD (Updated Email Logic) ---
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) {
        throw new ApiError(400, "Email is required.");
    }

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(200).json(new ApiResponse(200, {}, "If an account with this email exists, a password reset OTP has been sent."));
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    user.passwordResetOtp = otp;
    user.passwordResetOtpExpiry = otpExpiry;
    await user.save({ validateBeforeSave: false });

    const msg = {
        to: user.email,
        from: 'onboarding@resend.dev', // Changed to Resend Test Email
        subject: 'Your skill4skill Password Reset Code',
        html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
                <h2>Password Reset Request</h2>
                <p>Your password reset code is:</p>
                <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; background: #f0f0f0; padding: 10px; border-radius: 5px;">${otp}</p>
                <p style="font-size: 12px; color: #777;">This code will expire in 10 minutes.</p>
            </div>
        `,
    };

    try {
        await resend.emails.send(msg);
        return res.status(200).json(new ApiResponse(200, { email: user.email }, "Password reset OTP sent to your email."));
    } catch (error) {
        console.error("Resend Error (Forgot Password):", error);
        throw new ApiError(500, "Could not send password reset email. Please try again later.");
    }
});

// --- NO CHANGES TO RESET PASSWORD ---
const resetPassword = asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
        throw new ApiError(400, "Email, OTP, and new password are required.");
    }

    if (newPassword.length < 8) throw new ApiError(400, "Password must be at least 8 characters long.");
    if (!/[a-z]/.test(newPassword)) throw new ApiError(400, "Password must contain at least one lowercase letter.");
    if (!/[A-Z]/.test(newPassword)) throw new ApiError(400, "Password must contain at least one uppercase letter.");
    if (!/\d/.test(newPassword)) throw new ApiError(400, "Password must contain at least one number.");
    if (!/[@$!%*?&]/.test(newPassword)) throw new ApiError(400, "Password must contain at least one special character (@$!%*?&).");

    const user = await User.findOne({
        email,
        passwordResetOtp: otp,
        passwordResetOtpExpiry: { $gt: Date.now() }
    }).select("+password");

    if (!user) {
        throw new ApiError(400, "Invalid OTP or OTP has expired.");
    }

    const isSamePassword = await user.isPasswordCorrect(newPassword);
    if (isSamePassword) {
        throw new ApiError(400, "Your new password cannot be the same as your old password.");
    }

    user.password = newPassword;
    user.passwordResetOtp = undefined;
    user.passwordResetOtpExpiry = undefined;
    await user.save();

    return res.status(200).json(new ApiResponse(200, {}, "Password has been reset successfully. You can now log in."));
});

// --- 3. REQUEST EMAIL CHANGE (Updated Email Logic) ---
const requestEmailChange = asyncHandler(async (req, res) => {
    const { newEmail } = req.body;
    const userId = req.user._id;
    if (!newEmail) throw new ApiError(400, "New email is required.");
    const existingUser = await User.findOne({ email: newEmail });
    if (existingUser) throw new ApiError(409, "This email is already in use.");
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.newEmail = newEmail;
    user.emailChangeOtp = otp;
    user.emailChangeOtpExpiry = otpExpiry;
    await user.save({ validateBeforeSave: false });
    
    const msg = { 
        to: newEmail, 
        from: 'onboarding@resend.dev', // Changed to Resend Test Email
        subject: 'Verify Your New Email for skill4skill', 
        html: `Your code to change your email is: <strong>${otp}</strong>` 
    };
    
    try {
        await resend.emails.send(msg);
    } catch (error) {
        console.error("Resend Error (Email Change):", error);
        // Clean up otp if email fails? Optional, but good practice.
        throw new ApiError(500, "Could not send verification email.");
    }
    
    return res.status(200).json(new ApiResponse(200, {}, "Verification OTP sent to your new email address."));
});

const verifyEmailChange = asyncHandler(async (req, res) => {
    const { otp } = req.body;
    const userId = req.user._id;
    if (!otp) throw new ApiError(400, "OTP is required.");
    const user = await User.findOne({ _id: userId, emailChangeOtp: otp, emailChangeOtpExpiry: { $gt: Date.now() } });
    if (!user) throw new ApiError(400, "Invalid or expired OTP.");
    user.email = user.newEmail;
    user.isVerified = true;
    user.newEmail = undefined;
    user.emailChangeOtp = undefined;
    user.emailChangeOtpExpiry = undefined;
    const updatedUser = await user.save({ validateBeforeSave: false });
    return res.status(200).json(new ApiResponse(200, { email: updatedUser.email }, "Email updated successfully."));
});

const getCurrentUser = asyncHandler(async (req, res) => {
    const bookmarkedSkills = await Skill.find({ bookmarkedBy: req.user._id }).select('_id');
    const bookmarkIds = bookmarkedSkills.map(skill => skill._id);
    const userData = { ...req.user.toObject(), bookmarks: bookmarkIds };
    return res.status(200).json(new ApiResponse(200, userData, "User profile fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { username, firstName, lastName, mobileNumber, bio, locationString, socials, skillsToTeach, skillsToLearn } = req.body;

    if (!username || !firstName || !lastName) {
        throw new ApiError(400, "First name, last name, and username are required.");
    }

    const user = await User.findById(req.user._id);
    if (!user) throw new ApiError(404, "User not found");

    user.username = username;
    user.firstName = firstName;
    user.lastName = lastName;
    user.mobileNumber = mobileNumber;
    user.bio = bio;
    user.socials = socials;
    user.locationString = locationString;
    user.skillsToTeach = skillsToTeach || [];
    user.skillsToLearn = skillsToLearn || [];
    
    const updatedUser = await user.save({ validateBeforeSave: false });
    
    return res.status(200).json(new ApiResponse(200, updatedUser, "Account details updated successfully."));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
    const { avatarUrl } = req.body;
    if (!avatarUrl) throw new ApiError(400, "Avatar URL is required");
    const optimizedUrl = avatarUrl.replace('/upload/', '/upload/w_200,h_200,c_fill,q_auto/');
    const user = await User.findByIdAndUpdate(req.user._id, { $set: { profilePicture: optimizedUrl } }, { new: true }).select("-password -refreshToken");
    return res.status(200).json(new ApiResponse(200, user, "Avatar updated successfully"));
});

const deleteUserAvatar = asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate(req.user._id, { $set: { profilePicture: '' } }, { new: true }).select("-password -refreshToken");
    return res.status(200).json(new ApiResponse(200, user, "Avatar removed successfully"));
});

const getUserProfile = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const user = await User.findOne({ username }).select("-password -refreshToken -role");
    if (!user) {
        throw new ApiError(404, "User not found");
    }
    
    let { earnedBadges, swapsCompleted, skillsOfferedCount } = await calculateUserStats(user);

    const accountAgeInHours = (new Date() - user.createdAt) / (1000 * 60 * 60);
    if (accountAgeInHours > 24) {
        earnedBadges = earnedBadges.filter(badge => badge !== "New Member");
    }
    
    const profileData = { 
        ...user.toObject(), 
        skillsOfferedCount, 
        swapsCompleted, 
        badges: earnedBadges 
    };
    return res.status(200).json(new ApiResponse(200, profileData, "User profile fetched successfully"));
});

const getUserSkills = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const user = await User.findOne({ username }).select('_id');
    if (!user) throw new ApiError(404, "User not found");

    const skills = await Skill.find({ user: user._id, type: 'OFFER' })
        .sort({ createdAt: -1 })
        .populate('user', 'username profilePicture');
        
    return res.status(200).json(new ApiResponse(200, skills, "User skills fetched successfully."));
});

const getUserBookmarks = asyncHandler(async (req, res) => {
    const { username } = req.params;
    const user = await User.findOne({ username }).select('_id');
    if (!user) throw new ApiError(404, "User not found");

    const bookmarks = await Skill.find({ bookmarkedBy: user._id })
        .sort({ createdAt: -1 })
        .populate('user', 'username profilePicture');
        
    return res.status(200).json(new ApiResponse(200, bookmarks, "User bookmarks fetched successfully."));
});

const verifyOtp = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        throw new ApiError(400, "Email and OTP are required.");
    }

    const user = await User.findOne({ 
        email, 
        verificationOtp: otp, 
        verificationOtpExpiry: { $gt: Date.now() } 
    });

    if (!user) {
        throw new ApiError(400, "Invalid OTP or OTP has expired.");
    }

    user.isVerified = true;
    user.verificationOtp = undefined;
    user.verificationOtpExpiry = undefined;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json(new ApiResponse(200, {}, "Email verified successfully! You can now log in."));
});

// --- 4. RESEND VERIFICATION EMAIL (Updated Email Logic) ---
const resendVerificationEmail = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) {
        throw new ApiError(400, "Email is required.");
    }

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(200).json(new ApiResponse(200, {}, "If an account with this email exists, a new verification code has been sent."));
    }

    if (user.isVerified) {
        return res.status(200).json(new ApiResponse(200, {}, "This account has already been verified."));
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    user.verificationOtp = otp;
    user.verificationOtpExpiry = otpExpiry;
    await user.save({ validateBeforeSave: false });

    const msg = {
        to: user.email,
        subject: 'Your New skill4skill Verification Code',
        from: 'onboarding@resend.dev', // Changed to Resend Test Email
        html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
                <h2>Here is your new verification code</h2>
                <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">${otp}</p>
                <p>This code will expire in 10 minutes.</p>
            </div>
        `,
    };

    try {
        await resend.emails.send(msg);
        return res.status(200).json(new ApiResponse(200, {}, "A new verification code has been sent to your email."));
    } catch (error) {
        console.error("Resend Error (Resend OTP):", error);
        throw new ApiError(500, "Could not send verification email. Please try again later.");
    }
});

const getLeaderboard = asyncHandler(async (req, res) => {
    const topUsers = await User.find({ role: 'user' })
        .select('firstName lastName username profilePicture swapCredits swapsCompleted')
        .sort({ swapsCompleted: -1, swapCredits: -1 }) 
        .limit(10); 

    const leaderboardData = topUsers.map(user => ({
        ...user.toObject(),
        score: (user.swapCredits || 0) + (user.swapsCompleted || 0) * 10
    }));

    return res.status(200).json(new ApiResponse(200, leaderboardData, "Leaderboard fetched successfully"));
});

const searchUsers = asyncHandler(async (req, res) => {
    const { query } = req.query;
    if (!query) {
        return res.status(200).json(new ApiResponse(200, [], "Please provide a search query."));
    }

    const searchQuery = new RegExp(query, 'i');

    const users = await User.find({
        $or: [
            { username: searchQuery },
            { firstName: searchQuery },
            { lastName: searchQuery }
        ]
    }).select('username firstName lastName profilePicture');

    return res.status(200).json(new ApiResponse(200, users, "Users fetched successfully."));
});

const getChatStatus = asyncHandler(async (req, res) => {
    const { profileId } = req.params;
    const loggedInUserId = req.user._id;

    const conversation = await Conversation.findOne({
        participants: { $all: [loggedInUserId, profileId] }
    });
    if (conversation) {
        return res.status(200).json(new ApiResponse(200, { status: 'accepted' }));
    }

    const chatRequest = await ChatRequest.findOne({
        $or: [
            { requester: loggedInUserId, receiver: profileId, status: 'pending' },
            { requester: profileId, receiver: loggedInUserId, status: 'pending' }
        ]
    });

    if (!chatRequest) {
        return res.status(200).json(new ApiResponse(200, { status: 'idle' }));
    }

    if (chatRequest.requester.equals(loggedInUserId)) {
        return res.status(200).json(new ApiResponse(200, { status: 'pending_sent' }));
    } else {
        return res.status(200).json(new ApiResponse(200, { status: 'pending_received', requestId: chatRequest._id }));
    }
});

const healthCheck = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, {}, "Server is healthy."));
});

const syncUserSkills = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const userSkills = await Skill.find({ user: userId }).select('title type');

    const skillsToTeach = [];
    const skillsToLearn = [];

    userSkills.forEach(skill => {
        if (skill.type === 'OFFER') {
            skillsToTeach.push(skill.title);
        } else if (skill.type === 'REQUEST') {
            skillsToLearn.push(skill.title);
        }
    });

    await User.findByIdAndUpdate(userId, {
        $addToSet: {
            skillsToTeach: { $each: skillsToTeach },
            skillsToLearn: { $each: skillsToLearn }
        }
    });

    return res.status(200).json(new ApiResponse(200, {}, "User skills synchronized successfully."));
});

export {
    registerUser,
    verifyOtp,
    loginUser,
    logoutUser,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    deleteUserAvatar,
    getUserProfile,
    resendVerificationEmail,
    forgotPassword,
    resetPassword,
    requestEmailChange,
    verifyEmailChange,
    getLeaderboard,
    searchUsers,
    getChatStatus,
    healthCheck,
    syncUserSkills,
    getUserSkills,
    getUserBookmarks
};