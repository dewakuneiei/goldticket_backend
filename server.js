const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();

// Middleware พื้นฐาน
app.use(cors());
app.use(bodyParser.json());

// เปิดใช้งาน trust proxy เพื่อให้ Express อ่าน IP จาก header 'x-forwarded-for' ได้อย่างถูกต้อง
// สำคัญมากเมื่อ deploy บนแพลตฟอร์มอย่าง Railway, Heroku, etc.
app.set('trust proxy', true);


// --- เชื่อมต่อ MongoDB ---
const mongoURI = 'mongodb://mongo:lAYAnrVBCseEFNaQELuwLeyUfLdjrXCw@mainline.proxy.rlwy.net:59883';

mongoose.connect(mongoURI)
  .then(() => console.log('เชื่อมต่อ MongoDB Atlas สำเร็จ'))
  .catch(err => console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', err));


// --- Schema สำหรับ Treasure (โครงสร้างข้อมูลคูปอง) ---
// ส่วนนี้ยังคงเหมือนเดิม
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


// --- Schema สำหรับเก็บสถิติรวม (Global Stats) ---
// ส่วนนี้ยังคงเหมือนเดิม
const apiStatSchema = new mongoose.Schema({
  identifier: { type: String, default: 'global-stats', unique: true },
  appOpenCount: { type: Number, default: 0 },
  treasuresCreatedCount: { type: Number, default: 0 },
  treasuresOpenedCount: { type: Number, default: 0 }
}, { timestamps: true });

const ApiStat = mongoose.model('ApiStat', apiStatSchema);


// --- [ใหม่] Schema สำหรับเก็บสถิติแยกตาม IP Address ---
const ipStatSchema = new mongoose.Schema({
  // ใช้ ipAddress เป็น key หลักที่ไม่ซ้ำกัน
  ipAddress: { type: String, required: true, unique: true },
  
  // จำนวนครั้งที่ IP นี้เรียกดูคูปองทั้งหมด (GET)
  viewCount: { type: Number, default: 0 },
  
  // จำนวนครั้งที่ IP นี้สร้างคูปอง (POST)
  createCount: { type: Number, default: 0 },
  
  // จำนวนครั้งที่ IP นี้เปิดสมบัติ/ทำภารกิจ (PATCH)
  openCount: { type: Number, default: 0 },
}, { timestamps: true }); // timestamps ช่วยให้รู้ว่าเจอ IP นี้ครั้งแรกและครั้งล่าสุดเมื่อไหร่

const IpStat = mongoose.model('IpStat', ipStatSchema);


// --- Middleware สำหรับนับสถิติรวม (Global Stats) ---
// Middleware ตัวนี้ยังทำงานเหมือนเดิม
const countApiCall = (counterName) => {
  return async (req, res, next) => {
    try {
      await ApiStat.findOneAndUpdate(
        { identifier: 'global-stats' },
        { $inc: { [counterName]: 1 } },
        { upsert: true }
      );
      next();
    } catch (err) {
      console.error('เกิดข้อผิดพลาดในการนับสถิติรวม:', err);
      next();
    }
  };
};

// --- [ใหม่] Middleware สำหรับนับสถิติแยกตาม IP Address ---
const trackIpStats = (counterName) => {
  return async (req, res, next) => {
    try {
      // ดึง IP Address จาก request
      // req.ip จะดึงค่าจาก 'x-forwarded-for' โดยอัตโนมัติเพราะเราตั้งค่า app.set('trust proxy', true)
      const ip = req.ip;

      if (ip) {
        // ค้นหา document ของ IP นี้ ถ้าไม่เจอก็สร้างใหม่ (upsert: true)
        // แล้วเพิ่มค่า ($inc) ใน field ที่ระบุ (เช่น 'viewCount', 'createCount')
        await IpStat.findOneAndUpdate(
          { ipAddress: ip },
          { $inc: { [counterName]: 1 } },
          { upsert: true, new: true }
        );
      }
      next();
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในการนับสถิติ IP (${req.ip}):`, err);
      next(); // ให้ระบบทำงานต่อไปแม้จะเกิดข้อผิดพลาด
    }
  };
};


// ========================================================
// --- ส่วนของเส้นทาง API (Routes) ที่อัปเดตแล้ว ---
// ========================================================

// [GET] เเสดงคูปองทั้งหมด
// เราใส่ Middleware 2 ตัว: ตัวแรกนับสถิติรวม, ตัวที่สองนับสถิติของ IP
app.get('/api/treasures', countApiCall('appOpenCount'), trackIpStats('viewCount'), async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [POST] สร้างหรือวางคูปองใหม่
app.post('/api/treasures', countApiCall('treasuresCreatedCount'), trackIpStats('createCount'), async (req, res) => {
  try {
    const treasure = new Treasure({
      ...req.body,
      remainingBoxes: req.body.totalBoxes
    });
    const newTreasure = await treasure.save();
    res.status(201).json(newTreasure);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// [PATCH] อัปเดตเมื่อผู้ใช้เปิดสมบัติ
app.patch('/api/treasures/:id', countApiCall('treasuresOpenedCount'), trackIpStats('openCount'), async (req, res) => {
  try {
    const treasure = await Treasure.findByIdAndUpdate(
      req.params.id,
      { $inc: { remainingBoxes: -1 } },
      { new: true }
    );
    if (!treasure) {
      return res.status(404).json({ message: 'ไม่พบคูปองนี้' });
    }
    if (treasure.remainingBoxes <= 0) {
      await Treasure.deleteOne({ _id: treasure._id });
    }
    res.json(treasure);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// [GET] API สำหรับดึงข้อมูลสถิติรวม
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await ApiStat.findOne({ identifier: 'global-stats' });
        res.json(stats || { appOpenCount: 0, treasuresCreatedCount: 0, treasuresOpenedCount: 0 });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// [GET] [ใหม่] API สำหรับดึงข้อมูลสถิติทั้งหมดที่แยกตาม IP
app.get('/api/stats/ip', async (req, res) => {
    try {
        // ดึงข้อมูล IP ทั้งหมด และเรียงลำดับตามข้อมูลที่อัปเดตล่าสุด
        const ipStats = await IpStat.find({}).sort({ updatedAt: -1 });
        res.json(ipStats);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// --- เริ่มการทำงานของเซิร์ฟเวอร์ ---
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
