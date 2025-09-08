const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser'); // body-parser is built into express now, but keeping for compatibility if needed.
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware พื้นฐาน
app.use(cors());
app.use(express.json()); // ใช้ express.json() แทน bodyParser.json() ซึ่งเป็นวิธีที่ทันสมัยกว่า

// --- เชื่อมต่อ MongoDB ---
const mongoURI = 'mongodb://mongo:lAYAnrVBCseEFNaQELuwLeyUfLdjrXCw@mainline.proxy.rlwy.net:59883';

mongoose.connect(mongoURI)
.then(() => console.log('เชื่อมต่อ MongoDB Atlas สำเร็จ'))
.catch(err => console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', err));

// ========================================================
// --- ส่วนของ Schemas ---
// ========================================================

// --- [เพิ่มใหม่] Schema สำหรับสร้าง Auto-Increment ID ---
const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

// ฟังก์ชันสำหรับสร้าง ID อัตโนมัติ
async function getNextSequenceValue(sequenceName) {
    const sequenceDocument = await Counter.findByIdAndUpdate(
        sequenceName,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return sequenceDocument.seq;
}

// --- [เพิ่มใหม่] Schema สำหรับ Store (ร้านค้า) ---
const storeSchema = new mongoose.Schema({
    storeId: { type: Number, unique: true, required: true },
    storeName: { type: String, required: true, unique: true, trim: true },
    treasuresCount: { type: Number, default: 0 }, // จำนวนคูปองทั้งหมดที่เคยสร้างโดยร้านนี้
    ig: String,
    face: String
});
const Store = mongoose.model('Store', storeSchema);


// --- [อัปเดต] Schema สำหรับ Treasure (เพิ่ม storeId) ---
const treasureSchema = new mongoose.Schema({
    lat: Number,
    lng: Number,
    placementDate: String,
    name: String, // ชื่อร้าน (ยังคงเก็บไว้เพื่อความสะดวก แต่ตัวหลักคือ storeId)
    ig: String,
    face: String,
    mission: String,
    discount: String,
    discountBaht: String,
    totalBoxes: { type: Number, default: 1 },
    remainingBoxes: { type: Number, default: 1 },
    storeId: { type: Number, index: true } // [เพิ่มใหม่] ใช้สำหรับอ้างอิงถึง Store
});

const Treasure = mongoose.model('Treasure', treasureSchema);

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
        // ข้อมูลที่ส่งกลับไปจะมี field 'storeId' หรือเป็น undefined (สำหรับข้อมูลเก่า) โดยอัตโนมัติ
        // Frontend สามารถเช็คได้ว่า if (treasure.storeId) { ... }
        res.json(treasures);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// [POST] สร้างหรือวางคูปองใหม่ (*** LOGIC อัปเดตหลักอยู่ที่นี่ ***)
app.post('/api/treasures', countApiCall('treasuresCreatedCount'), async (req, res) => {
    const { name, ig, face, ...treasureData } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ message: 'กรุณาระบุชื่อร้าน (name)' });
    }

    const trimmedStoreName = name.trim();
    let storeIdToAssign;

    try {
        // 1. ค้นหาร้านค้าจากชื่อที่ trim แล้ว (case-sensitive)
        let store = await Store.findOne({ storeName: trimmedStoreName });

        if (store) {
            // 2.1. ถ้าร้านค้ามีอยู่แล้ว: อัปเดตจำนวนคูปองและใช้ storeId เดิม
            store.treasuresCount += 1;
            await store.save();
            storeIdToAssign = store.storeId;
        } else {
            // 2.2. ถ้าร้านค้ายังไม่มี: สร้างร้านใหม่พร้อม storeId ใหม่
            const newStoreId = await getNextSequenceValue('storeId');
            store = new Store({
                storeId: newStoreId,
                storeName: trimmedStoreName,
                treasuresCount: 1, // สร้างครั้งแรกนับเป็น 1
                ig: ig,
                face: face
            });
            await store.save();
            storeIdToAssign = newStoreId;
        }

        // 3. สร้าง Treasure ใหม่พร้อมกับ storeId ที่ได้มา
        const treasure = new Treasure({
            ...treasureData,
            name: trimmedStoreName, // เก็บชื่อที่ trim แล้ว
            ig: ig,
            face: face,
            remainingBoxes: treasureData.totalBoxes,
            storeId: storeIdToAssign // *** กำหนด storeId ให้กับคูปอง ***
        });

        const newTreasure = await treasure.save();
        res.status(201).json(newTreasure);

    } catch (err) {
        // จัดการกับ error ที่อาจเกิดจากการ save ไม่สำเร็จ (เช่น unique key violation)
        res.status(400).json({ message: err.message });
    }
});


// [PATCH] อัปเดตเมื่อผู้ใช้เปิดสมบัติ (ลดจำนวนคูปอง)
app.patch('/api/treasures/:id', countApiCall('treasuresOpenedCount'), async (req, res) => {
    try {
        // ใช้ findOneAndUpdate แทน findByIdAndUpdate เพื่อให้ได้ document ก่อนการอัปเดต
        // ซึ่งจะทำให้เรามั่นใจว่าเราลบเอกสารที่ถูกต้อง
        const treasure = await Treasure.findByIdAndUpdate(
            req.params.id,
            { $inc: { remainingBoxes: -1 } },
            { new: true } // new: true เพื่อให้ return document หลัง update
        );

        if (!treasure) {
            return res.status(404).json({ message: 'ไม่พบคูปองนี้' });
        }

        // หากเปิดจนกล่องสุดท้ายหมด (remainingBoxes เป็น 0 หรือน้อยกว่า)
        if (treasure.remainingBoxes <= 0) {
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
            .select('_id placementDate name totalBoxes remainingBoxes storeId') // เพิ่ม storeId
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

// --- [API Admin ใหม่] ---

// [GET] /api/admin/stores - ดึงข้อมูลร้านค้าทั้งหมดที่เคยเข้าร่วม
app.get('/api/admin/stores', async (req, res) => {
    try {
        const stores = await Store.find({}).sort({ storeId: 1 }); // เรียงตาม storeId
        res.json(stores);
    } catch (err) {
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลร้านค้า', error: err.message });
    }
});

// [GET] /api/admin/stores/:storeId/treasures - ดึงคูปองที่ยังเหลืออยู่ทั้งหมดของร้านค้าที่ระบุ
app.get('/api/admin/stores/:storeId/treasures', async (req, res) => {
    try {
        const storeIdNum = parseInt(req.params.storeId, 10);
        if (isNaN(storeIdNum)) {
            return res.status(400).json({ message: 'storeId ไม่ถูกต้อง' });
        }

        const treasures = await Treasure.find({
            storeId: storeIdNum,
            remainingBoxes: { $gt: 0 } // แสดงเฉพาะกล่องที่ยังไม่หมดอายุ
        }).sort({ placementDate: -1 });

        res.json(treasures);
    } catch (err) {
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลคูปองของร้านค้า', error: err.message });
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
        // ลบข้อมูลสมบัติทั้งหมด
        const treasureDeletionResult = await Treasure.deleteMany({});
        // ลบข้อมูลสถิติ
        const statDeletionResult = await ApiStat.deleteMany({});
        // [เพิ่มใหม่] ลบข้อมูลร้านค้า
        const storeDeletionResult = await Store.deleteMany({});
        // [เพิ่มใหม่] ลบข้อมูลตัวนับ ID
        const counterDeletionResult = await Counter.deleteMany({});

        res.json({
            message: 'ล้างข้อมูลทั้งหมดในระบบสำเร็จ',
            treasuresDeleted: treasureDeletionResult.deletedCount,
            statsDeleted: statDeletionResult.deletedCount,
            storesDeleted: storeDeletionResult.deletedCount,
            countersDeleted: counterDeletionResult.deletedCount
        });

    } catch (err) {
        res.status(500).json({ message: 'เกิดข้อผิดพลาดระหว่างการล้างข้อมูล', error: err.message });
    }
});

// --- เริ่มการทำงานของเซิร์ฟเวอร์ ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});