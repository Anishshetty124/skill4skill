import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Conversation } from '../models/conversation.model.js';
import { Message } from '../models/message.model.js';
import { getReceiverSocketId, io } from '../socket/socket.js';
import { User } from '../models/user.model.js';
import { Proposal } from '../models/proposal.model.js'; 
import { Skill } from '../models/skill.model.js';
import profanity from 'leo-profanity'; 
import { Report } from '../models/report.model.js';
import { sendPushNotification } from '../utils/pushNotifier.js';
import { createNotification } from './notification.controller.js';
import { ChatRequest } from '../models/chatRequest.model.js';
profanity.loadDictionary(); 
profanity.add(profanity.getDictionary('hi'));
profanity.add(profanity.getDictionary('kn'));

const getMessages = asyncHandler(async (req, res) => {
    const { id: userToChatId } = req.params;
    const senderId = req.user._id;

    const conversation = await Conversation.findOne({
        participants: { $all: [senderId, userToChatId] },
    }).populate("messages");

    if (!conversation) {
        return res.status(200).json(new ApiResponse(200, [], "No messages found"));
    }

    const messages = conversation.messages;

    res.status(200).json(new ApiResponse(200, messages, "Messages fetched successfully"));
});


const sendMessage = asyncHandler(async (req, res) => {
    const { message } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    if (profanity.check(message)) {
        throw new ApiError(400, "Message contains inappropriate language.");
    }

    let conversation = await Conversation.findOne({
        participants: { $all: [senderId, receiverId] },
    });

    if (!conversation) {
        const acceptedRequest = await ChatRequest.findOne({
            $or: [
                { requester: senderId, receiver: receiverId, status: 'accepted' },
                { requester: receiverId, receiver: senderId, status: 'accepted' }
            ]
        });

        if (!acceptedRequest) {
            throw new ApiError(403, "You can only send messages after a chat request has been accepted.");
        }

        conversation = await Conversation.create({
            participants: [senderId, receiverId],
        });
    }

    const newMessage = new Message({
        senderId,
        receiverId,
        message,
        conversationId: conversation._id
    });
    
    if (newMessage) {
        conversation.messages.push(newMessage._id);
        conversation.lastMessage = newMessage._id;
    }

    await Promise.all([conversation.save(), newMessage.save()]);

    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
        io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    const pushPayload = {
        title: `New Message from ${req.user.username}`,
        body: message,
        url: `/messages` 
    };
    await sendPushNotification(receiverId, pushPayload);

    res.status(201).json(new ApiResponse(201, newMessage, "Message sent successfully"));
});


const getConversations = asyncHandler(async (req, res) => {
    const loggedInUserId = req.user._id;

    const conversations = await Conversation.aggregate([
        { $match: { participants: loggedInUserId } },

        {
            $lookup: {
                from: 'users',
                localField: 'participants',
                foreignField: '_id',
                as: 'participantDetails'
            }
        },

        {
            $lookup: {
                from: 'messages',
                localField: 'lastMessage',
                foreignField: '_id',
                as: 'lastMessageDetails'
            }
        },

        {
            $project: {
                _id: 1,
                updatedAt: 1,
                participant: {
                    $arrayElemAt: [
                        {
                            $filter: {
                                input: "$participantDetails",
                                as: "p",
                                cond: { $ne: ["$$p._id", loggedInUserId] }
                            }
                        },
                        0
                    ]
                },
                lastMessage: { $arrayElemAt: ["$lastMessageDetails", 0] }
            }
        },

        {
            $lookup: {
                from: 'messages',
                let: { conversationId: "$_id", participantId: "$participant._id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$conversationId", "$$conversationId"] },
                                    { $eq: ["$senderId", "$$participantId"] },
                                    { $eq: ["$receiverId", loggedInUserId] },
                                    { $eq: ["$read", false] }
                                ]
                            }
                        }
                    },
                    { $count: "unread" }
                ],
                as: "unreadMessages"
            }
        },

        {
            $project: {
                _id: 1,
                updatedAt: 1,
                participant: {
                    _id: "$participant._id",
                    username: "$participant.username",
                    profilePicture: "$participant.profilePicture",
                    firstName: "$participant.firstName",
                    lastName: "$participant.lastName"
                },
                lastMessage: 1,
                unreadCount: { $ifNull: [{ $arrayElemAt: ["$unreadMessages.unread", 0] }, 0] }
            }
        },

        { $sort: { updatedAt: -1 } }
    ]);

    res.status(200).json(new ApiResponse(200, conversations, "Conversations fetched successfully"));
});

const deleteMessage = asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) {
        throw new ApiError(404, "Message not found");
    }

    if (!message.senderId.equals(userId)) {
        throw new ApiError(403, "You can only delete your own messages.");
    }

    const conversation = await Conversation.findOne({ messages: messageId });
    if (conversation) {
        await Conversation.updateOne({ _id: conversation._id }, { $pull: { messages: messageId } });
    }

    await Message.findByIdAndDelete(messageId);

    const otherParticipantId = conversation.participants.find(p => !p.equals(userId)).toString();
    const receiverSocketId = getReceiverSocketId(otherParticipantId);
    if (receiverSocketId) {
        io.to(receiverSocketId).emit("messageDeleted", { messageId, conversationId: conversation._id });
    }

    res.status(200).json(new ApiResponse(200, {}, "Message deleted successfully"));
});

const clearConversation = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user._id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new ApiError(404, "Conversation not found");
    }

    if (!conversation.participants.includes(userId)) {
        throw new ApiError(403, "You are not part of this conversation.");
    }

    await Message.deleteMany({ _id: { $in: conversation.messages } });

    conversation.messages = [];
    await conversation.save();
    
    res.status(200).json(new ApiResponse(200, {}, "Chat history cleared."));
});

const reportUser = asyncHandler(async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { reason } = req.body;
        const reporterId = req.user?._id;

        if (!reporterId) {
            throw new ApiError(401, "Unauthorized. Please log in first.");
        }

        if (!reason || reason.trim() === '') {
            throw new ApiError(400, "A reason is required to report a user.");
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            throw new ApiError(404, "Conversation not found.");
        }

        const reportedUserId = conversation.participants.find(
            p => p.toString() !== reporterId.toString()
        );

        if (!reportedUserId) {
            throw new ApiError(400, "Could not identify the user to report in this conversation.");
        }

        const existingReport = await Report.findOne({
            reporter: reporterId,
            reportedUser: reportedUserId,
            conversationId: conversationId
        });

        if (existingReport) {
            throw new ApiError(400, "You have already reported this user for this conversation.");
        }

        await Report.create({
            reporter: reporterId,
            reportedUser: reportedUserId,
            conversationId: conversationId,
            reason: reason,
            reportType: 'user' 
        });
        try {
            const reportedUserSocketId = getReceiverSocketId(reportedUserId.toString());
            const notificationMessage = "You have been reported for inappropriate conduct. Our moderation team will review the case. Further violations may lead to account suspension.";
            const notificationUrl = '/messages';

            if (reportedUserSocketId) {
                io.to(reportedUserSocketId).emit('new_notification', {
                    message: notificationMessage
                });
            }
            await createNotification(reportedUserId, notificationMessage, notificationUrl);

            const pushPayload = {
                title: 'Account Warning',
                body: notificationMessage,
                url: '/messages' 
            };
            await sendPushNotification(reportedUserId, pushPayload);
        } catch (notificationError) {
            console.error("Failed to send report notifications:", notificationError);
        }

        return res.status(200).json(new ApiResponse(200, {}, "User has been reported. Our moderation team will review the details shortly."));
    } catch (err) {
        console.error("ReportUser Error:", err); 
        throw err;
    }
});


const markAllAsRead = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    await Message.updateMany(
        { receiverId: userId, read: false },
        { $set: { read: true } }
    );

    res.status(200).json(new ApiResponse(200, {}, "All messages marked as read."));
});

const markMessagesAsRead = asyncHandler(async (req, res) => {
  const { id: userToChatId } = req.params;
  const currentUserId = req.user._id;

  const conversationExists = await Conversation.exists({
    participants: { $all: [currentUserId, userToChatId] }
  });

  if (conversationExists) {
    await Message.updateMany(
      { senderId: userToChatId, receiverId: currentUserId, read: false },
      { $set: { read: true } }
    );
    return res.status(200).json(new ApiResponse(200, {}, "Messages marked as read"));
  } else {
    return res.status(404).json(new ApiResponse(404, {}, "Conversation not found"));
  }
});

const deleteConversation = asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user._id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new ApiError(404, "Conversation not found.");
    }

    if (!conversation.participants.includes(userId)) {
        throw new ApiError(403, "You are not authorized to delete this conversation.");
    }

    const otherParticipantId = conversation.participants.find(p => !p.equals(userId));

    if (otherParticipantId) {
        await ChatRequest.findOneAndDelete({
            $or: [
                { sender: userId, receiver: otherParticipantId },
                { sender: otherParticipantId, receiver: userId }
            ]
        });
    }

    await Message.deleteMany({ conversationId });

    await Conversation.findByIdAndDelete(conversationId);

    if (otherParticipantId) {
        const receiverSocketId = getReceiverSocketId(otherParticipantId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('conversationDeleted', conversationId);
        }
    }

    res.status(200).json(new ApiResponse(200, {}, "Conversation and associated request deleted successfully."));
});


export { sendMessage, getMessages, getConversations, deleteMessage, clearConversation, reportUser , markMessagesAsRead, markAllAsRead, deleteConversation };