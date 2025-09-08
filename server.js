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

// --- Schema สำหรับ Treasure (โครงสร้างข้อมูลคูปอง) ---
const treasureSchema = new mongoose.Schema({
    lat: Number,
    lng: Number,
    placementDate: String,
    name: String, // ชื่อร้าน
    ig: String,
    face: String,
    mission: String,
    discount: String,
    discountBaht: String,
    totalBoxes: { type: Number, default: 1 },
    remainingBoxes: { type: Number, default: 1 }
});

const Treasure = mongoose.model('Treasure', treasureSchema);

// --- [เพิ่มใหม่] Schema สำหรับ Store (ร้านค้าที่เข้าร่วม) ---
const storeSchema = new mongoose.Schema({
    storeName: { type: String, required: true, unique: true }, // unique เพื่อให้แน่ใจว่าชื่อร้านไม่ซ้ำ
    treasures: { type: Number, default: 0 }, // จำนวนกล่องสมบัติทั้งหมดที่เคยสร้างโดยร้านนี้
    ig: { type: String },
    face: { type: String }
}, { timestamps: true }); // เพิ่ม timestamps เพื่อดูว่าร้านถูกเพิ่มเมื่อไหร่

const Store = mongoose.model('Store', storeSchema);


// --- Schema สำหรับเก็บสถิติ (อัปเดตล่าสุด) ---
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
                updateOperation.$set = { lastAppOpen: new Date() }; // <-- แก้ไขให้ถูกต้อง
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
// --- [อัปเดต] เพิ่ม Logic การเช็คและอัปเดตข้อมูลร้านค้า (Store) ---
app.post('/api/treasures', countApiCall('treasuresCreatedCount'), async (req, res) => {
    try {
        const { name, ig, face, totalBoxes } = req.body;

        // 1. สร้าง Treasure object
        const treasure = new Treasure({
            ...req.body,
            remainingBoxes: totalBoxes
        });

        // 2. ตรวจสอบและอัปเดตข้อมูลร้านค้า (Store)
        if (name) {
            const trimmedStoreName = name.trim();

            // ใช้ findOneAndUpdate และ upsert:true เพื่อสร้างถ้าไม่มี หรืออัปเดตถ้ามีอยู่แล้ว
            // $inc: เพิ่มจำนวน treasures
            // $setOnInsert: จะทำงานเฉพาะตอนสร้าง document ใหม่เท่านั้น (ป้องกันการเขียนทับข้อมูล ig, face เดิม)
            await Store.findOneAndUpdate(
                { storeName: trimmedStoreName }, // เงื่อนไขในการค้นหา (case-sensitive)
                {
                    $inc: { treasures: 1 }, // เพิ่มจำนวนกล่องที่เคยสร้างขึ้น 1
                    $setOnInsert: { // ตั้งค่าเหล่านี้เฉพาะตอนที่สร้างร้านใหม่เท่านั้น
                        storeName: trimmedStoreName,
                        ig: ig,
                        face: face
                    }
                },
                { upsert: true } // ถ้าไม่เจอให้สร้างใหม่ (update + insert = upsert)
            );
        }

        // 3. บันทึก Treasure
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
            // นับสถิติว่ามีกล่องถูกใช้จนหมด 1 กล่อง
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

// --- [เพิ่มใหม่] API สำหรับ Admin เพื่อจัดการร้านค้า ---

// [GET] /api/admin/stores - ดึงข้อมูลร้านค้าที่เคยเข้าร่วมทั้งหมด
app.get('/api/admin/stores', async (req, res) => {
    try {
        const stores = await Store.find({}).sort({ storeName: 1 }); // เรียงตามชื่อร้าน
        res.json(stores);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// [GET] /api/admin/stores/{id} - ดึงข้อมูลร้านค้าเดียว
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


// [DELETE] /api/admin/reset-data - ล้างข้อมูลทั้งหมดในระบบ (ต้องใช้รหัสผ่าน)
// --- [อัปเดต] เพิ่มการล้างข้อมูลร้านค้า (Store) ด้วย ---
app.delete('/api/admin/reset-data', async (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_RESET_PASSWORD;

    if (!password || password !== adminPassword) {
        return res.status(401).json({ message: 'รหัสผ่านไม่ถูกต้อง ไม่ได้รับอนุญาตให้ดำเนินการ' });
    }

    try {
        // ลบข้อมูลสมบัติทั้งหมด
        const treasureDeletionResult = await Treasure.deleteMany({});
        // ลบข้อมูลร้านค้าทั้งหมด
        const storeDeletionResult = await Store.deleteMany({});
        // ลบข้อมูลสถิติ
        const statDeletionResult = await ApiStat.findOneAndDelete({ identifier: 'global-stats' });

        res.json({
            message: 'ล้างข้อมูลทั้งหมดในระบบสำเร็จ',
            treasuresDeleted: treasureDeletionResult.deletedCount,
            storesDeleted: storeDeletionResult.deletedCount, // ส่งค่าที่ลบไปกลับไปด้วย
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