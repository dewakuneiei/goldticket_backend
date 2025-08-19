const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// --- อัปเดตเส้นเชื่อมต่อ MongoDB ---
const mongoURI = 'mongodb://mongo:lAYAnrVBCseEFNaQELuwLeyUfLdjrXCw@mainline.proxy.rlwy.net:59883';

mongoose.connect(mongoURI)
  .then(() => console.log('เชื่อมต่อ MongoDB Atlas สำเร็จ'))
  .catch(err => console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', err));

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

// --- Schema ใหม่สำหรับเก็บสถิติการเรียก API ---
const apiStatSchema = new mongoose.Schema({
  // ใช้ unique: true เพื่อให้มี document เดียวสำหรับเก็บสถิติทั้งหมด
  identifier: { type: String, default: 'global-stats', unique: true },
  getTreasuresCount: { type: Number, default: 0 }, // นับการเรียก GET /api/treasures
  createTreasureCount: { type: Number, default: 0 }  // นับการเรียก POST /api/treasures
}, { timestamps: true }); // timestamps เพื่อดูว่ามีการอัปเดตล่าสุดเมื่อไหร่ (optional)

const ApiStat = mongoose.model('ApiStat', apiStatSchema);


// --- Middleware สำหรับนับการเรียก API ---
const countApiCall = (counterName) => {
  return async (req, res, next) => {
    try {
      // ใช้ findOneAndUpdate และ upsert: true
      // เพื่อสร้าง document หากยังไม่มี หรืออัปเดตถ้ามีอยู่แล้ว
      await ApiStat.findOneAndUpdate(
        { identifier: 'global-stats' },
        { $inc: { [counterName]: 1 } }, // [counterName] คือการใช้ชื่อ field แบบ dynamic
        { upsert: true, new: true }
      );
      next(); // ไปยัง middleware หรือ route handler ถัดไป
    } catch (err) {
      console.error('เกิดข้อผิดพลาดในการนับ API:', err);
      // แม้จะนับพลาด ก็ยังให้ API ทำงานต่อไป
      next();
    }
  };
};


// --- เส้นทาง API ที่อัปเดตแล้ว ---

// เเสดงคูปอง (เพิ่ม Middleware เพื่อนับ)
app.get('/api/treasures', countApiCall('getTreasuresCount'), async (req, res) => {
  try {
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// วางคูปอง (เพิ่ม Middleware เพื่อนับ)
app.post('/api/treasures', countApiCall('createTreasureCount'), async (req, res) => {
  try {
    console.log("✅ API /api/treasures ถูกเรียกแล้ว");
    console.log("Received body:", req.body);
    
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

// API อัปเดตเมื่อเปิดสมบัติ (คงเดิม)
app.patch('/api/treasures/:id', async (req, res) => {
  try {
    const treasure = await Treasure.findByIdAndUpdate(
      req.params.id,
      { $inc: { remainingBoxes: -1 } },
      { new: true }
    );
    
    if (!treasure) {
      return res.status(404).json({ message: 'ไม่พบคูปองนี้' });
    }

    if (treasure.remainingBoxes === 0) {
      await Treasure.deleteOne({ _id: treasure._id });
    }

    res.json(treasure);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- API สำหรับดึงข้อมูลสถิติ (Optional) ---
// คุณสามารถสร้าง API เส้นทางนี้เพิ่มเติม เพื่อให้สามารถดูข้อมูลสถิติได้
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await ApiStat.findOne({ identifier: 'global-stats' });
        if (!stats) {
            return res.status(404).json({ message: 'ยังไม่มีข้อมูลสถิติ' });
        }
        res.json(stats);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// เริ่มเซิร์ฟเวอร์
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
