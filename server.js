const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();

// Middleware พื้นฐาน
app.use(cors());
app.use(bodyParser.json());


// --- เชื่อมต่อ MongoDB (ใช้เส้นเชื่อมต่อใหม่ตามที่คุณต้องการ) ---
const mongoURI = 'mongodb://mongo:lAYAnrVBCseEFNaQELuwLeyUfLdjrXCw@mainline.proxy.rlwy.net:59883';

mongoose.connect(mongoURI)
  .then(() => console.log('เชื่อมต่อ MongoDB Atlas สำเร็จ'))
  .catch(err => console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', err));


// --- Schema สำหรับ Treasure (โครงสร้างข้อมูลคูปอง) ---
// ส่วนนี้ยังคงเหมือนเดิม ไม่มีการเปลี่ยนแปลง
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

// สร้างโมเดลจาก Schema ของ Treasure
const Treasure = mongoose.model('Treasure', treasureSchema);


// --- Schema ใหม่สำหรับเก็บสถิติ (อัปเดตตามความต้องการใหม่) ---
const apiStatSchema = new mongoose.Schema({
  // ใช้ identifier เป็น 'global-stats' เพื่อให้มี document เดียวสำหรับเก็บสถิติทั้งหมด
  identifier: { type: String, default: 'global-stats', unique: true },

  // สถิติการเปิด/รีโหลดแอป (นับจากการเรียก GET /api/treasures)
  appOpenCount: { type: Number, default: 0 },
  
  // สถิติจำนวนสมบัติที่เคยสร้างขึ้นมาทั้งหมด (นับจากการเรียก POST /api/treasures)
  treasuresCreatedCount: { type: Number, default: 0 },
  
  // สถิติจำนวนครั้งที่สมบัติถูกเปิดหรือเก็บไป (นับจากการเรียก PATCH /api/treasures/:id)
  treasuresOpenedCount: { type: Number, default: 0 }
}, { timestamps: true }); // timestamps ทำให้เรารู้ว่ามีการอัปเดตสถิติล่าสุดเมื่อไหร่

// สร้างโมเดลจาก Schema ของ ApiStat
const ApiStat = mongoose.model('ApiStat', apiStatSchema);


// --- Middleware กลางสำหรับนับสถิติการเรียก API ---
// Middleware นี้ถูกออกแบบมาให้ใช้ซ้ำได้กับทุก API ที่เราต้องการนับ
const countApiCall = (counterName) => {
  return async (req, res, next) => {
    try {
      // ใช้ findOneAndUpdate และ upsert: true
      // คำสั่งนี้จะค้นหา document ที่มี identifier: 'global-stats'
      // - ถ้าเจอ: จะเพิ่มค่า ($inc) ใน field ที่ชื่อตรงกับ counterName ไป 1
      // - ถ้าไม่เจอ: จะสร้าง document ใหม่ขึ้นมา (upsert: true) พร้อมกับตั้งค่า counterName เป็น 1
      await ApiStat.findOneAndUpdate(
        { identifier: 'global-stats' },
        { $inc: { [counterName]: 1 } }, // [counterName] คือการใช้ชื่อ field แบบ dynamic ตามที่ส่งเข้ามา
        { upsert: true }
      );
      next(); // สั่งให้ Express ทำงานในลำดับถัดไป (ไปยัง route handler หลัก)
    } catch (err) {
      console.error('เกิดข้อผิดพลาดในการนับสถิติ API:', err);
      // ถึงแม้จะนับพลาด แต่เรายังต้องการให้ API หลักทำงานต่อไป
      next();
    }
  };
};


// ========================================================
// --- ส่วนของเส้นทาง API (Routes) ---
// ========================================================

// [GET] เเสดงคูปองทั้งหมด
// เพิ่ม Middleware 'countApiCall' เพื่อให้นับสถิติ 'appOpenCount' ทุกครั้งที่ถูกเรียก
app.get('/api/treasures', countApiCall('appOpenCount'), async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [POST] สร้างหรือวางคูปองใหม่
// เพิ่ม Middleware 'countApiCall' เพื่อให้นับสถิติ 'treasuresCreatedCount' ทุกครั้งที่ถูกเรียก
app.post('/api/treasures', countApiCall('treasuresCreatedCount'), async (req, res) => {
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
// เพิ่ม Middleware 'countApiCall' เพื่อให้นับสถิติ 'treasuresOpenedCount' ทุกครั้งที่ถูกเรียก
app.patch('/api/treasures/:id', countApiCall('treasuresOpenedCount'), async (req, res) => {
  try {
    const treasure = await Treasure.findByIdAndUpdate(
      req.params.id,
      { $inc: { remainingBoxes: -1 } }, // ลดจำนวนกล่องที่เหลือลง 1
      { new: true } // ให้ส่งข้อมูลที่อัปเดตแล้วกลับมา
    );
    
    if (!treasure) {
      return res.status(404).json({ message: 'ไม่พบคูปองนี้' });
    }

    // หากเปิดจนกล่องสุดท้ายหมด (remainingBoxes เป็น 0) ให้ลบข้อมูลคูปองนี้ทิ้ง
    if (treasure.remainingBoxes <= 0) {
      await Treasure.deleteOne({ _id: treasure._id });
    }

    res.json(treasure);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// [GET] API สำหรับดึงข้อมูลสถิติทั้งหมดมาดู (Optional)
// คุณสามารถเรียก API เส้นนี้เพื่อดูค่าสถิติทั้งหมดที่เก็บไว้ได้
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await ApiStat.findOne({ identifier: 'global-stats' });
        if (!stats) {
            // กรณีที่ยังไม่มีการเรียก API ใดๆ เลย และยังไม่มี document สถิติถูกสร้าง
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


// --- เริ่มการทำงานของเซิร์ฟเวอร์ ---
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
