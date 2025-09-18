const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const UAParser = require('ua-parser-js'); // <-- [เพิ่มใหม่] import library
require('dotenv').config();

const app = express();

// Middleware พื้นฐาน
app.use(cors());
app.use(bodyParser.json());
app.set('trust proxy', true); // <-- สำคัญ! เพื่อให้ req.ip ทำงานถูกต้องหลังบ้าน Proxy

// --- เชื่อมต่อ MongoDB ---
const mongoURI = 'mongodb://mongo:lAYAnrVBCseEFNaQELuwLeyUfLdjrXCw@mainline.proxy.rlwy.net:59883';

mongoose.connect(mongoURI)
  .then(() => console.log('เชื่อมต่อ MongoDB Atlas สำเร็จ'))
  .catch(err => console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', err));


// ========================================================
// --- Schemas & Models ---
// ========================================================

// --- Schema สำหรับ Treasure (คงเดิม) ---
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
const Treasure = mongoose.model('Treasure', treasureSchema);

// --- Schema สำหรับเก็บสถิติรวม (คงเดิม) ---
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
const ApiStat = mongoose.model('ApiStat', apiStatSchema);

// --- [เพิ่มใหม่] Schema สำหรับเก็บข้อมูลผู้เข้าชม (Visitor) แยกตาม IP ---
const visitorSchema = new mongoose.Schema({
  ipAddress: { type: String, required: true, unique: true, index: true },
  userAgent: { type: String },
  deviceInfo: {
    browser: { name: String, version: String },
    os: { name: String, version: String },
    device: { vendor: String, model: String, type: String } // mobile, tablet, desktop
  },
  visitCount: { type: Number, default: 0 },
  firstVisit: { type: Date, default: Date.now },
  lastVisit: { type: Date, default: Date.now },
  totalTimeOnPageSeconds: { type: Number, default: 0 },
  appOpenCount: { type: Number, default: 0 }, // จำนวนครั้งที่เปิดเว็บ
  treasuresCreatedCount: { type: Number, default: 0 }, // จำนวนครั้งที่สร้างคูปอง
  treasuresOpenedCount: { type: Number, default: 0 }, // จำนวนครั้งที่เปิดคูปอง
});
const Visitor = mongoose.model('Visitor', visitorSchema);

// --- [เพิ่มใหม่] Schema สำหรับเก็บสถิติแหล่งที่มา (Referrer) ---
const referrerStatSchema = new mongoose.Schema({
    domain: { type: String, required: true, unique: true, index: true }, // เช่น 'facebook.com', 'instagram.com', 'direct'
    platform: { type: String, required: true }, // ชื่อที่อ่านง่าย เช่น 'Facebook', 'Instagram', 'Direct/Unknown'
    count: { type: Number, default: 0 }
});
const ReferrerStat = mongoose.model('ReferrerStat', referrerStatSchema);
// ========================================================
// --- Middlewares ---
// ========================================================

// --- Middleware สำหรับนับสถิติรวม (คงเดิม) ---
const countApiCall = (counterName) => {
  return async (req, res, next) => {
    try {
      const updateOperation = { $inc: { [counterName]: 1 } };
      if (counterName === 'appOpenCount') {
        updateOperation.$set = { lastAppOpen: new Date() };
      } else if (counterName === 'treasuresCreatedCount') {
        updateOperation.$set = { lastTreasureCreated: new Date() };
      } else if (counterName === 'treasuresOpenedCount') {
        updateOperation.$set = { lastTreasureOpened: new Date() };
      }
      await ApiStat.findOneAndUpdate({ identifier: 'global-stats' }, updateOperation, { upsert: true });
      next();
    } catch (err) {
      console.error('เกิดข้อผิดพลาดในการนับสถิติ API:', err);
      next();
    }
  };
};

// --- [เพิ่มใหม่] Middleware สำหรับติดตามข้อมูล Visitor ---
// --- [อัปเดต] Middleware สำหรับติดตามข้อมูล Visitor ---
const trackVisitor = async (req, res, next) => {
    try {
        const ip = req.ip;
        if (!ip) return next();

        const uaString = req.headers['user-agent'];
        const parser = new UAParser(uaString);
        const uaResult = parser.getResult();

        // สร้าง Object สำหรับอัปเดตข้อมูลพื้นฐาน
        const updateOperation = {
            $set: {
                userAgent: uaString,
                deviceInfo: {
                    browser: uaResult.browser,
                    os: uaResult.os,
                    device: uaResult.device,
                },
                lastVisit: new Date()
            },
            $inc: { visitCount: 1 },
            $setOnInsert: { firstVisit: new Date() },
        };

        // --- ตรวจสอบเงื่อนไขเพื่อเพิ่ม counter ---
        const path = req.originalUrl;
        const method = req.method;

        if (method === 'POST' && path === '/api/treasures') {
            updateOperation.$inc.treasuresCreatedCount = 1;
        } else if (method === 'PATCH' && path.startsWith('/api/treasures/')) {
            updateOperation.$inc.treasuresOpenedCount = 1;
        }

        await Visitor.findOneAndUpdate(
            { ipAddress: ip },
            updateOperation,
            { upsert: true }
        );

    } catch (error) {
        console.error('เกิดข้อผิดพลาดใน Middleware trackVisitor:', error);
    }
    next();
};


// ========================================================
// --- ส่วนของเส้นทาง API (Routes) สำหรับ User ---
// ========================================================

// [GET] เเสดงคูปองทั้งหมด
// [อัปเดต] เพิ่ม middleware 'trackVisitor' เข้าไป
app.get('/api/treasures', trackVisitor, countApiCall('appOpenCount'), async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [POST] สร้างหรือวางคูปองใหม่
// [อัปเดต] เพิ่ม middleware 'trackVisitor' เข้าไป
app.post('/api/treasures', trackVisitor, countApiCall('treasuresCreatedCount'), async (req, res) => {
  try {
    const treasure = new Treasure({ ...req.body, remainingBoxes: req.body.totalBoxes });
    const newTreasure = await treasure.save();
    res.status(201).json(newTreasure);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// [เพิ่มใหม่] POST /api/visitors/opened-app - สำหรับนับจำนวนครั้งที่เปิดเว็บ
app.post('/api/visitors/opened-app', async (req, res) => {
    try {
        const ip = req.ip;
        if (!ip) return res.sendStatus(400);

        // หา visitor ตาม IP แล้วเพิ่มค่า appOpenCount ไป 1
        // ใช้ upsert: true เพื่อกรณีที่ user เข้ามาครั้งแรกสุด จะได้สร้าง document ใหม่ให้เลย
        await Visitor.findOneAndUpdate(
            { ipAddress: ip },
            { $inc: { appOpenCount: 1 } },
            { upsert: true }
        );

        res.sendStatus(200); // ส่งแค่สถานะ OK กลับไป
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการนับ App Open:', error);
        res.sendStatus(500);
    }
});

// [PATCH] อัปเดตเมื่อผู้ใช้เปิดสมบัติ (ลดจำนวนคูปอง)
// [อัปเดต] เพิ่ม middleware 'trackVisitor' เข้าไป
app.patch('/api/treasures/:id', trackVisitor, countApiCall('treasuresOpenedCount'), async (req, res) => {
  try {
    const treasure = await Treasure.findByIdAndUpdate(
      req.params.id, { $inc: { remainingBoxes: -1 } }, { new: true }
    );
    if (!treasure) return res.status(404).json({ message: 'ไม่พบคูปองนี้' });
    if (treasure.remainingBoxes <= 0) {
      await ApiStat.findOneAndUpdate(
        { identifier: 'global-stats' },
        { $inc: { treasuresCompletedCount: 1 }, $set: { lastTreasureCompleted: new Date() } },
        { upsert: true }
      );
      await Treasure.deleteOne({ _id: treasure._id });
    }
    res.json(treasure);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [GET] API สำหรับดึงข้อมูลสถิติรวม (Admin)
app.get('/api/stats', async (req, res) => {
  try {
    let stats = await ApiStat.findOne({ identifier: 'global-stats' });
    if (!stats) {
      stats = {
        appOpenCount: 0, treasuresCreatedCount: 0, treasuresOpenedCount: 0, treasuresCompletedCount: 0,
        lastAppOpen: null, lastTreasureCreated: null, lastTreasureOpened: null, lastTreasureCompleted: null
      };
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [เพิ่มใหม่] POST /api/stats/track-referrer - รับข้อมูลแหล่งที่มา
app.post('/api/stats/track-referrer', async (req, res) => {
    try {
        const { referrer } = req.body;
        let platform = 'Direct/Unknown';
        let domain = 'direct';

        if (referrer) {
            const url = new URL(referrer);
            const hostname = url.hostname.replace(/^www\./, ''); // เอา www. ออก

            // [แก้ไข] ย้าย Messenger ขึ้นมาตรวจสอบก่อน Facebook
            if (hostname.includes('messenger.com') || url.pathname.includes('/messages/')) {
                platform = 'Messenger';
                domain = 'messenger.com';
            } else if (hostname.includes('facebook.com') || hostname.includes('m.facebook.com')) {
                platform = 'Facebook';
                domain = 'facebook.com';
            } else if (hostname.includes('instagram.com')) {
                platform = 'Instagram';
                domain = 'instagram.com';
            } else if (hostname.includes('tiktok.com')) {
                platform = 'TikTok';
                domain = 'tiktok.com';
            } else if (hostname.includes('line.me')) {
                platform = 'LINE';
                domain = 'line.me';
            } else if (hostname.includes('google.com')) {
                platform = 'Google';
                domain = 'google.com';
            } else {
                platform = 'Other';
                domain = hostname;
            }
        }

        // ใช้ findOneAndUpdate + upsert เพื่อเพิ่ม count หรือสร้างใหม่
        await ReferrerStat.findOneAndUpdate(
            { domain: domain },
            { $inc: { count: 1 }, $setOnInsert: { platform: platform } },
            { upsert: true }
        );

        res.sendStatus(200);

    } catch (error) {
        // ไม่ต้อง log error ที่เกิดจากการ parse URL ที่ไม่ถูกต้อง
        if (error instanceof TypeError && error.message.includes('Invalid URL')) {
             return res.status(400).json({ message: 'Invalid referrer URL' });
        }
        console.error('เกิดข้อผิดพลาดในการ track referrer:', error);
        res.sendStatus(500);
    }
});

// [เพิ่มใหม่] GET /api/admin/referrers - ดึงข้อมูลสถิติแหล่งที่มาทั้งหมด
app.get('/api/admin/referrers', async (req, res) => {
    try {
        const stats = await ReferrerStat.find().sort({ count: -1 });
        res.json(stats);
    } catch (err) {
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
});

// [เพิ่มใหม่] PATCH /api/visitors/log-time - รับข้อมูลเวลาที่ผู้ใช้อยู่บนหน้าเว็บ
app.patch('/api/visitors/log-time', async (req, res) => {
  try {
    const ip = req.ip;
    const { durationSeconds } = req.body;

    // ตรวจสอบข้อมูลเบื้องต้น
    if (!ip || typeof durationSeconds !== 'number' || durationSeconds <= 0) {
      return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
    }

    // อัปเดตเฉพาะ visitor ที่มีอยู่แล้วเท่านั้น (ไม่สร้างใหม่)
    // ใช้ $inc เพื่อเพิ่มเวลาเข้าไปในค่าที่มีอยู่เดิม
    const result = await Visitor.findOneAndUpdate(
      { ipAddress: ip },
      { $inc: { totalTimeOnPageSeconds: Math.round(durationSeconds) } }
    );

    if (!result) {
      // ไม่พบ visitor นี้ (อาจเกิดจาก bot หรือการเข้าชมที่สั้นมาก)
      return res.status(404).json({ message: 'ไม่พบ Visitor' });
    }

    // ส่ง 204 No Content หมายถึงสำเร็จแต่ไม่มีข้อมูลส่งกลับ
    res.sendStatus(204);

  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการบันทึกเวลา:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});


// ========================================================
// --- ส่วนของ API สำหรับ Admin (ไม่นับสถิติ) ---
// ========================================================

// [GET] /api/admin/treasures - ดึงข้อมูลสมบัติที่ยังเหลืออยู่ทั้งหมด
app.get('/api/admin/treasures', async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } })
      .select('_id placementDate name totalBoxes remainingBoxes').sort({ placementDate: -1 });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [GET] /api/admin/treasures/{id} - ดึงข้อมูลสมบัติชิ้นเดียว
app.get('/api/admin/treasures/:id', async (req, res) => {
  try {
    const treasure = await Treasure.findById(req.params.id);
    if (!treasure) return res.status(404).json({ message: 'ไม่พบข้อมูลสมบัติตาม ID ที่ระบุ' });
    res.json(treasure);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [เพิ่มใหม่] GET /api/admin/visitors - ดึงข้อมูลผู้เข้าชมทั้งหมดพร้อมแบ่งหน้า
app.get('/api/admin/visitors', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const visitors = await Visitor.find()
      .sort({ lastVisit: -1 }) // เรียงจากคนที่เข้าชมล่าสุด
      .skip(skip)
      .limit(limit);

    const totalVisitors = await Visitor.countDocuments();

    res.json({
      data: visitors,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalVisitors / limit),
        totalVisitors: totalVisitors
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// [DELETE] /api/admin/reset-data - ล้างข้อมูลทั้งหมดในระบบ (ต้องใช้รหัสผ่าน)
app.delete('/api/admin/reset-data', async (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_RESET_PASSWORD;

  if (!password || password !== adminPassword) {
    return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง ไม่ได้รับอนุญาตให้ดำเนินการ' });
  }

  try {
    const treasureDeletionResult = await Treasure.deleteMany({});
    const statDeletionResult = await ApiStat.deleteMany({});
    const visitorDeletionResult = await Visitor.deleteMany({}); // <-- [เพิ่มใหม่] ลบข้อมูล Visitor ด้วย
    const referrerDeletionResult = await ReferrerStat.deleteMany({});

    res.json({
      message: 'ล้างข้อมูลทั้งหมดในระบบสำเร็จ',
      treasuresDeleted: treasureDeletionResult.deletedCount,
      statsDeleted: statDeletionResult.deletedCount,
      visitorsDeleted: visitorDeletionResult.deletedCount, // <-- [เพิ่มใหม่] แจ้งผลการลบ
      referrersDeleted: referrerDeletionResult.deletedCount
    });

  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดระหว่างการล้างข้อมูล', error: err.message });
  }
});


// --- เริ่มการทำงานของเซิร์ฟเวอร์ ---
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});