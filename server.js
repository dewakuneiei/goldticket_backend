const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware พื้นฐาน
app.use(cors());
app.use(bodyParser.json());

// --- เชื่อมต่อ MongoDB ---
const mongoURI = 'mongodb://mongo:lAYAnrVBCseEFNaQELuwLeyUfLdjrXCw@mainline.proxy.rlwy.net:59883';

mongoose.connect(mongoURI)
.then(() => console.log('เชื่อมต่อ MongoDB Atlas สำเร็จ'))
.catch(err => console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', err));

// ======================================================================
// ====[ จุดที่แก้ไข 1: อัปเดต Schema ให้ยอมรับค่า null ]====
// ======================================================================
const treasureSchema = new mongoose.Schema({
    lat: Number,
    lng: Number,
    placementDate: String,
    name: String, // ชื่อร้าน
    ig: String,
    face: String,
    mission: String,
    discount: { type: String, default: null },      // <-- แก้ไขตรงนี้
    discountBaht: { type: String, default: null }, // <-- และตรงนี้
    totalBoxes: { type: Number, default: 1 },
    remainingBoxes: { type: Number, default: 1 }
});

const Treasure = mongoose.model('Treasure', treasureSchema);

// --- Schema สำหรับ Store (ร้านค้าที่เข้าร่วม) ---
const storeSchema = new mongoose.Schema({
    storeName: { type: String, required: true, unique: true },
    treasures: { type: Number, default: 0 },
    ig: { type: String },
    face: { type: String }
}, { timestamps: true });

const Store = mongoose.model('Store', storeSchema);


// --- Schema สำหรับเก็บสถิติ ---
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
// ======================================================================
// ====[ จุดที่แก้ไข 2: ปรับการสร้าง Object ให้รองรับค่า null ]====
// ======================================================================
app.post('/api/treasures', countApiCall('treasuresCreatedCount'), async (req, res) => {
    try {
        const { 
            lat, lng, placementDate, name, ig, face, 
            mission, discount, discountBaht, totalBoxes 
        } = req.body;

        // 1. สร้าง Treasure object อย่างปลอดภัย
        const treasureData = {
            lat: lat,
            lng: lng,
            placementDate: placementDate,
            name: name,
            ig: ig || '',
            face: face || '',
            mission: mission || '',
            discount: discount, // ส่งค่าที่ได้รับมาโดยตรง (จะเป็น string หรือ null ก็ได้)
            discountBaht: discountBaht, // ส่งค่าที่ได้รับมาโดยตรง
            totalBoxes: totalBoxes || 1,
            remainingBoxes: totalBoxes || 1
        };
        const treasure = new Treasure(treasureData);

        // 2. ตรวจสอบและอัปเดตข้อมูลร้านค้า (Store)
        if (name) {
            const trimmedStoreName = name.trim();
            await Store.findOneAndUpdate(
                { storeName: trimmedStoreName },
                {
                    $inc: { treasures: 1 },
                    $setOnInsert: {
                        storeName: trimmedStoreName,
                        ig: ig,
                        face: face
                    }
                },
                { upsert: true }
            );
        }

        // 3. บันทึก Treasure
        const newTreasure = await treasure.save();
        res.status(201).json(newTreasure);

    } catch (err) {
        console.error('Error creating treasure:', err.message);
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

        if (treasure.remainingBoxes <= 0) {
            await ApiStat.findOneAndUpdate(
                { identifier: 'global-stats' },
                {
                    $inc: { treasuresCompletedCount: 1 },
                    $set: { lastTreasureCompleted: new Date() }
                },
                { upsert: true }
            );
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

app.get('/api/admin/treasures', async (req, res) => {
    try {
        const treasures = await Treasure.find({ remainingBoxes: { $gt: 0 } })
            .select('_id placementDate name totalBoxes remainingBoxes')
            .sort({ placementDate: -1 });
        res.json(treasures);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

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

app.get('/api/admin/stores', async (req, res) => {
    try {
        const stores = await Store.find({}).sort({ storeName: 1 });
        res.json(stores);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/admin/stores/:id', async (req, res) => {
    try {
        const store = await Store.findById(req.params.id);
        if (!store) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลร้านค้าตาม ID ที่ระบุ' });
        }
        res.json(store);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/admin/reset-data', async (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_RESET_PASSWORD;

    if (!password || password !== adminPassword) {
        return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง ไม่ได้รับอนุญาตให้ดำเนินการ' });
    }

    try {
        const treasureDeletionResult = await Treasure.deleteMany({});
        const storeDeletionResult = await Store.deleteMany({});
        const statDeletionResult = await ApiStat.findOneAndDelete({ identifier: 'global-stats' });

        res.json({
            message: 'ล้างข้อมูลทั้งหมดในระบบสำเร็จ',
            treasuresDeleted: treasureDeletionResult.deletedCount,
            storesDeleted: storeDeletionResult.deletedCount,
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
