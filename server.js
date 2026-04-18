const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const db = require('./database');
const exifr = require('exifr');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Create uploads directory if not exists
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  // Simpan dulu dengan nama sementara — akan direname di route handler
  // setelah req.body (itemTag) tersedia
  filename: function (req, file, cb) {
    const tmp = 'tmp_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + '.jpg';
    cb(null, tmp);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// ==================== OCR PROCESSING ====================

// Hitung tinggi watermark sama persis dengan rumus di client (index.html)
function calcWatermarkBox(width) {
  const NUM_LINES  = 7;
  const fontSize   = Math.max(Math.floor(width * 0.009), 11);
  const lineHeight = Math.floor(fontSize * 1.65);
  const padY       = Math.floor(fontSize * 0.9);
  const boxH       = NUM_LINES * lineHeight + padY * 2;
  return { fontSize, lineHeight, padY, boxH };
}

async function extractWatermarkOCR(photoId, filePath) {
  let worker = null;
  try {
    console.log(`[OCR] Starting OCR for photo ${photoId}...`);
    db.prepare('UPDATE photos SET ocr_status = ? WHERE id = ?').run('processing', photoId);

    // ── Step 1: Auto-rotate berdasarkan EXIF (penting untuk foto portrait dari HP) ──
    // Foto HP sering disimpan sebagai landscape + tag EXIF "putar 90°"
    // Tanpa rotate(), sharp membaca dimensi file asli (bukan dimensi visual)
    // sehingga crop area watermark jatuh di posisi yang salah
    const normalizedBuf = await sharp(filePath).rotate().toBuffer();
    const { width, height } = await sharp(normalizedBuf).metadata();

    // ── Step 2: Hitung area watermark (rumus sama dengan client) ──
    const { boxH } = calcWatermarkBox(width);

    // Buffer 40px — lebih generous agar baris paling atas watermark tidak terpotong
    const buffer  = 40;
    const cropH   = Math.min(boxH + buffer, height);
    const cropTop = Math.max(0, height - cropH);

    console.log(`[OCR] Photo ${photoId}: ${width}x${height} (normalized), boxH=${boxH}px, crop top=${cropTop}px h=${cropH}px`);

    // ── Step 3: Pipeline preprocessing ──
    // Masalah utama threshold(140): JPEG artifact di tepi teks menghasilkan
    // piksel ~100-180 yang tepat di batas threshold → karakter rusak/hilang.
    // Solusi: HAPUS threshold, biarkan Tesseract lakukan binarisasi Otsu sendiri
    // yang jauh lebih adaptif terhadap noise JPEG.
    //
    // Pipeline:
    //   grayscale → negate (teks putih→hitam, bg hitam→putih)
    //   → normalize (stretch kontras ke range penuh 0-255)
    //   → upscale 4x (lebih banyak piksel = OCR lebih akurat)
    //   → sharpen sedang (tegaskan tepi huruf)
    const processedBuffer = await sharp(normalizedBuf)
      .extract({ left: 0, top: cropTop, width, height: cropH })
      .grayscale()
      .negate()
      .normalize()                                          // stretch kontras otomatis
      .resize({ width: width * 4, height: cropH * 4, fit: 'fill', kernel: 'lanczos3' })
      .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.0 })          // sharpen tepi teks
      .toBuffer();

    // ── Step 4: Tesseract OCR ──
    worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist:
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:-_ /()[]°+',
      tessedit_pageseg_mode:     '6',  // blok teks seragam (uniform block)
      tessedit_ocr_engine_mode:  '1',  // LSTM only (lebih akurat dari mode gabungan)
      preserve_interword_spaces: '1',
    });

    const { data: { text } } = await worker.recognize(processedBuffer);
    await worker.terminate();
    worker = null;

    // ── Step 5: Bersihkan hasil ──
    const cleanText = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2)   // buang baris terlalu pendek (noise)
      .join('\n');

    db.prepare('UPDATE photos SET ocr_text = ?, ocr_status = ? WHERE id = ?')
      .run(cleanText || '', 'done', photoId);

    console.log(`[OCR] Done for photo ${photoId}:\n${cleanText}`);
  } catch (err) {
    console.error(`[OCR] Failed for photo ${photoId}:`, err.message);
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    db.prepare('UPDATE photos SET ocr_status = ? WHERE id = ?').run('error', photoId);
  }
}

// ==================== API ROUTES ====================

// POST /api/upload - Upload photo with metadata
app.post('/api/upload', upload.single('photo'), async (req, res) => {
  try {
    const { itemTag, location, note, latitude, longitude, altitude, datetimeTaken } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    if (!itemTag) {
      // Hapus file tmp jika tidak ada itemTag
      try { fs.unlinkSync(req.file.path); } catch(_) {}
      return res.status(400).json({ error: 'Item tag is required' });
    }

    // ── Rename file tmp → {ITEMTAG}_{YYYYMMDD_HHMMSS}_{rand}.jpg ──
    const safeTag  = itemTag.toUpperCase().replace(/[^A-Z0-9\-_]/g, '_');
    const now      = new Date();
    const dateStr  = now.getFullYear().toString()
                   + String(now.getMonth()+1).padStart(2,'0')
                   + String(now.getDate()).padStart(2,'0');
    const timeStr  = String(now.getHours()).padStart(2,'0')
                   + String(now.getMinutes()).padStart(2,'0')
                   + String(now.getSeconds()).padStart(2,'0');
    const rand     = Math.random().toString(36).slice(2,6).toUpperCase();
    const newFilename = `${safeTag}_${dateStr}_${timeStr}_${rand}.jpg`;
    const newPath     = path.join(UPLOADS_DIR, newFilename);
    fs.renameSync(req.file.path, newPath);
    req.file.filename = newFilename;
    req.file.path     = newPath;
    console.log(`File renamed: ${newFilename}`);

    // Try to extract EXIF data from the photo
    let exifData = null;
    let extractedTags = {};
    
    try {
      exifData = await exifr.parse(req.file.path);
      
      if (exifData) {
        console.log('EXIF data extracted:', {
          GPSLatitude: exifData.latitude,
          GPSLongitude: exifData.longitude,
          DateTimeOriginal: exifData.DateTimeOriginal,
          Make: exifData.Make,
          Model: exifData.Model
        });
        
        // Extract GPS coordinates if available and not provided by client
        let finalLat = latitude;
        let finalLon = longitude;
        let finalAlt = altitude;
        
        if (exifData.latitude && exifData.longitude && (!latitude || latitude === 'N/A')) {
          finalLat = exifData.latitude.toFixed(6);
          finalLon = exifData.longitude.toFixed(6);
          finalAlt = exifData.altitude ? exifData.altitude.toFixed(2) + 'm' : 'N/A';
          console.log(`Extracted GPS from EXIF: ${finalLat}, ${finalLon}`);
        }
        
        extractedTags = {
          cameraMake: exifData.Make || 'Unknown',
          cameraModel: exifData.Model || 'Unknown',
          dateTime: exifData.DateTimeOriginal || new Date().toLocaleString('id-ID'),
          focalLength: exifData.FocalLength ? `${exifData.FocalLength}mm` : 'N/A',
          fNumber: exifData.FNumber ? `f/${exifData.FNumber}` : 'N/A',
          iso: exifData.ISO || 'N/A',
          exposureTime: exifData.ExposureTime ? `${exifData.ExposureTime}s` : 'N/A'
        };
      }
    } catch (exifError) {
      console.log('EXIF extraction failed, using client data:', exifError.message);
    }
    
    // Use client data or fallback to EXIF data
    const finalLatitude = (latitude && latitude !== 'N/A') ? latitude : (extractedTags.gpsLat || 'N/A');
    const finalLongitude = (longitude && longitude !== 'N/A') ? longitude : (extractedTags.gpsLon || 'N/A');
    const finalAltitude = (altitude && altitude !== 'N/A') ? altitude : (extractedTags.gpsAlt || 'N/A');
    const finalDatetime = datetimeTaken || extractedTags.dateTime || new Date().toLocaleString('id-ID');
    
    const stmt = db.prepare(`
      INSERT INTO photos (filename, original_filename, item_tag, location, note, latitude, longitude, altitude, datetime_taken)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      req.file.filename,
      req.file.originalname,
      itemTag.toUpperCase(),
      location || 'Tidak diisi',
      note || '-',
      finalLatitude,
      finalLongitude,
      finalAltitude,
      finalDatetime
    );
    
    console.log(`Photo uploaded: ${itemTag.toUpperCase()} -> ${req.file.filename}`);

    const newId = result.lastInsertRowid;

    // Run OCR in background (non-blocking)
    setImmediate(() => {
      extractWatermarkOCR(newId, req.file.path).catch(console.error);
    });

    res.json({
      success: true,
      message: 'Photo uploaded and processed successfully',
      id: newId,
      filename: req.file.filename,
      exifExtracted: exifData ? true : false,
      extractedTags: extractedTags
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload photo', details: error.message });
  }
});

// GET /api/photos - Get all photos with pagination
app.get('/api/photos', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const photos = db.prepare(`
      SELECT * FROM photos 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    
    const total = db.prepare('SELECT COUNT(*) as count FROM photos').get();
    
    res.json({
      success: true,
      photos: photos,
      pagination: {
        page: page,
        limit: limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit)
      }
    });
  } catch (error) {
    console.error('Get photos error:', error);
    res.status(500).json({ error: 'Failed to get photos' });
  }
});

// GET /api/photos/:id - Get single photo
app.get('/api/photos/:id', (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    res.json({ success: true, photo: photo });
  } catch (error) {
    console.error('Get photo error:', error);
    res.status(500).json({ error: 'Failed to get photo' });
  }
});

// GET /api/search - Search photos by tag, location, or note
app.get('/api/search', (req, res) => {
  try {
    const { q, tag, location } = req.query;
    
    let query = 'SELECT * FROM photos WHERE 1=1';
    const params = [];
    
    if (q) {
      query += ' AND (item_tag LIKE ? OR location LIKE ? OR note LIKE ?)';
      const searchParam = `%${q}%`;
      params.push(searchParam, searchParam, searchParam);
    }
    
    if (tag) {
      query += ' AND item_tag LIKE ?';
      params.push(`%${tag}%`);
    }
    
    if (location) {
      query += ' AND location LIKE ?';
      params.push(`%${location}%`);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const photos = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      photos: photos,
      count: photos.length
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search photos' });
  }
});

// PUT /api/photos/:id - Update photo metadata (digunakan setelah import OCR)
app.put('/api/photos/:id', (req, res) => {
  try {
    const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    const { itemTag, location, note, latitude, longitude, altitude, datetimeTaken } = req.body;

    db.prepare(`
      UPDATE photos
      SET item_tag = ?, location = ?, note = ?,
          latitude = ?, longitude = ?, altitude = ?,
          datetime_taken = ?
      WHERE id = ?
    `).run(
      (itemTag || 'IMPORT').toUpperCase(),
      location  || 'Tidak diisi',
      note      || '-',
      latitude  || 'N/A',
      longitude || 'N/A',
      altitude  || 'N/A',
      datetimeTaken || new Date().toLocaleString('id-ID'),
      req.params.id
    );

    console.log(`Photo ${req.params.id} metadata updated: ${(itemTag||'').toUpperCase()}`);
    res.json({ success: true, id: parseInt(req.params.id) });
  } catch (error) {
    console.error('Update photo error:', error);
    res.status(500).json({ error: 'Failed to update photo' });
  }
});

// DELETE /api/photos/:id - Delete a photo
app.delete('/api/photos/:id', (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    // Delete file from filesystem
    const filePath = path.join(UPLOADS_DIR, photo.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Delete from database
    db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
    
    res.json({ success: true, message: 'Photo deleted successfully' });
  } catch (error) {
    console.error('Delete photo error:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// GET /api/stats - Get statistics
app.get('/api/stats', (req, res) => {
  try {
    const totalPhotos = db.prepare('SELECT COUNT(*) as count FROM photos').get();
    const uniqueTags = db.prepare('SELECT COUNT(DISTINCT item_tag) as count FROM photos').get();
    const recentPhotos = db.prepare('SELECT COUNT(*) as count FROM photos WHERE created_at > datetime("now", "-24 hours")').get();
    
    res.json({
      success: true,
      stats: {
        totalPhotos: totalPhotos.count,
        uniqueTags: uniqueTags.count,
        last24Hours: recentPhotos.count
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// GET /api/tags - Get all unique tags
app.get('/api/tags', (req, res) => {
  try {
    const tags = db.prepare(`
      SELECT DISTINCT item_tag, COUNT(*) as count 
      FROM photos 
      GROUP BY item_tag 
      ORDER BY item_tag ASC
    `).all();
    
    res.json({ success: true, tags: tags });
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

// GET /api/photos/:id/exif - Get EXIF data from photo
app.get('/api/photos/:id/exif', async (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    const filePath = path.join(UPLOADS_DIR, photo.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Photo file not found' });
    }
    
    // Extract EXIF data
    const exifData = await exifr.parse(filePath);
    
    if (exifData) {
      res.json({
        success: true,
        exif: {
          camera: `${exifData.Make || 'Unknown'} ${exifData.Model || ''}`,
          dateTime: exifData.DateTimeOriginal,
          gps: {
            latitude: exifData.latitude,
            longitude: exifData.longitude,
            altitude: exifData.altitude
          },
          settings: {
            focalLength: exifData.FocalLength,
            fNumber: exifData.FNumber,
            iso: exifData.ISO,
            exposureTime: exifData.ExposureTime,
            whiteBalance: exifData.WhiteBalance
          }
        }
      });
    } else {
      res.json({
        success: true,
        exif: null,
        message: 'No EXIF data available'
      });
    }
  } catch (error) {
    console.error('EXIF extraction error:', error);
    res.status(500).json({ error: 'Failed to extract EXIF data' });
  }
});

// GET /api/photos/:id/ocr - Get OCR result for a photo
app.get('/api/photos/:id/ocr', (req, res) => {
  try {
    const photo = db.prepare('SELECT id, ocr_text, ocr_status FROM photos WHERE id = ?').get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    res.json({ success: true, id: photo.id, ocr_status: photo.ocr_status, ocr_text: photo.ocr_text });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get OCR data' });
  }
});

// POST /api/photos/:id/ocr - Manually trigger OCR for a photo
app.post('/api/photos/:id/ocr', async (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const filePath = path.join(UPLOADS_DIR, photo.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Photo file not found' });
    res.json({ success: true, message: 'OCR started in background' });
    extractWatermarkOCR(photo.id, filePath).catch(console.error);
  } catch (error) {
    res.status(500).json({ error: 'Failed to start OCR' });
  }
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Gallery route
app.get('/gallery', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 GeoTagging App running on http://localhost:${PORT}`);
  console.log(`📸 Upload endpoint: http://localhost:${PORT}/api/upload`);
  console.log(`🖼️ Gallery: http://localhost:${PORT}/gallery`);
});

module.exports = app;
