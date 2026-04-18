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

// Bersihkan teks OCR mentah
function cleanOCRText(raw) {
  return raw.split('\n').map(l => l.trim()).filter(l => l.length > 2).join('\n');
}

// Pilih teks terbaik: lebih banyak ':' = lebih mungkin watermark terstruktur
function pickBestText(texts) {
  return texts
    .map(t => ({ text: t, score: (t.match(/:/g) || []).length * 3 + t.split('\n').length }))
    .sort((a, b) => b.score - a.score)[0]?.text || '';
}

// Parse teks OCR watermark → objek field terstruktur
// Format watermark: "key     : value"
function parseWatermarkText(text) {
  const result = {};
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^([\w][\w\s_-]{1,20}?)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
    const val = m[2].trim();
    if (!val || val === '-') continue;

    if (/tag|item/.test(key))             result.item_tag = val.toUpperCase();
    else if (/loc/.test(key))             result.location = val;
    else if (/note|cat/.test(key))        result.note = val;
    else if (/coord|lat/.test(key)) {
      const parts = val.split(',');
      if (parts.length >= 2) {
        result.latitude  = parts[0].trim();
        result.longitude = parts[1].trim();
      }
    }
    else if (/alt/.test(key))             result.altitude = val;
    else if (/date|tang/.test(key))       result.datetime_taken = val;
  }
  return result;
}

async function extractWatermarkOCR(photoId, filePath) {
  let worker = null;
  try {
    console.log(`[OCR] Starting for photo ${photoId}...`);
    db.prepare('UPDATE photos SET ocr_status = ? WHERE id = ?').run('processing', photoId);

    // ── Step 1: Normalisasi orientasi EXIF ──
    const normalizedBuf = await sharp(filePath).rotate().toBuffer();
    const { width, height } = await sharp(normalizedBuf).metadata();
    console.log(`[OCR] Normalized: ${width}x${height}`);

    // ── Step 2: Crop area watermark (bawah 40%) ──
    const cropTop = Math.floor(height * 0.60);
    const cropH   = height - cropTop;
    const cropBuf = await sharp(normalizedBuf)
      .extract({ left: 0, top: cropTop, width, height: cropH })
      .toBuffer();

    // ── Step 3: Siapkan 2 versi gambar secara paralel ──
    // Gunakan 2x upscale saja (bukan 4x) → lebih cepat, kualitas cukup untuk OCR
    const OCR_W = Math.min(width * 2, 2400);
    const OCR_H = Math.round(cropH * (OCR_W / width));
    const [negBuf, normBuf] = await Promise.all([
      sharp(cropBuf).grayscale().negate().normalize()
        .resize({ width: OCR_W, height: OCR_H, fit: 'fill', kernel: 'lanczos3' })
        .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.0 }).toBuffer(),
      sharp(cropBuf).grayscale().normalize()
        .resize({ width: OCR_W, height: OCR_H, fit: 'fill', kernel: 'lanczos3' })
        .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.0 }).toBuffer(),
    ]);

    // ── Step 4: 1 worker, 2 pass berurutan (jauh lebih cepat dari 3 worker terpisah) ──
    worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_pageseg_mode:     '11', // sparse text
      tessedit_ocr_engine_mode:  '1',  // LSTM only
      preserve_interword_spaces: '1',
    });

    const text1 = cleanOCRText((await worker.recognize(negBuf)).data.text);
    const text2 = cleanOCRText((await worker.recognize(normBuf)).data.text);
    console.log(`[OCR] Pass1 (negate):\n${text1 || '(kosong)'}`);
    console.log(`[OCR] Pass2 (normal):\n${text2 || '(kosong)'}`);

    const bestText = pickBestText([text1, text2].filter(Boolean));
    console.log(`[OCR] Best:\n${bestText}`);

    // ── Step 5: Parse field dari teks OCR ──
    const parsed = parseWatermarkText(bestText);
    console.log(`[OCR] Parsed fields:`, parsed);

    // ── Step 6: Update DB — simpan teks + isi kolom yang masih kosong/default ──
    db.prepare(`
      UPDATE photos SET
        ocr_text       = ?,
        ocr_status     = ?,
        item_tag       = CASE WHEN item_tag   IN ('UNKNOWN','')       THEN ? ELSE item_tag   END,
        location       = CASE WHEN location   IN ('Tidak diisi','')   THEN ? ELSE location   END,
        note           = CASE WHEN note       IN ('-','')             THEN ? ELSE note       END,
        latitude       = CASE WHEN latitude   IN ('N/A','')           THEN ? ELSE latitude   END,
        longitude      = CASE WHEN longitude  IN ('N/A','')           THEN ? ELSE longitude  END,
        altitude       = CASE WHEN altitude   IN ('N/A','')           THEN ? ELSE altitude   END,
        datetime_taken = CASE WHEN datetime_taken IS NULL OR datetime_taken = '' THEN ? ELSE datetime_taken END
      WHERE id = ?
    `).run(
      bestText || '', 'done',
      parsed.item_tag       || 'UNKNOWN',
      parsed.location       || 'Tidak diisi',
      parsed.note           || '-',
      parsed.latitude       || 'N/A',
      parsed.longitude      || 'N/A',
      parsed.altitude       || 'N/A',
      parsed.datetime_taken || null,
      photoId
    );

  } catch (err) {
    console.error(`[OCR] Failed for photo ${photoId}:`, err.message);
    db.prepare('UPDATE photos SET ocr_status = ? WHERE id = ?').run('error', photoId);
  } finally {
    if (worker) await worker.terminate();
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

// GET /api/photos/:id/ocr - Get OCR result + semua field yang sudah di-parse
app.get('/api/photos/:id/ocr', (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    res.json({
      success:        true,
      id:             photo.id,
      ocr_status:     photo.ocr_status,
      ocr_text:       photo.ocr_text,
      // Field terstruktur hasil parse watermark — langsung dipakai client untuk isi form
      item_tag:       photo.item_tag,
      location:       photo.location,
      note:           photo.note,
      latitude:       photo.latitude,
      longitude:      photo.longitude,
      altitude:       photo.altitude,
      datetime_taken: photo.datetime_taken,
    });
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
