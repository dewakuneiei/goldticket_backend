// ========================================================
// --- IMPORTS & INITIAL SETUP ---
// ========================================================
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const UAParser = require('ua-parser-js');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.set('trust proxy', true);

// Connect to MongoDB
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/goldticket';
mongoose.connect(mongoURI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));


// ========================================================
// --- SCHEMAS & MODELS ---
// ========================================================

// --- Existing Schemas (No changes) ---
const treasureSchema = new mongoose.Schema({ lat: Number, lng: Number, placementDate: String, name: String, ig: String, face: String, mission: String, discount: String, discountBaht: String, totalBoxes: { type: Number, default: 1 }, remainingBoxes: { type: Number, default: 1 }});
const Treasure = mongoose.model('Treasure', treasureSchema);

const apiStatSchema = new mongoose.Schema({ identifier: { type: String, default: 'global-stats', unique: true }, appOpenCount: { type: Number, default: 0 }, treasuresCreatedCount: { type: Number, default: 0 }, treasuresOpenedCount: { type: Number, default: 0 }, treasuresCompletedCount: { type: Number, default: 0 }, lastAppOpen: { type: Date }, lastTreasureCreated: { type: Date }, lastTreasureOpened: { type: Date }, lastTreasureCompleted: { type: Date } });
const ApiStat = mongoose.model('ApiStat', apiStatSchema);

const visitorSchema = new mongoose.Schema({ ipAddress: { type: String, required: true, unique: true, index: true }, userAgent: { type: String }, deviceInfo: { browser: { name: String, version: String }, os: { name: String, version: String }, device: { vendor: String, model: String, type: String } }, visitCount: { type: Number, default: 0 }, firstVisit: { type: Date, default: Date.now }, lastVisit: { type: Date, default: Date.now }, totalTimeOnPageSeconds: { type: Number, default: 0 }, appOpenCount: { type: Number, default: 0 }, treasuresCreatedCount: { type: Number, default: 0 }, treasuresOpenedCount: { type: Number, default: 0 }});
const Visitor = mongoose.model('Visitor', visitorSchema);

const referrerStatSchema = new mongoose.Schema({ domain: { type: String, required: true, unique: true, index: true }, platform: { type: String, required: true }, count: { type: Number, default: 0 } });
const ReferrerStat = mongoose.model('ReferrerStat', referrerStatSchema);

// --- [NEW] User Authentication Schemas ---
const userAuthDataSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  gender: { type: String, enum: ['male', 'female', 'lgbtq+', 'not-specified'] },
  ageRange: { type: String, enum: ['<18', '18-25', '26-35', '>35'] },
  referral: { type: String },
  createdAt: { type: Date, default: Date.now },

  passwordResetToken: { type: String },
  passwordResetExpires: { type: Date }
});

userAuthDataSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});
const UserAuthData = mongoose.model('UserAuthData', userAuthDataSchema);

const userAuthReportSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAuthData', required: true, index: true },
    totalTimeOnPageSeconds: { type: Number, default: 0 },
    treasuresPlaced: { type: Number, default: 0 },
    treasuresClaimed: { type: Number, default: 0 },
    lastLogin: { type: Date },
    appOpenCount: { type: Number, default: 0 },
    lastAppOpen: { type: Date }
});
const UserAuthReport = mongoose.model('UserAuthReport', userAuthReportSchema);


// ========================================================
// --- MIDDLEWARES ---
// ========================================================

// --- Existing Middlewares (No changes) ---
const countApiCall = (counterName) => {
  return async (req, res, next) => {
    try {
      const updateOperation = { $inc: { [counterName]: 1 } };
      if (counterName === 'appOpenCount') updateOperation.$set = { lastAppOpen: new Date() };
      else if (counterName === 'treasuresCreatedCount') updateOperation.$set = { lastTreasureCreated: new Date() };
      else if (counterName === 'treasuresOpenedCount') updateOperation.$set = { lastTreasureOpened: new Date() };
      await ApiStat.findOneAndUpdate({ identifier: 'global-stats' }, updateOperation, { upsert: true });
    } catch (err) { console.error('API Stat Error:', err); }
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
        const updateOperation = { $set: { userAgent: uaString, deviceInfo: { browser: uaResult.browser, os: uaResult.os, device: uaResult.device }, lastVisit: new Date() }, $inc: { visitCount: 1 }, $setOnInsert: { firstVisit: new Date() } };
        const path = req.originalUrl;
        const method = req.method;
        if (method === 'POST' && path === '/api/treasures') updateOperation.$inc.treasuresCreatedCount = 1;
        else if (method === 'PATCH' && path.startsWith('/api/treasures/')) updateOperation.$inc.treasuresOpenedCount = 1;
        await Visitor.findOneAndUpdate({ ipAddress: ip }, updateOperation, { upsert: true });
    } catch (error) { console.error('trackVisitor Middleware Error:', error); }
    next();
};

// --- [NEW] Token Verification Middleware ---
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

// Middleware นี้จะตรวจสอบ Token ถ้ามี แต่จะไม่ error ถ้าไม่มี (สำหรับ guest)
const optionalAuthMiddleware = (req, res, next) => {
    const authHeader = req.header('Authorization');
    
    // If there's no Authorization header, treat as a guest and continue.
    if (!authHeader) {
        req.user = null;
        return next();
    }

    const token = authHeader.replace('Bearer ', '');
    
    // If the token string is empty after replacing 'Bearer ', also treat as guest.
    if (!token) {
        req.user = null;
        return next();
    }

    try {
        // Try to verify the token. If successful, attach user data to the request.
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next(); // Continue to the next middleware/route handler.
    } catch (ex) {
        // CRITICAL CHANGE: If a token was provided but it's invalid or expired,
        // stop execution and send a 401 Unauthorized error.
        // This will be caught by the frontend's apiInterceptor.
        console.warn(`Blocked request due to invalid/expired token. Error: ${ex.name}`);
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

// ========================================================
// --- AUTHENTICATION ROUTES ---
// ========================================================
const authRouter = express.Router();

const nodemailer = require('nodemailer');
const crypto = require('crypto');

// [POST] /api/auth/forgot-password
authRouter.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await UserAuthData.findOne({ email: email.toLowerCase() });

        if (!user) {
            // ส่ง success เสมอเพื่อความปลอดภัย ป้องกันการเดาอีเมลในระบบ
            return res.status(200).json({ message: 'หากอีเมลนี้มีอยู่ในระบบ ลิงก์สำหรับรีเซ็ตรหัสผ่านจะถูกส่งไปให้' });
        }

        // 1. สร้าง Token
        const token = crypto.randomBytes(20).toString('hex');
        
        // 2. ตั้งค่า Token และวันหมดอายุใน user document (อายุ 1 ชั่วโมง)
        user.passwordResetToken = token;
        user.passwordResetExpires = Date.now() + 3600000; // 1 hour
        await user.save();

        // 3. ส่งอีเมล
        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const clientBaseURL = process.env.clientBaseURL || 'http://127.0.0.1:5501';
        const resetURL = `${clientBaseURL}/reset-password.html?token=${token}`;

        const mailOptions = {
            to: user.email,
            from: `ล่าคูปอง <${process.env.EMAIL_USER}>`,
            subject: 'คำขอรีเซ็ตรหัสผ่าน',
            text: `คุณได้รับอีเมลนี้เนื่องจากมีการร้องขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ\n\n` +
                  `กรุณาคลิกลิงก์ต่อไปนี้ หรือคัดลอกไปวางในเบราว์เซอร์ของคุณเพื่อดำเนินการต่อ:\n\n` +
                  `${resetURL}\n\n` +
                  `หากคุณไม่ได้เป็นผู้ร้องขอ กรุณาไม่ต้องดำเนินการใดๆ และรหัสผ่านของคุณจะยังคงปลอดภัย\n`
        };

        await transporter.sendMail(mailOptions);
        
        res.status(200).json({ message: 'หากอีเมลนี้มีอยู่ในระบบ ลิงก์สำหรับรีเซ็ตรหัสผ่านจะถูกส่งไปให้' });

    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
    }
});

// [POST] /api/auth/reset-password/:token
authRouter.post('/reset-password/:token', async (req, res) => {
    try {
        const { password } = req.body;
        const user = await UserAuthData.findOne({
            passwordResetToken: req.params.token,
            passwordResetExpires: { $gt: Date.now() } // Check if token is not expired
        });

        if (!user) {
            return res.status(400).json({ message: 'Token สำหรับรีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว' });
        }

        // ตั้งรหัสผ่านใหม่ (pre-save hook จะทำการ hash ให้อัตโนมัติ)
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

// [POST] /api/auth/register
authRouter.post('/register', async (req, res) => {
    try {
        const { username, email, password, gender, ageRange, referral } = req.body;
        if (!username || !email || !password) return res.status(400).json({ message: "Username, email, and password are required." });
        let user = await UserAuthData.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] });
        if (user) return res.status(400).json({ message: 'User with this email or username already exists.' });
        user = new UserAuthData({ username, email, password, gender, ageRange, referral });
        await user.save();
        const newReport = new UserAuthReport({ userId: user._id });
        await newReport.save();
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ message: "Server error during registration." });
    }
});

// [POST] /api/auth/login
authRouter.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' });
        
        const user = await UserAuthData.findOne({ username: username.toLowerCase() });
        if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials.' });
        
        // [NEW] Update the lastLogin timestamp in the user's report
        await UserAuthReport.updateOne(
            { userId: user._id }, 
            { $set: { lastLogin: new Date() } }
        );
        
        const payload = { id: user._id, username: user.username };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '3s' });
        
        res.json({ success: true, token, user: { username: user.username } });
        
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// [GET] /api/auth/verify - Verify token and get user data
authRouter.get('/verify', authMiddleware, async (req, res) => {
    try {
        const user = await UserAuthData.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ success: true, user: { username: user.username } });
    } catch (error) {
        console.error("Verify Token Error:", error);
        res.status(500).json({ message: 'Server error during token verification' });
    }
});

app.use('/api/auth', authRouter);


// ========================================================
// --- EXISTING PUBLIC & VISITOR ROUTES ---
// ========================================================
app.get('/api/treasures', trackVisitor, countApiCall('appOpenCount'), async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/treasures', optionalAuthMiddleware, trackVisitor, countApiCall('treasuresCreatedCount'), async (req, res) => {
  try {
    const treasure = new Treasure({ ...req.body, remainingBoxes: req.body.totalBoxes });
    const newTreasure = await treasure.save();

    // --- ถ้า user ล็อกอินอยู่, อัปเดต report ของเขา ---
    if (req.user && req.user.id) {
        await UserAuthReport.updateOne(
            { userId: req.user.id },
            { $inc: { treasuresPlaced: 1 } },
            { upsert: true } // เพิ่ม option นี้เผื่อ report ยังไม่ถูกสร้าง
        );
    }

    res.status(201).json(newTreasure);
  } catch (err) { res.status(400).json({ message: err.message }); }
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
    
    // Step 3: If a user is logged in, update their personal claim stats.
    if (req.user && req.user.id) {
        await UserAuthReport.updateOne(
            { userId: req.user.id },
            { $inc: { treasuresClaimed: 1 } },
            { upsert: true } // Safely create a report if it doesn't exist for some reason.
        );
    }

    if (treasure.remainingBoxes <= 0) {
      console.log(`Treasure ID: ${treasure._id} is depleted. Preparing for deletion.`);
      
      // First, update the global completion stats.
      await ApiStat.findOneAndUpdate(
        { identifier: 'global-stats' }, 
        { 
          $inc: { treasuresCompletedCount: 1 }, 
          $set: { lastTreasureCompleted: new Date() } 
        }, 
        { upsert: true }
      );
      
      // Then, permanently delete the treasure document from the database.
      await Treasure.findByIdAndDelete(treasure._id);
      
      console.log(`Treasure ID: ${treasure._id} deleted successfully.`);
    }

    res.json(treasure);

  } catch (err) {
    // --- Enhanced Error Handling ---
    console.error(`Error processing claim for treasure ID: ${req.params.id}`, err);
    
    // Specifically handle Mongoose CastError for malformed ObjectIDs.
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'ID ของคูปองไม่ถูกต้อง' });
    }
    
    // For all other potential errors, send a generic server error message.
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบขณะพยายามใช้คูปอง' });
  }
});


app.post('/api/visitors/opened-app', optionalAuthMiddleware, async (req, res) => {
    try {
        // --- Part 1: Track visitor by IP (existing logic, always runs) ---
        const ip = req.ip;
        if (ip) {
            await Visitor.findOneAndUpdate(
                { ipAddress: ip }, 
                { $inc: { appOpenCount: 1 } }, 
                { upsert: true }
            );
        }

        // --- Part 2: If a user is logged in, update their report too ---
        if (req.user && req.user.id) {
            await UserAuthReport.updateOne(
                { userId: req.user.id },
                { 
                    $inc: { appOpenCount: 1 },
                    $set: { lastAppOpen: new Date() }
                }
            );
        }

        res.sendStatus(200); // Send success status
    } catch (error) {
        console.error('Error counting App Open:', error);
        res.sendStatus(500);
    }
});

app.patch('/api/visitors/log-time', async (req, res) => {
  try {
    const ip = req.ip;
    const { durationSeconds } = req.body;
    if (!ip || typeof durationSeconds !== 'number' || durationSeconds <= 0) return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
    await Visitor.findOneAndUpdate({ ipAddress: ip }, { $inc: { totalTimeOnPageSeconds: Math.round(durationSeconds) } });
    res.sendStatus(204);
  } catch (error) {
    console.error('Error logging time:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// [AUTH UPDATE] - สร้าง API ใหม่สำหรับบันทึกเวลาของ User ที่ล็อกอิน
// ใช้ authMiddleware (บังคับ) เพราะต้องรู้ว่าเป็น user คนไหน
app.patch('/api/users/log-time', authMiddleware, async (req, res) => {
    try {
        const { durationSeconds } = req.body;
        if (typeof durationSeconds !== 'number' || durationSeconds <= 0) {
            return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
        }
        
        // req.user.id มาจาก authMiddleware
        await UserAuthReport.updateOne(
            { userId: req.user.id },
            { $inc: { totalTimeOnPageSeconds: Math.round(durationSeconds) } }
        );
        
        res.sendStatus(204); // No Content
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

                // This part of your logic is good and remains the same
                if (hostname.includes('messenger.com')) { platform = 'Messenger'; domain = 'messenger.com'; } 
                else if (hostname.includes('facebook.com')) { platform = 'Facebook'; domain = 'facebook.com'; } 
                else if (hostname.includes('instagram.com')) { platform = 'Instagram'; domain = 'instagram.com'; } 
                else if (hostname.includes('tiktok.com')) { platform = 'TikTok'; domain = 'tiktok.com'; } 
                else if (hostname.includes('line.me')) { platform = 'LINE'; domain = 'line.me'; } 
                else if (hostname.includes('google.com')) { platform = 'Google'; domain = 'google.com'; } 
                else { platform = 'Other'; domain = hostname; }
                
            } catch (parseError) {
                // If the referrer is a string but NOT a valid URL,
                // we'll catch it here and fall back to 'direct'.
                console.warn(`Could not parse invalid referrer URL: "${referrer}"`);
            }
        }
        
        // Save the determined domain and platform to the database
        await ReferrerStat.findOneAndUpdate(
            { domain }, 
            { $inc: { count: 1 }, $setOnInsert: { platform } }, 
            { upsert: true }
        );

        res.sendStatus(200); // Send a success status

    } catch (error) {
        // This will now only catch database errors or other unexpected issues
        console.error('Error in /track-referrer route:', error);
        res.status(500).json({ message: 'Server error while tracking referrer.' });
    }
});


// ========================================================
// --- ADMIN ROUTES ---
// ========================================================
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await ApiStat.findOne({ identifier: 'global-stats' });
    res.json(stats || {});
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/admin/referrers', async (req, res) => {
    try {
        const stats = await ReferrerStat.find().sort({ count: -1 });
        res.json(stats);
    } catch (err) { res.status(500).json({ message: 'Server Error', error: err.message }); }
});

app.get('/api/admin/treasures', async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } }).select('_id placementDate name totalBoxes remainingBoxes').sort({ placementDate: -1 });
    res.json(treasures);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/admin/treasures/:id', async (req, res) => {
  try {
    const treasure = await Treasure.findById(req.params.id);
    if (!treasure) return res.status(404).json({ message: 'ไม่พบข้อมูลสมบัติตาม ID ที่ระบุ' });
    res.json(treasure);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/admin/visitors', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const visitors = await Visitor.find().sort({ lastVisit: -1 }).skip(skip).limit(limit);
    const totalVisitors = await Visitor.countDocuments();
    res.json({ data: visitors, pagination: { currentPage: page, totalPages: Math.ceil(totalVisitors / limit), totalVisitors } });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.delete('/api/admin/reset-data', async (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.ADMIN_RESET_PASSWORD) return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง' });
  try {
    const r1 = await Treasure.deleteMany({});
    const r2 = await ApiStat.deleteMany({});
    const r3 = await Visitor.deleteMany({});
    const r4 = await ReferrerStat.deleteMany({});
    // Also delete user data if resetting
    const r5 = await UserAuthData.deleteMany({});
    const r6 = await UserAuthReport.deleteMany({});
    res.json({ message: 'ล้างข้อมูลทั้งหมดในระบบสำเร็จ', results: { treasures: r1.deletedCount, stats: r2.deletedCount, visitors: r3.deletedCount, referrers: r4.deletedCount, users: r5.deletedCount, reports: r6.deletedCount }});
  } catch (err) { res.status(500).json({ message: 'เกิดข้อผิดพลาดระหว่างการล้างข้อมูล', error: err.message }); }
});


// ========================================================
// --- SERVER INITIALIZATION ---
// ========================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});