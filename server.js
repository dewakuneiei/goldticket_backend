const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const UAParser = require('ua-parser-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// =============================================================================
// CORS CONFIGURATION
// =============================================================================
const allowedOrigins = [
  'https://lacoupong.vercel.app',
  'https://lacoupong-website-admin.vercel.app',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501', // Added standard Live Server port
  'http://localhost:3000'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: 'GET, POST, PATCH, DELETE, OPTIONS, PUT', // Added PUT for avatar updates
  allowedHeaders: 'Content-Type, Authorization',
  credentials: true
};

// =============================================================================
// MIDDLEWARE SETUP
// =============================================================================
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.set('trust proxy', true);

// =============================================================================
// DATABASE CONNECTION
// =============================================================================
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/goldticket';
mongoose.connect(mongoURI)
  .then(() => {
    console.log('MongoDB Connected Successfully');
    createAdminAccount();
  })
  .catch(err => console.error('MongoDB Connection Error:', err));

const SECONDS_PER_COIN = parseInt(process.env.SECONDS_PER_COIN) || 12; // 1 minute = 5 coint (12*5 = 60)  

// --- SHOP CONFIGURATION ---
const SHOP_ITEMS = [
    // SKINS (มี Effect พิเศษ)
    { id: 'skin_alien', name: 'Alien Skin 👽', type: 'skin', value: '#84cc16', price: 100, description: 'ผิวสีเขียว เรืองแสงได้ในที่มืด', isPremium: true },
    { id: 'skin_demon', name: 'Red Demon 👹', type: 'skin', value: '#ef4444', price: 100, description: 'ผิวสีแดง พร้อมออร่าความร้อน', isPremium: true },
    { id: 'skin_gold', name: 'Golden Body 🌟', type: 'skin', value: 'url(#goldGradient)', price: 125, description: 'ตัวทองคำแท้ 24K', isPremium: true }, // SVG Gradient

    // SHIRTS
    { id: 'shirt_void', name: 'Void Suit 🌑', type: 'shirt', value: '#111827', price: 50, description: 'ชุดดำสนิทเหมือนหลุมดำ' },
    { id: 'shirt_neon', name: 'Neon Pink 💖', type: 'shirt', value: '#ec4899', price: 75, description: 'เสื้อชมพูสะท้อนแสง' },
    { id: 'shirt_rainbow', name: 'Rainbow Tee 🌈', type: 'shirt', value: 'url(#rainbowGradient)', price: 90, description: 'เสื้อลายสายรุ้งสดใส' }
];
// =============================================================================
// MONGOOSE SCHEMAS
// =============================================================================
const treasureSchema = new mongoose.Schema({
  lat: Number,
  lng: Number,
  placementDate: String,
  name: String,
  ig: String,
  face: String,
  mission: String,
  discount: String,
  discountBaht: String,
  totalBoxes: { type: Number, default: 1 },
  remainingBoxes: { type: Number, default: 1 }
});

const apiStatSchema = new mongoose.Schema({
  identifier: { type: String, default: 'global-stats', unique: true },
  appOpenCount: { type: Number, default: 0 },
  treasuresCreatedCount: { type: Number, default: 0 },
  treasuresOpenedCount: { type: Number, default: 0 },
  treasuresCompletedCount: { type: Number, default: 0 },
  lastAppOpen: { type: Date },
  lastTreasureCreated: { type: Date },
  lastTreasureOpened: { type: Date },
  lastTreasureCompleted: { type: Date }
});

const visitorSchema = new mongoose.Schema({
  ipAddress: { type: String, required: true, unique: true, index: true },
  userAgent: { type: String },
  deviceInfo: {
    browser: { name: String, version: String },
    os: { name: String, version: String },
    device: { vendor: String, model: String, type: String }
  },
  visitCount: { type: Number, default: 0 },
  firstVisit: { type: Date, default: Date.now },
  lastVisit: { type: Date, default: Date.now },
  totalTimeOnPageSeconds: { type: Number, default: 0 },
  appOpenCount: { type: Number, default: 0 },
  treasuresCreatedCount: { type: Number, default: 0 },
  treasuresOpenedCount: { type: Number, default: 0 }
});

const referrerStatSchema = new mongoose.Schema({
  domain: { type: String, required: true, unique: true, index: true },
  platform: { type: String, required: true },
  count: { type: Number, default: 0 }
});

const userAuthDataSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  password: { type: String, required: true },
  gender: { type: String, enum: ['male', 'female', 'lgbtq+', 'not-specified'] },
  ageRange: { type: String, enum: ['<18', '18-25', '26-35', '>35'] },
  referral: { type: String },
  createdAt: { type: Date, default: Date.now },
  passwordResetToken: { type: String },
  passwordResetExpires: { type: Date }
});

const userAuthReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAuthData', required: true, index: true },
  totalTimeOnPageSeconds: { type: Number, default: 0 },
  treasuresPlaced: { type: Number, default: 0 },
  treasuresClaimed: { type: Number, default: 0 },
  lastLogin: { type: Date },
  appOpenCount: { type: Number, default: 0 },
  lastAppOpen: { type: Date }
});

// --- NEW: User Game Data Schema (For Avatar, Coins, Rewards) ---
const userGameDataSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAuthData', required: true, unique: true, index: true },
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  coins: { type: Number, default: 0 }, // Start with 0 coins
  lastDailyReward: { type: Date },

  pendingSeconds: { type: Number, default: 0 }, // สะสมวินาทีเพื่อแลกเหรียญ (300s = 1 coin)

  avatar: {
    skin: { type: String, default: '#e0ac69' },
    shirt: { type: String, default: '#3b82f6' },
    hairIndex: { type: Number, default: 0 },
    hairColor: { type: String, default: '#000000' }
  },
  inventory: [{
    itemId: String,
    acquiredAt: { type: Date, default: Date.now }
  }]
});

const userSignSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAuthData', required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  
  // Type: 'normal' (announcement) or 'poll' (vote)
  type: { type: String, enum: ['normal', 'vote', 'poll'], default: 'normal' },

  // Content for Normal Sign
  message: { type: String, maxLength: 100 }, // Increased slightly for better UX, or keep 16 if strict

  // Content for Poll Sign
  pollTitle: { type: String, maxLength: 32 },
  pollDescription: { type: String, maxLength: 258 },
  pollOptions: [{
    text: { type: String, required: true },
    voters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UserAuthData' }] // Array of User IDs who voted for this option
  }],

  comments: [{
    username: String,
    text: { type: String, maxLength: 100 },
    createdAt: { type: Date, default: Date.now }
  }],
  
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true } // Dynamic expiration date
});

// Create Index for TTL based on 'expiresAt' field
// MongoDB will delete the document when the current time > expiresAt
userSignSchema.index({ "expiresAt": 1 }, { expireAfterSeconds: 0 });

const UserSign = mongoose.model('UserSign', userSignSchema);

// Password hashing middleware
userAuthDataSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// =============================================================================
// MONGOOSE MODELS
// =============================================================================
const Treasure = mongoose.model('Treasure', treasureSchema);
const ApiStat = mongoose.model('ApiStat', apiStatSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);
const ReferrerStat = mongoose.model('ReferrerStat', referrerStatSchema);
const UserAuthData = mongoose.model('UserAuthData', userAuthDataSchema);
const UserAuthReport = mongoose.model('UserAuthReport', userAuthReportSchema);
// NEW MODEL
const UserGameData = mongoose.model('UserGameData', userGameDataSchema);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
const createAdminAccount = async () => {
  try {
    const adminExists = await UserAuthData.findOne({ username: 'admin' });
    if (adminExists) {
      return;
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      console.error('\nCRITICAL WARNING: ADMIN_PASSWORD not set in .env');
      return;
    }

    const adminUser = new UserAuthData({
      username: 'admin',
      email: 'paihaisuth@gmail.com',
      password: adminPassword,
      role: 'admin'
    });

    await adminUser.save();
    console.log('Created Default Admin Account');

  } catch (error) {
    console.error('Error creating admin:', error.message);
  }
};

// =============================================================================
// MIDDLEWARE FUNCTIONS
// =============================================================================
const countApiCall = (counterName) => {
  return async (req, res, next) => {
    try {
      const updateOperation = { $inc: { [counterName]: 1 } };
      if (counterName === 'appOpenCount') updateOperation.$set = { lastAppOpen: new Date() };
      else if (counterName === 'treasuresCreatedCount') updateOperation.$set = { lastTreasureCreated: new Date() };
      else if (counterName === 'treasuresOpenedCount') updateOperation.$set = { lastTreasureOpened: new Date() };
      await ApiStat.findOneAndUpdate({ identifier: 'global-stats' }, updateOperation, { upsert: true });
    } catch (err) {
      console.error('API Stat Error:', err);
    }
    next();
  };
};

const trackVisitor = async (req, res, next) => {
  try {
    const ip = req.ip;
    if (!ip) return next();
    
    const uaString = req.headers['user-agent'];
    const parser = new UAParser(uaString);
    const uaResult = parser.getResult();
    
    const updateOperation = {
      $set: {
        userAgent: uaString,
        deviceInfo: {
          browser: uaResult.browser,
          os: uaResult.os,
          device: uaResult.device
        },
        lastVisit: new Date()
      },
      $inc: { visitCount: 1 },
      $setOnInsert: { firstVisit: new Date() }
    };
    
    const path = req.originalUrl;
    const method = req.method;
    if (method === 'POST' && path === '/api/treasures') updateOperation.$inc.treasuresCreatedCount = 1;
    else if (method === 'PATCH' && path.startsWith('/api/treasures/')) updateOperation.$inc.treasuresOpenedCount = 1;
    
    await Visitor.findOneAndUpdate({ ipAddress: ip }, updateOperation, { upsert: true });
  } catch (error) {
    console.error('trackVisitor Middleware Error:', error);
  }
  next();
};

const authMiddleware = (req, res, next) => {
  const authHeader = req.header('Authorization');
  if (!authHeader) return res.status(401).json({ message: 'Access denied. No token provided.' });
  
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Access denied. Token is malformed.' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (ex) {
    res.status(400).json({ message: 'Invalid token.' });
  }
};

const optionalAuthMiddleware = (req, res, next) => {
  const authHeader = req.header('Authorization');
  
  if (!authHeader) {
    req.user = null;
    return next();
  }

  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (ex) {
    console.warn(`Blocked request due to invalid/expired token. Error: ${ex.name}`);
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

const adminAuthMiddleware = (req, res, next) => {
  authMiddleware(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      return res.status(403).json({ message: 'Forbidden: Access is restricted to administrators.' });
    }
  });
};

// =============================================================================
// AUTHENTICATION ROUTES
// =============================================================================
const authRouter = express.Router();

authRouter.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await UserAuthData.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(200).json({ message: 'หากอีเมลนี้มีอยู่ในระบบ ลิงก์สำหรับรีเซ็ตรหัสผ่านจะถูกส่งไปให้' });
    }

    const token = crypto.randomBytes(20).toString('hex');
    
    user.passwordResetToken = token;
    user.passwordResetExpires = Date.now() + 3600000; // Token valid for 1 hour
    await user.save();

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      }
    });

    const clientBaseURL = process.env.clientBaseURL || 'http://127.0.0.1:5501';
    const resetURL = `${clientBaseURL}/reset-password.html?token=${token}`;

    const mailOptions = {
      to: user.email,
      from: `ล่าคูปอง <${process.env.EMAIL_USER}>`,
      subject: 'คำขอรีเซ็ตรหัสผ่าน',
      html: `<p>คลิกเพื่อรีเซ็ตรหัสผ่าน: <a href="${resetURL}">${resetURL}</a></p>`
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'หากอีเมลนี้มีอยู่ในระบบ ลิงก์สำหรับรีเซ็ตรหัสผ่านจะถูกส่งไปให้' });

  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});

authRouter.post('/reset-password/:token', async (req, res) => {
  try {
    const { password } = req.body;
    const user = await UserAuthData.findOne({
      passwordResetToken: req.params.token,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.status(200).json({ message: 'รีเซ็ตรหัสผ่านสำเร็จ' });

  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});

authRouter.post('/register', async (req, res) => {
  try {
    const { username, email, password, gender, ageRange, referral } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ message: "Required fields missing." });
    }
    
    let user = await UserAuthData.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }]
    });
    
    if (user) {
      return res.status(400).json({ message: 'User already exists.' });
    }
    
    user = new UserAuthData({ username, email, password, gender, ageRange, referral });
    await user.save();
    
    // Initialize Stats Report
    const newReport = new UserAuthReport({ userId: user._id });
    await newReport.save();

    // UPDATE: Initialize Game Data (Avatar/Coins)
    const newGameData = new UserGameData({ userId: user._id });
    await newGameData.save();
    
    res.status(201).json({ message: 'User registered successfully!' });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ message: "Server error." });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing credentials.' });
    
    const user = await UserAuthData.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials.' });
    
    await UserAuthReport.updateOne(
      { userId: user._id },
      { $set: { lastLogin: new Date() } }
    );

    // UPDATE: Check/Create Game Data for Backward Compatibility
    // If an old user logs in, they won't have GameData, so create it now to prevent bugs.
    const gameDataExists = await UserGameData.findOne({ userId: user._id });
    if (!gameDataExists) {
      await new UserGameData({ userId: user._id }).save();
      console.log(`Created missing GameData for user: ${user.username}`);
    }
    
    const payload = { id: user._id, username: user.username, role: user.role };
    const expiresIn = user.role === 'admin' ? '6h' : '7d';
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
    
    res.json({
      success: true,
      token,
      user: { id: user._id, username: user.username, role: user.role }
    });
    
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: 'Server error.' });
  }
});

authRouter.get('/verify', authMiddleware, async (req, res) => {
  try {
    const user = await UserAuthData.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, user: { username: user.username } });
  } catch (error) {
    console.error("Verify Token Error:", error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.use('/api/auth', authRouter);

// =============================================================================
// GAME FEATURES ROUTES (NEW)
// =============================================================================

// 1. Get Game Profile (Avatar, Coins, Level)
app.get('/api/game/profile', authMiddleware, async (req, res) => {
    try {
        let gameData = await UserGameData.findOne({ userId: req.user.id });
        
        // Safety check if not exists
        if (!gameData) {
            gameData = new UserGameData({ userId: req.user.id });
            await gameData.save();
        }
        
        res.json(gameData);
    } catch (error) {
        console.error('Game Profile Error:', error);
        res.status(500).json({ message: 'Error loading profile' });
    }
});

// 2. Update Avatar Configuration
app.put('/api/game/avatar', authMiddleware, async (req, res) => {
    try {
        const { skin, shirt, hairIndex, hairColor } = req.body;
        
        const updatedProfile = await UserGameData.findOneAndUpdate(
            { userId: req.user.id },
            { 
                $set: { 
                    'avatar.skin': skin,
                    'avatar.shirt': shirt,
                    'avatar.hairIndex': hairIndex,
                    'avatar.hairColor': hairColor
                }
            },
            { new: true } // Return updated doc
        );
        
        res.json(updatedProfile);
    } catch (error) {
        console.error('Avatar Update Error:', error);
        res.status(500).json({ message: 'Error updating avatar' });
    }
});

// 3. Claim Daily Reward
app.post('/api/game/daily-reward', authMiddleware, async (req, res) => {
    try {
        const gameData = await UserGameData.findOne({ userId: req.user.id });
        if (!gameData) return res.status(404).json({ message: 'Profile not found' });

        const now = new Date();
        const lastClaim = gameData.lastDailyReward ? new Date(gameData.lastDailyReward) : null;

        let canClaim = true;
        
        // Simple daily check (Server Time)
        if (lastClaim) {
            // Check if Year/Month/Day are the same
            if (lastClaim.getFullYear() === now.getFullYear() &&
                lastClaim.getMonth() === now.getMonth() &&
                lastClaim.getDate() === now.getDate()) {
                canClaim = false;
            }
        }

        if (!canClaim) {
            return res.status(400).json({ 
                success: false, 
                message: 'คุณได้รับรางวัลของวันนี้ไปแล้ว กลับมาใหม่พรุ่งนี้นะ!' 
            });
        }

        const reward = 30
        
        gameData.coins += reward;
        gameData.lastDailyReward = now;
        await gameData.save();

        res.json({ 
            success: true, 
            reward: reward, 
            newBalance: gameData.coins,
            message: `ยินดีด้วย! คุณได้รับ ${reward} เหรียญ`
        });

    } catch (error) {
        console.error('Daily Reward Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});


// =============================================================================
// PUBLIC TREASURE ROUTES
// =============================================================================
app.get('/api/treasures', trackVisitor, countApiCall('appOpenCount'), async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/treasures', optionalAuthMiddleware, trackVisitor, countApiCall('treasuresCreatedCount'), async (req, res) => {
  try {
    const treasure = new Treasure({ ...req.body, remainingBoxes: req.body.totalBoxes });
    const newTreasure = await treasure.save();

    if (req.user && req.user.id) {
      await UserAuthReport.updateOne(
        { userId: req.user.id },
        { $inc: { treasuresPlaced: 1 } },
        { upsert: true }
      );
      // Optional: Give coins for placing treasure? 
      // await UserGameData.updateOne({ userId: req.user.id }, { $inc: { coins: 10 } });
    }

    res.status(201).json(newTreasure);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.patch('/api/treasures/:id', optionalAuthMiddleware, trackVisitor, countApiCall('treasuresOpenedCount'), async (req, res) => {
  try {
    const treasure = await Treasure.findByIdAndUpdate(
      req.params.id,
      { $inc: { remainingBoxes: -1 } },
      { new: true }
    );

    if (!treasure) {
      return res.status(404).json({ message: 'ไม่พบคูปองนี้ หรืออาจถูกใช้ไปหมดแล้ว' });
    }
    
    if (req.user && req.user.id) {
      await UserAuthReport.updateOne(
        { userId: req.user.id },
        { $inc: { treasuresClaimed: 1 } },
        { upsert: true }
      );
      
      // UPDATE: Give XP/Coins for claiming treasure
      await UserGameData.updateOne(
          { userId: req.user.id }, 
          { $inc: { xp: 50, coins: 20 } }
      );
    }

    if (treasure.remainingBoxes <= 0) {
      console.log(`Treasure ID: ${treasure._id} is depleted. Preparing for deletion.`);
      
      await ApiStat.findOneAndUpdate(
        { identifier: 'global-stats' },
        {
          $inc: { treasuresCompletedCount: 1 },
          $set: { lastTreasureCompleted: new Date() }
        },
        { upsert: true }
      );
      
      await Treasure.findByIdAndDelete(treasure._id);
    }

    res.json(treasure);

  } catch (err) {
    console.error(`Error processing claim for treasure ID: ${req.params.id}`, err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID ของคูปองไม่ถูกต้อง' });
    }
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบขณะพยายามใช้คูปอง' });
  }
});

// =============================================================================
// VISITOR & STATS ROUTES
// =============================================================================
app.post('/api/visitors/opened-app', optionalAuthMiddleware, async (req, res) => {
  try {
    const ip = req.ip;
    if (ip) {
      await Visitor.findOneAndUpdate(
        { ipAddress: ip },
        { $inc: { appOpenCount: 1 } },
        { upsert: true }
      );
    }

    if (req.user && req.user.id) {
      await UserAuthReport.updateOne(
        { userId: req.user.id },
        {
          $inc: { appOpenCount: 1 },
          $set: { lastAppOpen: new Date() }
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error counting App Open:', error);
    res.sendStatus(500);
  }
});

app.patch('/api/visitors/log-time', async (req, res) => {
  try {
    const ip = req.ip;
    const { durationSeconds } = req.body;
    if (!ip || typeof durationSeconds !== 'number' || durationSeconds <= 0) {
      return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
    }
    await Visitor.findOneAndUpdate(
      { ipAddress: ip },
      { $inc: { totalTimeOnPageSeconds: Math.round(durationSeconds) } }
    );
    res.sendStatus(204);
  } catch (error) {
    console.error('Error logging time:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});

app.patch('/api/users/log-time', authMiddleware, async (req, res) => {
  try {
    const { durationSeconds } = req.body;
    if (typeof durationSeconds !== 'number' || durationSeconds <= 0) {
      return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
    }
    
    // 1. Update Report (Stats)
    await UserAuthReport.updateOne(
      { userId: req.user.id },
      { $inc: { totalTimeOnPageSeconds: Math.round(durationSeconds) } }
    );

    // 2. Update Game Data (Coins Logic)
    const gameData = await UserGameData.findOne({ userId: req.user.id });
    if (gameData) {
        gameData.pendingSeconds = (gameData.pendingSeconds || 0) + Math.round(durationSeconds);
        
        let coinsEarned = 0;
        if (gameData.pendingSeconds >= SECONDS_PER_COIN) {
            coinsEarned = Math.floor(gameData.pendingSeconds / SECONDS_PER_COIN);
            gameData.coins += coinsEarned;
            gameData.pendingSeconds = gameData.pendingSeconds % SECONDS_PER_COIN;
        }

        await gameData.save();

        // Pass the Rate back to frontend so it knows how to display text
        return res.json({ 
            success: true, 
            coinsEarned, 
            newBalance: gameData.coins,
            rate: Math.ceilSECONDS_PER_COIN  
        });
    }
    
    res.json({ success: true, coinsEarned: 0 });
  } catch (error) {
    console.error('Error logging user time:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});

app.post('/api/stats/track-referrer', async (req, res) => {
  try {
    const { referrer } = req.body;
    let platform = 'Direct/Unknown';
    let domain = 'direct';

    if (referrer && referrer !== 'direct') {
      try {
        const url = new URL(referrer);
        const hostname = url.hostname.replace(/^www\./, '');

        if (hostname.includes('messenger.com')) { platform = 'Messenger'; domain = 'messenger.com'; }
        else if (hostname.includes('facebook.com')) { platform = 'Facebook'; domain = 'facebook.com'; }
        else if (hostname.includes('instagram.com')) { platform = 'Instagram'; domain = 'instagram.com'; }
        else if (hostname.includes('tiktok.com')) { platform = 'TikTok'; domain = 'tiktok.com'; }
        else if (hostname.includes('line.me')) { platform = 'LINE'; domain = 'line.me'; }
        else if (hostname.includes('google.com')) { platform = 'Google'; domain = 'google.com'; }
        else { platform = 'Other'; domain = hostname; }
        
      } catch (parseError) {
        console.warn(`Could not parse invalid referrer URL: "${referrer}"`);
      }
    }
    
    await ReferrerStat.findOneAndUpdate(
      { domain },
      { $inc: { count: 1 }, $setOnInsert: { platform } },
      { upsert: true }
    );

    res.sendStatus(200);

  } catch (error) {
    console.error('Error in /track-referrer route:', error);
    res.status(500).json({ message: 'Server error while tracking referrer.' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await ApiStat.findOne({ identifier: 'global-stats' });
    res.json(stats || {});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// ADMIN PROTECTED ROUTES
// =============================================================================
app.get('/api/admin/referrers', adminAuthMiddleware, async (req, res) => {
  try {
    const stats = await ReferrerStat.find().sort({ count: -1 });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

app.get('/api/admin/treasures', adminAuthMiddleware, async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } })
      .select('_id placementDate name totalBoxes remainingBoxes')
      .sort({ placementDate: -1 });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/admin/treasures/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const treasure = await Treasure.findById(req.params.id);
    if (!treasure) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลสมบัติตาม ID ที่ระบุ' });
    }
    res.json(treasure);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/admin/visitors', adminAuthMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const visitors = await Visitor.find()
      .sort({ lastVisit: -1 })
      .skip(skip)
      .limit(limit);
      
    const totalVisitors = await Visitor.countDocuments();
    
    res.json({
      data: visitors,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalVisitors / limit),
        totalVisitors
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/admin/reset-data', adminAuthMiddleware, async (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.ADMIN_RESET_PASSWORD) {
    return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง' });
  }
  
  try {
    const r1 = await Treasure.deleteMany({});
    const r2 = await ApiStat.deleteMany({});
    const r3 = await Visitor.deleteMany({});
    const r4 = await ReferrerStat.deleteMany({});
    const r5 = await UserAuthData.deleteMany({});
    const r6 = await UserAuthReport.deleteMany({});
    // Also reset Game Data
    const r7 = await UserGameData.deleteMany({});
    
    res.json({
      message: 'ล้างข้อมูลทั้งหมดในระบบสำเร็จ',
      results: {
        treasures: r1.deletedCount,
        stats: r2.deletedCount,
        visitors: r3.deletedCount,
        referrers: r4.deletedCount,
        users: r5.deletedCount,
        reports: r6.deletedCount,
        gameData: r7.deletedCount
      }
    });
  } catch (err) {
    res.status(500).json({
      message: 'เกิดข้อผิดพลาดระหว่างการล้างข้อมูล',
      error: err.message
    });
  }
});

app.get('/api/admin/users-overview', adminAuthMiddleware, async (req, res) => {
    try {
        const users = await UserAuthData.find({ role: { $ne: 'admin' } }).select('gender ageRange');
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/user-reports', adminAuthMiddleware, async (req, res) => {
    try {
        const reports = await UserAuthReport.find()
            .populate({
                path: 'userId',
                select: 'username role',
                match: { role: { $ne: 'admin' } }
            })
            .sort({ lastLogin: -1 });

        const filteredReports = reports.filter(report => report.userId !== null);
        res.json(filteredReports);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/stats/total-time', adminAuthMiddleware, async (req, res) => {
    try {
        const visitorTimeResult = await Visitor.aggregate([
            { $group: { _id: null, totalSeconds: { $sum: '$totalTimeOnPageSeconds' } } }
        ]);

        const userReports = await UserAuthReport.find().populate({
            path: 'userId',
            select: 'role',
            match: { role: { $ne: 'admin' } }
        });
        
        const userTimeInSeconds = userReports
            .filter(report => report.userId !== null)
            .reduce((sum, report) => sum + report.totalTimeOnPageSeconds, 0);

        res.json({
            visitorTotalSeconds: visitorTimeResult.length > 0 ? visitorTimeResult[0].totalSeconds : 0,
            userTotalSeconds: userTimeInSeconds
        });

    } catch (err) {
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
});

app.get('/api/admin/visitors/all', adminAuthMiddleware, async (req, res) => {
    try {
        const visitors = await Visitor.find().sort({ lastVisit: -1 });
        res.json(visitors);
    } catch (err) {
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
});

// =============================================================================
// SHOP ROUTES (NEW)
// =============================================================================

// 1. Get Shop Items & User Inventory
app.get('/api/shop', authMiddleware, async (req, res) => {
    try {
        const gameData = await UserGameData.findOne({ userId: req.user.id });
        // Return available items and what user already owns
        const ownedItemIds = gameData.inventory.map(i => i.itemId);
        res.json({ items: SHOP_ITEMS, owned: ownedItemIds, coins: gameData.coins });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// 2. Buy Item
app.post('/api/shop/buy', authMiddleware, async (req, res) => {
    try {
        const { itemId } = req.body;
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        
        if (!item) return res.status(404).json({ message: 'ไม่พบสินค้านี้' });

        const gameData = await UserGameData.findOne({ userId: req.user.id });

        // Check ownership
        if (gameData.inventory.some(i => i.itemId === itemId)) {
            return res.status(400).json({ message: 'คุณมีสินค้านี้อยู่แล้ว' });
        }

        // Check balance
        if (gameData.coins < item.price) {
            return res.status(400).json({ message: 'เหรียญไม่พอครับ' });
        }

        // Transaction
        gameData.coins -= item.price;
        gameData.inventory.push({ itemId: item.id });
        
        // Auto-equip logic (Optional: instantly wear what you buy)
        if (item.type === 'skin') gameData.avatar.skin = item.value;
        if (item.type === 'shirt') gameData.avatar.shirt = item.value;

        await gameData.save();

        res.json({ 
            success: true, 
            message: `ซื้อ ${item.name} สำเร็จ!`, 
            newBalance: gameData.coins,
            avatar: gameData.avatar,
            owned: gameData.inventory.map(i => i.itemId)
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Transaction Failed' });
    }
});

// =============================================================================
// SOCIAL SIGN ROUTES (NEW)
// =============================================================================

// 1. Post a new Sign
app.post('/api/signs', authMiddleware, async (req, res) => {
    try {
        const { lat, lng, type, message, pollTitle, pollDescription, pollOptions, durationHours } = req.body;
        
        // --- [Keep Cooldown Logic same as before] ---
        const gameData = await UserGameData.findOne({ userId: req.user.id });
        const lastSign = gameData.lastSignPlacedAt ? new Date(gameData.lastSignPlacedAt) : null;
        const now = new Date();

        if (lastSign) {
            const diffMinutes = (now - lastSign) / 1000 / 60;
            if (diffMinutes < 60) {
                const remaining = Math.ceil(60 - diffMinutes);
                return res.status(400).json({ message: `รออีก ${remaining} นาที ถึงจะปักป้ายใหม่ได้` });
            }
        }

        // --- Calculate Expiration ---
        let validHours = [24, 48, 72];
        let hoursToAdd = validHours.includes(durationHours) ? durationHours : 24;
        const expiresAt = new Date(now.getTime() + (hoursToAdd * 60 * 60 * 1000));

        const newSignObj = {
            userId: req.user.id,
            lat, 
            lng,
            type: type || 'normal',
            createdAt: now,
            expiresAt: expiresAt
        };

        // --- VALIDATION LOGIC UPDATED ---
        if (newSignObj.type === 'vote' || newSignObj.type === 'poll') {
            // Common Validation for Vote & Poll
            if (!pollTitle || pollTitle.length > 32) return res.status(400).json({ message: 'หัวข้อต้องไม่เกิน 32 ตัวอักษร' });
            
            // Clean Options: Remove null/empty/undefined
            const validOptions = Array.isArray(pollOptions) 
                ? pollOptions.filter(opt => opt && opt.trim() !== "") 
                : [];

            // Specific Validation
            if (newSignObj.type === 'vote') {
                // VOTE: Strict 2-3 Options
                if (validOptions.length < 2 || validOptions.length > 3) {
                    return res.status(400).json({ message: 'โหวตต้องมีตัวเลือก 2 หรือ 3 ข้อ' });
                }
            } else {
                // POLL: 2-10 Options
                if (validOptions.length < 2 || validOptions.length > 10) {
                    return res.status(400).json({ message: 'โพลต้องมีตัวเลือกเริ่มต้น 2-10 ข้อ' });
                }
            }

            newSignObj.pollTitle = pollTitle;
            newSignObj.pollDescription = pollDescription;
            newSignObj.pollOptions = validOptions.map(opt => ({ text: opt.trim(), voters: [] }));

        } else {
            // NORMAL SIGN
            if (!message) return res.status(400).json({ message: 'กรุณาระบุข้อความ' });
            newSignObj.message = message.substring(0, 16); 
        }

        const newSign = new UserSign(newSignObj);
        await newSign.save();

        gameData.lastSignPlacedAt = now;
        await gameData.save();

        res.status(201).json({ success: true, message: 'ปักป้ายสำเร็จ!' });
    } catch (error) {
        console.error('Post Sign Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});


// 2. Get all Signs (with Avatar data)
app.get('/api/signs', async (req, res) => {
    try {
        const signs = await UserSign.aggregate([
            {
                $lookup: {
                    from: 'usergamedatas',
                    localField: 'userId',
                    foreignField: 'userId',
                    as: 'gameData'
                }
            },
            {
                $lookup: {
                    from: 'userauthdatas',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userData'
                }
            },
            {
                $project: {
                    lat: 1, lng: 1, 
                    type: 1, // Include Type
                    message: 1, 
                    // Include Poll Data
                    pollTitle: 1,
                    pollDescription: 1,
                    pollOptions: 1,
                    
                    comments: 1, 
                    createdAt: 1, 
                    expiresAt: 1,
                    
                    avatar: { $arrayElemAt: ["$gameData.avatar", 0] },
                    username: { $arrayElemAt: ["$userData.username", 0] },
                    userId: 1 // Needed for client side check (did I vote?)
                }
            }
        ]);
        res.json(signs);
    } catch (error) {
        console.error('Get Signs Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// 3. Post a Comment
app.post('/api/signs/:id/comments', authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        
        // 1. Validate Input
        if (!text || text.trim() === "") {
            return res.status(400).json({ message: 'ข้อความว่างเปล่า' });
        }

        // 2. Find Sign
        const sign = await UserSign.findById(req.params.id);
        if (!sign) return res.status(404).json({ message: 'ไม่พบป้ายนี้ (อาจหมดอายุแล้ว)' });

        // 3. Get Username (Robust Check)
        // Try to get from token payload first
        let username = req.user.username;
        
        // If missing in token, fetch from DB
        if (!username) {
            const user = await UserAuthData.findById(req.user.id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            username = user.username;
        }

        // 4. Add Comment
        sign.comments.push({
            username: username,
            text: text.substring(0, 100) // Truncate if too long
        });
        
        await sign.save();
        res.json({ success: true, comments: sign.comments });

    } catch (error) {
        console.error('Post Comment Error:', error); // Log actual error
        res.status(500).json({ message: 'Server Error: ' + error.message });
    }
});

// 4. Vote on a Poll OR Vote Sign
app.post('/api/signs/:id/vote', authMiddleware, async (req, res) => {
    try {
        const { optionIndex } = req.body; 
        const signId = req.params.id;
        const userId = req.user.id;

        const sign = await UserSign.findById(signId);
        if (!sign) return res.status(404).json({ message: 'ไม่พบป้ายนี้' });

        if (sign.type !== 'poll' && sign.type !== 'vote') {
            return res.status(400).json({ message: 'ป้ายนี้ไม่ใช่แบบโหวต' });
        }

        if (optionIndex < 0 || optionIndex >= sign.pollOptions.length) {
            return res.status(400).json({ message: 'ตัวเลือกไม่ถูกต้อง' });
        }

        const targetOption = sign.pollOptions[optionIndex];
        // Check if user already voted for THIS option
        const existingIndex = targetOption.voters.findIndex(v => v.toString() === userId);

        if (existingIndex > -1) {
            // TOGGLE OFF: Remove vote (Unvote)
            targetOption.voters.splice(existingIndex, 1);
        } else {
            // TOGGLE ON:
            // 1. Remove user from ALL other options (Single Choice Rule)
            sign.pollOptions.forEach(opt => {
                opt.voters = opt.voters.filter(v => v.toString() !== userId);
            });
            // 2. Add to target
            targetOption.voters.push(userId);
        }

        await sign.save();
        res.json({ success: true, message: 'บันทึกคะแนนแล้ว', pollOptions: sign.pollOptions });

    } catch (error) {
        console.error('Vote Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// Get Single Sign with Full Details (Avatars + Comments Avatar)
app.get('/api/signs/:id/details', async (req, res) => {
    try {
        const signId = req.params.id;
        const limit = parseInt(req.query.commentLimit) || 10;
        const skip = parseInt(req.query.commentSkip) || 0;

        // 1. Fetch Sign + Pagination for Comments
        const sign = await UserSign.findById(signId, {
            // Project only necessary fields + Sliced Comments
            // Note: We need full comments COUNT to know if we should show "Load More"
            // So we might need two queries or an aggregation.
            // Aggregation is better.
        }).lean(); 

        if (!sign) return res.status(404).json({ message: 'Sign not found' });

        // AGGREGATION PIPELINE for Pagination
        const pipeline = [
            { $match: { _id: new mongoose.Types.ObjectId(signId) } },
            {
                $project: {
                    lat: 1, lng: 1, type: 1, message: 1, pollTitle: 1, pollDescription: 1, pollOptions: 1, createdAt: 1, expiresAt: 1, userId: 1,
                    totalComments: { $size: "$comments" }, // Get total count
                    comments: { 
                        $slice: [{ $reverseArray: "$comments" }, skip, limit] // Slice REVERSED array (Newest first)
                    }
                }
            }
        ];
        
        const resultAgg = await UserSign.aggregate(pipeline);
        const signData = resultAgg[0];

        // 2. Fetch Owner Info
        const ownerGame = await UserGameData.findOne({ userId: signData.userId });
        const ownerAuth = await UserAuthData.findById(signData.userId);

        // 3. Fetch Avatars for Commenters (in this batch)
        const commentUsernames = signData.comments.map(c => c.username);
        const commentUsers = await UserAuthData.find({ username: { $in: commentUsernames } });
        
        // 4. Fetch Avatars for Poll Voters (if poll)
        let voterIds = [];
        if (signData.type === 'poll') {
            signData.pollOptions.forEach(opt => voterIds = voterIds.concat(opt.voters));
        }
        
        // Combine IDs to fetch avatars
        const commentUserIds = commentUsers.map(u => u._id);
        const allIdsToFetch = [...new Set([...voterIds, ...commentUserIds])];
        
        const userGameDatas = await UserGameData.find({ userId: { $in: allIdsToFetch } });
        const avatarMap = {};
        userGameDatas.forEach(g => avatarMap[g.userId.toString()] = g.avatar);
        
        const usernameToIdMap = {};
        commentUsers.forEach(u => usernameToIdMap[u.username] = u._id.toString());

        // 5. Construct Response
        // Populate Poll
        let populatedOptions = signData.pollOptions.map(opt => ({
            text: opt.text,
            count: opt.voters.length,
            // Only populate voters array if POLL (Privacy)
            voters: signData.type === 'poll' ? opt.voters.map(vId => ({
                id: vId,
                avatar: avatarMap[vId.toString()] || { skin: '#ccc', shirt: '#fff' }
            })) : []
        }));

        // Populate Comments
        const populatedComments = signData.comments.map(c => {
            const uId = usernameToIdMap[c.username];
            return {
                username: c.username,
                text: c.text,
                createdAt: c.createdAt,
                avatar: (uId && avatarMap[uId]) ? avatarMap[uId] : { skin: '#e0ac69', shirt: '#9ca3af' }
            };
        });

        res.json({
            ...signData,
            username: ownerAuth ? ownerAuth.username : 'Unknown',
            avatar: ownerGame ? ownerGame.avatar : {},
            pollOptions: populatedOptions,
            comments: populatedComments, // Sliced batch
            totalComments: signData.totalComments // Total count for frontend logic
        });

    } catch (error) {
        console.error('Get Sign Details Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// 5. Add Option to Poll (Only for type='poll')
app.post('/api/signs/:id/options', authMiddleware, async (req, res) => {
    try {
        const { newOption } = req.body;
        const signId = req.params.id;

        if (!newOption || newOption.trim() === "") return res.status(400).json({ message: 'ข้อความว่างเปล่า' });

        const sign = await UserSign.findById(signId);
        if (!sign) return res.status(404).json({ message: 'ไม่พบป้าย' });
        if (sign.type !== 'poll') return res.status(400).json({ message: 'เฉพาะโพลเท่านั้นที่เพิ่มตัวเลือกได้' });

        // Limit Max Options
        if (sign.pollOptions.length >= 10) {
            return res.status(400).json({ message: 'ตัวเลือกเต็มแล้ว (สูงสุด 10)' });
        }

        // Check Duplicate
        const exists = sign.pollOptions.some(opt => opt.text === newOption.trim());
        if (exists) return res.status(400).json({ message: 'มีตัวเลือกนี้อยู่แล้ว' });

        // Add Option
        sign.pollOptions.push({ text: newOption.trim(), voters: [] });
        await sign.save();

        res.json({ success: true, message: 'เพิ่มตัวเลือกสำเร็จ', pollOptions: sign.pollOptions });

    } catch (error) {
        console.error('Add Option Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// =============================================================================
// SERVER INITIALIZATION
// =============================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});