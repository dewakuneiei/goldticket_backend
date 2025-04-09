const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// เชื่อมต่อ MongoDB
mongoose.connect('mongodb+srv://sukritchosri:12345Aa@goldticket.6logoc8.mongodb.net/treasureHunt?retryWrites=true&w=majority&appName=goldticket', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
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
  claimed: Boolean
});

const Treasure = mongoose.model('Treasure', treasureSchema);



// เเสดงสมบัติทั้งหมดบนเเผนที่
app.get('/api/treasures', async (req, res) => {
  try {
      console.log("Fetching treasures...");  // ตรวจสอบว่าเริ่มการดึงข้อมูลหรือไม่
      const treasures = await Treasure.find({ claimed: false });
      console.log("Treasures found:", treasures);  // ตรวจสอบข้อมูลที่ได้รับจาก MongoDB
      res.json(treasures);
  } catch (err) {
      console.error("Error fetching treasures:", err);  // แสดงข้อผิดพลาดถ้ามี
      res.status(500).json({ message: err.message });
  }
});


// เพิ่มสมบัติใหม่
app.post('/api/treasures', async (req, res) => {
  const treasure = new Treasure(req.body);
  try {
    const newTreasure = await treasure.save();
    res.status(201).json(newTreasure);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ลบสมบัติเมื่อถูกเปิด
app.delete('/api/treasures/:id', async (req, res) => {
    try {
      const deletedTreasure = await Treasure.findByIdAndDelete(req.params.id);
      
      if (!deletedTreasure) {
        return res.status(404).json({ message: 'ไม่พบสมบัตินี้' });
      }
      
      res.json({ 
        message: 'ลบสมบัติเรียบร้อยแล้ว',
        deletedTreasure 
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

// เริ่มเซิร์ฟเวอร์
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});