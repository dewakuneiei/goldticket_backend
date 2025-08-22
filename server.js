const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config(); // <-- เพิ่มเข้ามาเพื่อโหลดไฟล์ .env

const app = express();

// Middleware พื้นฐาน
app.use(cors());
app.use(bodyParser.json());

// --- เชื่อมต่อ MongoDB ---
const mongoURI = 'mongodb://mongo:lAYAnrVBCseEFNaQELuwLeyUfLdjrXCw@mainline.proxy.rlwy.net:59883';

mongoose.connect(mongoURI)
.then(() => console.log('เชื่อมต่อ MongoDB Atlas สำเร็จ'))
.catch(err => console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', err));

// --- Schema สำหรับ Treasure (โครงสร้างข้อมูลคูปอง) ---
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

// --- Schema สำหรับเก็บสถิติ (อัปเดตล่าสุด) ---
const apiStatSchema = new mongoose.Schema({
  identifier: { type: String, default: 'global-stats', unique: true },
  appOpenCount: { type: Number, default: 0 },
  treasuresCreatedCount: { type: Number, default: 0 },
  treasuresOpenedCount: { type: Number, default: 0 },
  treasuresCompletedCount: { type: Number, default: 0 }, // <-- [เพิ่มใหม่] สถิติจำนวนกล่องที่ถูกใช้จนหมด
  lastAppOpen: { type: Date },
  lastTreasureCreated: { type: Date },
  lastTreasureOpened: { type: Date },
  lastTreasureCompleted: { type: Date } // <-- [เพิ่มใหม่] เวลาล่าสุดที่กล่องถูกใช้จนหมด
});

const ApiStat = mongoose.model('ApiStat', apiStatSchema);

// --- Middleware กลางสำหรับนับสถิติการเรียก API ---
const countApiCall = (counterName) => {
  return async (req, res, next) => {
    try {
      const updateOperation = {
        $inc: { [counterName]: 1 }
      };

      if (counterName === 'appOpenCount') {
        updateOperation.$set = { lastAppOpen: new Date() };
      } else if (counterName === 'treasuresCreatedCount') {
        updateOperation.$set = { lastTreasureCreated: new Date() };
      } else if (counterName === 'treasuresOpenedCount') {
        updateOperation.$set = { lastTreasureOpened: new Date() };
      }

      await ApiStat.findOneAndUpdate(
        { identifier: 'global-stats' },
        updateOperation,
        { upsert: true }
      );

      next();
    } catch (err) {
      console.error('เกิดข้อผิดพลาดในการนับสถิติ API:', err);
      next();
    }
  };
};

// ========================================================
// --- ส่วนของเส้นทาง API (Routes) สำหรับ User ---
// ========================================================

// [GET] เเสดงคูปองทั้งหมด
app.get('/api/treasures', countApiCall('appOpenCount'), async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [POST] สร้างหรือวางคูปองใหม่
app.post('/api/treasures', countApiCall('treasuresCreatedCount'), async (req, res) => {
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

// [PATCH] อัปเดตเมื่อผู้ใช้เปิดสมบัติ (ลดจำนวนคูปอง)
app.patch('/api/treasures/:id', countApiCall('treasuresOpenedCount'), async (req, res) => {
  try {
    const treasure = await Treasure.findByIdAndUpdate(
      req.params.id,
      { $inc: { remainingBoxes: -1 } },
      { new: true }
    );

    if (!treasure) {
      return res.status(404).json({ message: 'ไม่พบคูปองนี้' });
    }

    // หากเปิดจนกล่องสุดท้ายหมด (remainingBoxes เป็น 0)
    if (treasure.remainingBoxes <= 0) {
      // [อัปเดต] นับสถิติว่ามีกล่องถูกใช้จนหมด 1 กล่อง
      await ApiStat.findOneAndUpdate(
        { identifier: 'global-stats' },
        {
          $inc: { treasuresCompletedCount: 1 },
          $set: { lastTreasureCompleted: new Date() }
        },
        { upsert: true }
      );
      // จากนั้นจึงลบข้อมูลคูปองนี้ทิ้ง
      await Treasure.deleteOne({ _id: treasure._id });
    }

    res.json(treasure);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [GET] API สำหรับดึงข้อมูลสถิติทั้งหมดมาดู
app.get('/api/stats', async (req, res) => {
  try {
    let stats = await ApiStat.findOne({ identifier: 'global-stats' });
    if (!stats) {
      // ถ้ายังไม่มี document สถิติ ให้ส่งค่า default กลับไป
      stats = {
        appOpenCount: 0,
        treasuresCreatedCount: 0,
        treasuresOpenedCount: 0,
        treasuresCompletedCount: 0,
        lastAppOpen: null,
        lastTreasureCreated: null,
        lastTreasureOpened: null,
        lastTreasureCompleted: null
      };
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========================================================
// --- ส่วนของ API สำหรับ Admin (ไม่นับสถิติ) ---
// ========================================================

// [GET] /api/admin/treasures - ดึงข้อมูลสมบัติที่ยังเหลืออยู่ทั้งหมด
app.get('/api/admin/treasures', async (req, res) => {
    try {
      // [อัปเดต] แก้ไขให้แสดงเฉพาะกล่องที่ยังเหลืออยู่เท่านั้น
      const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } })
        .select('_id placementDate name totalBoxes remainingBoxes')
        .sort({ placementDate: -1 });

      res.json(treasures);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
});

// [GET] /api/admin/treasures/{id} - ดึงข้อมูลสมบัติชิ้นเดียว
app.get('/api/admin/treasures/:id', async (req, res) => {
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

// [DELETE] /api/admin/reset-data - ล้างข้อมูลทั้งหมดในระบบ (ต้องใช้รหัสผ่าน)
app.delete('/api/admin/reset-data', async (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_RESET_PASSWORD;

    // ตรวจสอบว่ามีรหัสผ่านส่งมาหรือไม่ และตรงกับใน .env หรือเปล่า
    if (!password || password !== adminPassword) {
        return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง ไม่ได้รับอนุญาตให้ดำเนินการ' });
    }

    try {
        // ลบข้อมูลสมบัติทั้งหมด
        const treasureDeletionResult = await Treasure.deleteMany({});
        // ลบข้อมูลสถิติ
        const statDeletionResult = await ApiStat.findOneAndDelete({ identifier: 'global-stats' });

        res.json({
            message: 'ล้างข้อมูลทั้งหมดในระบบสำเร็จ',
            treasuresDeleted: treasureDeletionResult.deletedCount,
            statsDeleted: statDeletionResult ? 1 : 0
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
