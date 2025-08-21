const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();

// Middleware พื้นฐาน
app.use(cors());
app.use(bodyParser.json());

// --- [เพิ่มใหม่] ตั้งค่า Trust Proxy ---
// สำคัญมากสำหรับ Railway/Heroku หรือแพลตฟอร์มอื่น ๆ ที่มี Reverse Proxy
// เพื่อให้ req.ip สามารถดึง IP ที่แท้จริงของผู้ใช้ได้จาก header 'X-Forwarded-For'
app.set('trust proxy', 1);


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


// --- Schema สำหรับสถิติรวม (Global Stats) ---
// ส่วนนี้ยังคงเหมือนเดิม
const apiStatSchema = new mongoose.Schema({
  identifier: { type: String, default: 'global-stats', unique: true },
  appOpenCount: { type: Number, default: 0 },
  treasuresCreatedCount: { type: Number, default: 0 },
  treasuresOpenedCount: { type: Number, default: 0 }
}, { timestamps: true });

const ApiStat = mongoose.model('ApiStat', apiStatSchema);


// --- [เพิ่มใหม่] Schema สำหรับเก็บสถิติตาม IP Address ---
const ipStatSchema = new mongoose.Schema({
    // IP Address ของผู้ใช้ จะเป็น unique key
    ipAddress: { type: String, required: true, unique: true },

    // สถิติการเปิด/รีโหลดแอป (นับจากการเรียก GET /api/treasures)
    appOpenCount: { type: Number, default: 0 },
    
    // สถิติจำนวนสมบัติที่เคยสร้าง (นับจากการเรียก POST /api/treasures)
    treasuresCreatedCount: { type: Number, default: 0 },
    
    // สถิติจำนวนครั้งที่เปิดสมบัติ (นับจากการเรียก PATCH /api/treasures/:id)
    treasuresOpenedCount: { type: Number, default: 0 }
}, { timestamps: true }); // timestamps: true จะสร้าง field `createdAt` และ `updatedAt` อัตโนมัติ

// สร้างโมเดลจาก Schema ของ IpStat
const IpStat = mongoose.model('IpStat', ipStatSchema);


// --- Middleware สำหรับนับสถิติรวม (Global Stats) ---
// ส่วนนี้ยังคงเหมือนเดิม
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
      console.error('เกิดข้อผิดพลาดในการนับสถิติ API (Global):', err);
      next();
    }
  };
};

// --- [เพิ่มใหม่] Middleware กลางสำหรับเก็บสถิติตาม IP ---
const trackIpStat = (counterName) => {
    return async (req, res, next) => {
        const ip = req.ip; // ดึง IP address (ทำงานได้ถูกต้องเพราะเราตั้ง `app.set('trust proxy', 1)`)

        if (!ip) {
            // หากไม่พบ IP ให้ข้ามไป
            return next();
        }

        try {
            // ใช้ findOneAndUpdate และ upsert: true
            // - ถ้าเจอ IP นี้ในระบบ: จะเพิ่มค่า ($inc) ใน field ที่ชื่อตรงกับ counterName
            // - ถ้าไม่เจอ: จะสร้าง document ใหม่ (upsert: true) พร้อมกับตั้งค่าเริ่มต้น และตั้งค่า counterName เป็น 1
            await IpStat.findOneAndUpdate(
                { ipAddress: ip },
                { $inc: { [counterName]: 1 } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            next();
        } catch (err) {
            console.error(`เกิดข้อผิดพลาดในการนับสถิติสำหรับ IP ${ip}:`, err);
            // แม้จะนับพลาด แต่เรายังต้องการให้ API หลักทำงานต่อไป
            next();
        }
    };
};


// ========================================================
// --- ส่วนของเส้นทาง API (Routes) ---
// ========================================================

// [GET] เเสดงคูปองทั้งหมด
// เพิ่ม Middleware 'trackIpStat' เพื่อติดตาม IP นี้ด้วย
app.get('/api/treasures', countApiCall('appOpenCount'), trackIpStat('appOpenCount'), async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [POST] สร้างหรือวางคูปองใหม่
// เพิ่ม Middleware 'trackIpStat' เพื่อติดตาม IP นี้ด้วย
app.post('/api/treasures', countApiCall('treasuresCreatedCount'), trackIpStat('treasuresCreatedCount'), async (req, res) => {
  try {
    console.log("✅ API สร้างคูปอง (/api/treasures) ถูกเรียกแล้ว");
    console.log("ข้อมูลที่ได้รับ:", req.body);
    
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

// [PATCH] อัปเดตเมื่อผู้ใช้เปิดสมบัติ (ลดจำนวนคูปอง)
// เพิ่ม Middleware 'trackIpStat' เพื่อติดตาม IP นี้ด้วย
app.patch('/api/treasures/:id', countApiCall('treasuresOpenedCount'), trackIpStat('treasuresOpenedCount'), async (req, res) => {
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


// [GET] API สำหรับดึงข้อมูลสถิติรวมทั้งหมด
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await ApiStat.findOne({ identifier: 'global-stats' });
        if (!stats) {
            return res.json({
                appOpenCount: 0,
                treasuresCreatedCount: 0,
                treasuresOpenedCount: 0
            });
        }
        res.json(stats);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// --- [เพิ่มใหม่] API สำหรับดึงข้อมูลสถิติตาม IP ทั้งหมด ---
// Endpoint นี้จะแสดงข้อมูลทั้งหมดที่เก็บจากทุก IP
app.get('/api/ip-stats', async (req, res) => {
    try {
        // ดึงข้อมูล IP ทั้งหมด และเรียงลำดับจาก `updatedAt` (เข้ามาล่าสุด) ไปเก่าสุด
        const ipStats = await IpStat.find({}).sort({ updatedAt: -1 });
        const totalUniqueIps = await IpStat.countDocuments();
        
        res.json({
            totalUniqueIps,
            data: ipStats
        });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// --- เริ่มการทำงานของเซิร์ฟเวอร์ ---
const PORT = process.env.PORT || 3001; // Railway จะกำหนด PORT ผ่าน environment variable
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});