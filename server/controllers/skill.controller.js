import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Skill } from '../models/skill.model.js';
import { User } from '../models/user.model.js';
import { Proposal } from '../models/proposal.model.js';
import natural from 'natural';
import { createNotification } from './notification.controller.js';
import { sendPushNotification } from '../utils/pushNotifier.js';
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { getReceiverSocketId } from '../socket/socket.js';
import { Report } from '../models/report.model.js';

const { WordTokenizer, TfIdf } = natural;

const categorySubtopics = {
  Tech: ["Learn Python in 1 Hour", "JavaScript Basics", "React Hooks Tutorial", "Node.js for Beginners", "Intro to SQL", "CSS Flexbox Crash Course", "Data Structures Explained", "What is an API?", "Docker Fundamentals", "Git and GitHub Basics", "Intro to Machine Learning", "Cybersecurity Essentials", "Building a REST API", "Vue.js vs React", "TypeScript for Beginners"],
  Art: ["Digital Painting for Beginners", "Character Design Tips", "Perspective Drawing Basics", "Color Theory Explained", "How to Use Procreate", "Watercolor Techniques", "3D Modeling in Blender", "Sketching Fundamentals", "Pixel Art Tutorial", "Understanding Composition", "Creating Digital Illustrations", "Abstract Art Techniques", "Clay Sculpting Basics", "Figure Drawing", "Concept Art for Games"],
  Music: ["Beginner Guitar Chords", "How to Read Sheet Music", "Music Theory 101", "Singing Lessons for Beginners", "Making a Beat in FL Studio", "Piano Basics", "Ukulele First Lesson", "How to Use a DAW", "Songwriting for Beginners", "Drumming Fundamentals", "Music Production Basics", "Mixing and Mastering", "Learn to DJ", "Violin for Beginners", "Bass Guitar Basics"],
  Writing: ["Creative Writing Prompts", "How to Write a Novel", "Screenwriting for Beginners", "Copywriting Tips", "Better Storytelling", "Poetry for Beginners", "Writing a Blog Post", "Editing Your Own Work", "Building Fictional Worlds", "Character Development", "Technical Writing Basics", "Freelance Writing Guide", "How to Overcome Writer's Block", "Journaling for Clarity", "Writing Dialogue"],
};

const generateTags = (text) => {
  if (!text) return [];
  const tokenizer = new WordTokenizer();
  const tfidf = new TfIdf();
  tfidf.addDocument(text.toLowerCase());
  return tfidf.listTerms(0).slice(0, 5).map(item => item.term);
};

const createSkill = asyncHandler(async (req, res) => {
  const { title, description, category, level, costInCredits, creditsOffered, type } = req.body;
  const userId = req.user._id;

  if (!title || !description || !category || !level || !type) {
    throw new ApiError(400, "All required fields must be filled out.");
  }

  const validationPrompt = `
    Analyze the following skill title and description.
    Is this a legitimate, safe-for-work, learnable skill or topic?
    Title: "${title}"
    Description: "${description}"
    Respond with only "YES" or "NO".
  `;
  try {
    const validationText = await callGeminiWithFallback({ prompt: validationPrompt, context: 'generate' });
    const decision = validationText.trim().toUpperCase();
    if (decision !== 'YES') {
      throw new ApiError(400, "This does not appear to be a valid skill. Please try a different topic.");
    }
  } catch (error) {
    console.error("AI Skill Post Validation Error:", error);
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Could not validate the skill topic at this time.");
  }

  const combinedTextForTags = `${title} ${description}`;
  const generatedTags = generateTags(combinedTextForTags);

  const skill = await Skill.create({
    user: userId,
    title,
    description,
    category,
    level,
    costInCredits: type === 'OFFER' ? costInCredits : undefined,
    creditsOffered: type === 'REQUEST' ? creditsOffered : undefined,
    type,
    tags: generatedTags,
  });

  const updateField = type === 'OFFER' ? 'skillsToTeach' : 'skillsToLearn';
  await User.findByIdAndUpdate(userId, { $addToSet: { [updateField]: title } });

  if (skill.type === 'OFFER') {
    await User.findByIdAndUpdate(userId, { $inc: { skillsOfferedCount: 1 } });
  }

  return res.status(201).json(new ApiResponse(201, skill, "Skill posted successfully"));
});

const escapeRegex = (text) => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

const getAllSkills = asyncHandler(async (req, res) => {
  const { page = 1, limit = 6, category, keywords, userId, location, level } = req.query;
  const query = {};

  if (category) query.category = category;
  if (keywords) {
    const regex = new RegExp(escapeRegex(keywords), 'i'); 
    query.title = { $regex: regex };
  }
  if (userId) query.user = userId;
  if (level) query.level = level;
  if (location) {
    query.locationString = { $regex: new RegExp(escapeRegex(location), 'i') };
  }

  const skills = await Skill.find(query)
    .populate({ path: 'user', select: 'username profilePicture location' })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));


  const totalDocuments = await Skill.countDocuments(query);
  const totalPages = Math.ceil(totalDocuments / limit);

  return res.status(200).json(new ApiResponse(200, { skills, totalPages, currentPage: parseInt(page), totalSkills: totalDocuments }, "Skills fetched successfully"));
});

const getAllSkillsUnpaginated = asyncHandler(async (req, res) => {
  const { category, keywords, location, level } = req.query;
  const query = {};

  if (category) query.category = category;
  if (keywords) query.$text = { $search: keywords };
  if (level) query.level = level;
  if (location) {
    query.locationString = { $regex: new RegExp(location, 'i') };
  }

  const skills = await Skill.find(query)
    .populate({ path: 'user', select: 'username profilePicture' })
    .sort(keywords ? { score: { $meta: 'textScore' } } : { createdAt: -1 })
    .limit(500);

  
  return res.status(200).json(new ApiResponse(200, { skills }, "All skills fetched successfully"));
});


const getSkillById = asyncHandler(async (req, res) => {
  const { skillId } = req.params;
  const skill = await Skill.findById(skillId)
    .populate({ path: 'user', select: 'username profilePicture' })
    .populate({ path: 'ratings.user', select: 'username' });
  if (!skill) throw new ApiError(404, 'Skill not found');
  return res.status(200).json(new ApiResponse(200, skill, 'Skill details fetched successfully'));
});

const updateSkill = asyncHandler(async (req, res) => {
    const { skillId } = req.params;
    const { title, description, category, level, availability, locationString, desiredSkill, costInCredits, creditsOffered } = req.body;
    
    const originalSkill = await Skill.findById(skillId);
    if (!originalSkill) {
        throw new ApiError(404, "Skill not found");
    }

    const updatedData = { 
      title, 
      description, 
      category, 
      level, 
      availability, 
      locationString, 
      desiredSkill, 
      costInCredits, 
      creditsOffered 
    };
    
    if (title || description) {
        const skill = await Skill.findById(skillId);
        const newText = `${title || skill.title} ${description || skill.description}`;
        updatedData.tags = generateTags(newText);
    }

    const updatedSkill = await Skill.findByIdAndUpdate(skillId, { $set: updatedData }, { new: true, runValidators: true });
    
    if (!updatedSkill) {
      throw new ApiError(404, "Skill not found");
    }

     if (title && title !== originalSkill.title) {
        const updateField = originalSkill.type === 'OFFER' ? 'skillsToTeach' : 'skillsToLearn';
        await User.findByIdAndUpdate(originalSkill.user, {
            $pull: { [updateField]: originalSkill.title }, // Remove old title
        });
        await User.findByIdAndUpdate(updatedSkill.user, {
            $addToSet: { [updateField]: updatedSkill.title } // Add new title
        });
    }

    return res.status(200).json(new ApiResponse(200, updatedSkill, "Skill updated successfully"));
});

const deleteSkill = asyncHandler(async (req, res) => {
  const { skillId } = req.params;
  const userId = req.user._id;

  const skill = await Skill.findById(skillId);
  if (!skill) {
    throw new ApiError(404, "Skill not found");
  }
  if (skill.user.toString() !== userId.toString()) {
    throw new ApiError(403, "You are not authorized to delete this skill");
  }

  const updateField = skill.type === 'OFFER' ? 'skillsToTeach' : 'skillsToLearn';
  await User.findByIdAndUpdate(userId, { $pull: { [updateField]: skill.title } });
  
  if (skill.type === 'OFFER') {
    await User.findByIdAndUpdate(userId, { $inc: { skillsOfferedCount: -1 } });
  }

  await skill.deleteOne();


  return res.status(200).json(new ApiResponse(200, {}, "Skill deleted successfully"));
});

const getNearbySkills = asyncHandler(async (req, res) => {
  const { lat, lon, distance = 50000 } = req.query;
  if (!lat || !lon) throw new ApiError(400, "Latitude and longitude are required");
  const skills = await Skill.find({
    type: 'OFFER',
    geoCoordinates: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lon), parseFloat(lat)] },
        $maxDistance: parseInt(distance)
      }
    }
  }).populate('user', 'username profilePicture');
  return res.status(200).json(new ApiResponse(200, skills, "Nearby skills fetched successfully"));
});

const getLocationSuggestions = asyncHandler(async (req, res) => {
    const { search } = req.query;
    if (!search) return res.status(200).json(new ApiResponse(200, [], "No search query provided"));
    const locations = await Skill.aggregate([
        { $match: { locationString: { $regex: new RegExp(search, 'i') } } },
        { $group: { _id: '$locationString' } },
        { $limit: 5 },
        { $project: { _id: 0, location: '$_id' } }
    ]);
    return res.status(200).json(new ApiResponse(200, locations, "Suggestions fetched"));
});

const getKeywordSuggestions = asyncHandler(async (req, res) => {
  const { search } = req.query;
  if (!search || search.length < 2) {
    return res.status(200).json(new ApiResponse(200, [], "Query too short"));
  }

  const regex = new RegExp('^' + escapeRegex(search), 'i');

  const suggestions = await Skill.find({ title: { $regex: regex } })
    .limit(5) 
    .select('title'); 

  return res.status(200).json(new ApiResponse(200, suggestions, "Keyword suggestions fetched"));
});


const getMatchingSkills = asyncHandler(async (req, res) => {
  const { skillId } = req.params;
  const requestSkill = await Skill.findById(skillId);
  if (!requestSkill || requestSkill.type !== 'REQUEST') throw new ApiError(404, "Skill request not found.");
  const potentialMatches = await Skill.find({
    type: 'OFFER',
    user: { $ne: req.user._id },
    $or: [{ category: requestSkill.category }, { tags: { $in: requestSkill.tags } }]
  }).populate('user', 'username profilePicture');
  const scoredMatches = potentialMatches.map(match => {
    let score = (match.category === requestSkill.category) ? 10 : 0;
    score += match.tags.filter(tag => requestSkill.tags.includes(tag)).length * 5;
    return { ...match.toObject(), score }; 
  }).sort((a, b) => b.score - a.score);

  return res.status(200).json(new ApiResponse(200, scoredMatches.slice(0, 5), "Matching skills fetched"));
});

const bookmarkSkill = asyncHandler(async (req, res) => {
  const { skillId } = req.params;
  const userId = req.user._id;
  const skill = await Skill.findByIdAndUpdate(skillId, { $addToSet: { bookmarkedBy: userId } }, { new: true });
  if (!skill) throw new ApiError(404, "Skill not found");
  return res.status(200).json(new ApiResponse(200, {}, "Skill bookmarked"));
});

const unbookmarkSkill = asyncHandler(async (req, res) => {
  const { skillId } = req.params;
  const userId = req.user._id;
  const skill = await Skill.findByIdAndUpdate(skillId, { $pull: { bookmarkedBy: userId } }, { new: true });
  if (!skill) throw new ApiError(404, "Skill not found");
  return res.status(200).json(new ApiResponse(200, {}, "Bookmark removed"));
});

const rateSkill = asyncHandler(async (req, res) => {
  const { skillId } = req.params;
  const { rating } = req.body;
  const userId = req.user._id;
  if (!rating || rating < 1 || rating > 5) {
    throw new ApiError(400, "Please provide a rating between 1 and 5.");
  }
  let skill = await Skill.findById(skillId);
  if (!skill) throw new ApiError(404, "Skill not found");
  const existingRating = skill.ratings.find(r => r.user.equals(userId));
  if (existingRating) {
    existingRating.rating = rating;
  } else {
    skill.ratings.push({ user: userId, rating });
  }
  await skill.save();
  const updatedSkill = await Skill.findById(skillId).populate('ratings.user', 'username');
  return res.status(200).json(new ApiResponse(200, updatedSkill.ratings, "Thank you for your rating!"));
});

const getYoutubePlaceholders = asyncHandler(async (req, res) => {
  const allTopics = Object.values(categorySubtopics).flat();
  const shuffled = allTopics.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 12);
  return res.status(200).json(new ApiResponse(200, selected, "YouTube placeholders fetched"));
});


const getRecommendedSkills = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  let recommendedSkills = [];
  
  const userBookmarks = await Skill.find({ bookmarkedBy: userId }).select('category');

  if (userBookmarks.length > 0) {
    const categories = [...new Set(userBookmarks.map(skill => skill.category))];
    
    recommendedSkills = await Skill.find({
      category: { $in: categories },
      user: { $ne: userId } 
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('user', 'username');
  }

  if (recommendedSkills.length === 0) {
    recommendedSkills = await Skill.find({ user: { $ne: userId } })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'username');
  }
  
   return res.status(200).json(new ApiResponse(200, recommendedSkills, "Recommended skills fetched successfully"));
});

const callGeminiWithFallback = async (params) => {
  const apiKeys = process.env.GOOGLE_API_KEYS?.split(',').map(key => key.trim());

  if (!apiKeys || apiKeys.length === 0 || !apiKeys[0]) {
    throw new ApiError(500, "No Google API keys are configured on the server.");
  }

  for (let i = 0; i < apiKeys.length; i++) {
    const key = apiKeys[i];
    try {
      const genAI = new GoogleGenerativeAI(key);
      // Use the specific 002 version. This is the current active Free Tier model.
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      let result;
      if (params.context === 'chat') {
        const chat = model.startChat({ history: params.history, systemInstruction: params.systemInstruction });
        result = await chat.sendMessage(params.query);
      } else {
        result = await model.generateContent(params.prompt);
      }
      
      const response = await result.response;
      return response.text();

    } catch (error) {
      console.log("Could not list models", error);
      console.error(`Google AI Error with API Key ${i + 1}:`, error.message);
      if (i === apiKeys.length - 1) {
        throw new ApiError(500, "The AI service is currently unavailable after trying all available keys.");
      }
    }
  }
};


const generateAiContent = asyncHandler(async (req, res) => {
  const { context, title, type, query, history } = req.body;

  if (!context) {
    throw new ApiError(400, "A context is required.");
  }

  let text;

  if (context === "generate-description") {
    if (!title || !type) throw new ApiError(400, "Title and type are required.");

    const validationPrompt = `Is the following a legitimate, safe-for-work, non abusive, learnable skill or topic? Answer with only "YES" or "NO".\n\nTopic: "${title}"`;
    try {
      const validationText = await callGeminiWithFallback({ prompt: validationPrompt, context: 'generate' });
      const decision = validationText.trim().toUpperCase();
      if (decision !== "YES") {
        throw new ApiError(400, "This does not appear to be a valid skill. Please try a different topic.");
      }
    } catch (error) {
      console.error("AI Validation Error:", error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "Could not validate the skill topic.");
    }

     const prompt = type === "OFFER"
      ? `Generate a friendly and engaging 1-2 sentence skill description from the perspective of a user who is OFFERING to teach. The skill is: "${title}".`
      : `Generate a friendly and engaging 1-2 sentence skill description from the perspective of a user who is REQUESTING to learn. The skill is: "${title}".`;
      
    text = await callGeminiWithFallback({ prompt, context: 'generate' });

  } else if (context === "ask-ai") {
    if (!query) throw new ApiError(400, "A query is required for the AI chat.");
    
    const systemInstruction = {
      role: "system",
      parts: [{ text: `You are "SkillBot", a friendly AI assistant for a skill-swapping website. Your purpose is to answer questions about learnable skills. Use Markdown for formatting. If asked about a non-skill topic, you MUST politely decline with this exact phrase: "I can only answer questions about skills. Please try another topic!"` }],
    };

    text = await callGeminiWithFallback({
      context: 'chat',
      query,
      history: history || [],
      systemInstruction
    });

  } else {
    throw new ApiError(400, "Invalid AI context provided.");
  }

  return res.status(200).json(new ApiResponse(200, { response: text }, "AI response generated successfully"));
});

const getYoutubeTutorials = asyncHandler(async (req, res) => {
  const { keyword } = req.query;
  if (!keyword) {
    return res.status(200).json(new ApiResponse(200, [], "No keyword provided."));
  }

  try {
    const safetyPrompt = `
    Is the following search query about a legitimate, safe-for-work, non-abusive, non-badword, learnable skill?
    Query: "${keyword}"
    Respond with only "YES" or "NO".
  `;
    
    const validationText = await callGeminiWithFallback({ prompt: safetyPrompt, context: 'generate' });
    const decision = validationText.trim().toUpperCase();

    if (decision !== 'YES') {
      console.log(`Query "${keyword}" was actively blocked by the AI safety filter.`);
      return res.status(200).json(new ApiResponse(200, [], "Query blocked by safety filter."));
    }
  } catch (error) {
    console.error(`AI Safety Check failed for keyword "${keyword}", but proceeding with YouTube search. Error:`, error.message);
  }
  
  const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}%20tutorial&type=video&maxResults=6&key=${process.env.YOUTUBE_API_KEY}`;
  
  try {
    const response = await fetch(youtubeApiUrl);
    const data = await response.json();
    
    if (data.error) {
      console.error("YouTube API Error:", data.error.message);
      throw new ApiError(500, "Failed to fetch videos from YouTube.");
    }
    
    return res.status(200).json(new ApiResponse(200, data.items || [], "YouTube videos fetched"));
  } catch (error) {
    console.error("Fetch Error:", error);
    throw new ApiError(500, "Failed to fetch videos from YouTube.");
  }
});


const checkKeywordSafety = asyncHandler(async (req, res) => {
  const { keyword } = req.body;
  if (!keyword || !keyword.trim()) {
    return res.status(200).json(new ApiResponse(200, { isSafe: true }, "No keyword to check."));
  }
  
  const safetyPrompt = `Is the following search query about a legitimate, safe-for-work, non-abusive, non-badword, learnable skill? Query: "${keyword}" Respond with only "YES" or "NO".`;
  
  try {
    const validationText = await callGeminiWithFallback({ prompt: safetyPrompt, context: 'generate' });
    const isSafe = validationText.trim().toUpperCase() === 'YES';
    return res.status(200).json(new ApiResponse(200, { isSafe }, "Safety check complete."));
  } catch (error) {
    console.error("AI Safety Check Failed in checkKeywordSafety:", error);
    return res.status(200).json(new ApiResponse(200, { isSafe: false }, "Safety check failed, blocking by default."));
  }
});

const reportSkill = asyncHandler(async (req, res) => {
    const { skillId } = req.params;
    const { reason } = req.body;
    const reporterId = req.user._id;

    if (!reason || reason.trim() === '') {
        throw new ApiError(400, "A reason is required to report a skill.");
    }

    if (!mongoose.Types.ObjectId.isValid(skillId)) {
        throw new ApiError(400, "Invalid skill ID.");
    }

    const skill = await Skill.findById(skillId);
    if (!skill) {
        throw new ApiError(404, "Skill not found.");
    }

    const reportedUserId = skill.user;
    if (reporterId.equals(reportedUserId)) {
        throw new ApiError(400, "You cannot report your own skill.");
    }

    const existingReport = await Report.findOne({
        reporter: reporterId,
        reportedSkill: skillId,
    });

    if (existingReport) {
        throw new ApiError(400, "You have already reported this skill.");
    }

    await Report.create({
        reporter: reporterId,
        reportedSkill: skillId,
        reportedUser: reportedUserId,
        reason: reason,
        reportType: 'skill'
    });

    try {
        const ownerSocketId = getReceiverSocketId(reportedUserId.toString());
        const notificationMessage = `Your skill "${skill.title}" has been reported for review.`;
        const notificationUrl = `/skills/${skillId}`;

        if (ownerSocketId) {
            io.to(ownerSocketId).emit('new_notification', { message: notificationMessage });
        }
        await createNotification(reportedUserId, notificationMessage, notificationUrl);
        const pushPayload = { title: 'Skill Reported', body: notificationMessage, url: notificationUrl };
        await sendPushNotification(reportedUserId, pushPayload);

    } catch (notificationError) {
        console.error("Failed to send skill report notifications:", notificationError);
    }

    return res.status(200).json(new ApiResponse(200, {}, "Skill has been reported."));
});

export {
  createSkill,
  getAllSkills,
  getAllSkillsUnpaginated,
  getSkillById,
  updateSkill,
  deleteSkill,
  getNearbySkills,
  getLocationSuggestions,
  getKeywordSuggestions,
  getMatchingSkills,
  bookmarkSkill,
  unbookmarkSkill,
  rateSkill,
  getYoutubeTutorials,
  getYoutubePlaceholders,
  getRecommendedSkills,
  generateAiContent,
  checkKeywordSafety,
  reportSkill
};
