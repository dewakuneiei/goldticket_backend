const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());


// เชื่อมต่อ MongoDB
mongoose.connect('mongodb+srv://sukritchosri:12345@goldticket.6logoc8.mongodb.net/treasureHunt?retryWrites=true&w=majority&appName=goldticket')
  .then(() => console.log('เชื่อมต่อ MongoDB Atlas สำเร็จ'))
  .catch(err => console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', err));


// สร้าง Schema สำหรับ Treasure
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
  totalBoxes: { type: Number, default: 1 }, // จำนวนกล่องทั้งหมด
  remainingBoxes: { type: Number, default: 1 } // จำนวนกล่องที่เหลือ
});

// สร้างโมเดล Treasure
const Treasure = mongoose.model('Treasure', treasureSchema);


//เเสดงคูปอง
app.get('/api/treasures', async (req, res) => {
  try {
    // ดึงข้อมูลสมบัติที่ remainingBoxes > 0
    const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } });
    res.json(treasures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

//วางคูปอง
app.post('/api/treasures', async (req, res) => {
  try {
  console.log("✅ API /api/treasures ถูกเรียกแล้ว");
  console.log("Received body:", req.body); // จุดสำคัญ
    
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


// API อัปเดตเมื่อเปิดสมบัติ (ลด remainingBoxes)
app.patch('/api/treasures/:id', async (req, res) => {
  try {
    // ค้นหาสมบัติด้วย ID
    const treasure = await Treasure.findByIdAndUpdate(
      req.params.id,
      { $inc: { remainingBoxes: -1 } }, // ลด remainingBoxes ลง 1
      { new: true }
    );
    
    if (!treasure) {
      return res.status(404).json({ message: 'ไม่พบคูปองนี้' });
    }

    // หาก remainingBoxes เป็น 0 ให้ลบสมบัติออกจากฐานข้อมูล
    if (treasure.remainingBoxes === 0) {
      await Treasure.deleteOne({ _id: treasure._id });
    }

    // ส่งข้อมูลสมบัติที่อัปเดตกลับไป
    res.json(treasure);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});



// เริ่มเซิร์ฟเวอร์
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});