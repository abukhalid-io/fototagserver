// IndexedDB Manager untuk Penyimpanan Lokal Offline
class LocalDB {
  constructor() {
    this.DB_NAME = 'GeoTaggingDB';
    this.DB_VERSION = 1;
    this.db = null;
  }

  // Initialize database
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.error('[LocalDB] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[LocalDB] Database opened successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store untuk foto pending upload
        if (!db.objectStoreNames.contains('pending_photos')) {
          const pendingStore = db.createObjectStore('pending_photos', {
            keyPath: 'id',
            autoIncrement: true
          });
          pendingStore.createIndex('timestamp', 'timestamp', { unique: false });
          pendingStore.createIndex('synced', 'synced', { unique: false });
          console.log('[LocalDB] Created pending_photos store');
        }

        // Store untuk foto yang sudah berhasil di-upload (cache lokal)
        if (!db.objectStoreNames.contains('cached_photos')) {
          const cacheStore = db.createObjectStore('cached_photos', {
            keyPath: 'id'
          });
          cacheStore.createIndex('item_tag', 'item_tag', { unique: false });
          cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('[LocalDB] Created cached_photos store');
        }

        // Store untuk settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', {
            keyPath: 'key'
          });
          console.log('[LocalDB] Created settings store');
        }
      };
    });
  }

  // Save photo to pending queue (offline mode)
  async savePendingPhoto(photoData) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending_photos'], 'readwrite');
      const store = transaction.objectStore('pending_photos');

      const photo = {
        ...photoData,
        timestamp: Date.now(),
        synced: false,
        retryCount: 0
      };

      const request = store.add(photo);

      request.onsuccess = () => {
        console.log('[LocalDB] Photo saved to pending queue, ID:', request.result);
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('[LocalDB] Failed to save photo:', request.error);
        reject(request.error);
      };
    });
  }

  // Get all pending photos
  async getPendingPhotos() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending_photos'], 'readonly');
      const store = transaction.objectStore('pending_photos');
      const index = store.index('synced');

      const request = index.getAll(false);

      request.onsuccess = () => {
        const photos = request.result;
        console.log('[LocalDB] Retrieved', photos.length, 'pending photos');
        resolve(photos);
      };

      request.onerror = () => {
        console.error('[LocalDB] Failed to get pending photos:', request.error);
        reject(request.error);
      };
    });
  }

  // Mark photo as synced
  async markAsSynced(photoId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending_photos'], 'readwrite');
      const store = transaction.objectStore('pending_photos');

      const getRequest = store.get(photoId);

      getRequest.onsuccess = () => {
        const photo = getRequest.result;
        if (photo) {
          photo.synced = true;
          photo.syncedAt = new Date().toISOString();
          
          const updateRequest = store.put(photo);
          
          updateRequest.onsuccess = () => {
            console.log('[LocalDB] Photo marked as synced:', photoId);
            resolve();
          };

          updateRequest.onerror = () => {
            reject(updateRequest.error);
          };
        } else {
          resolve(); // Photo not found, consider it resolved
        }
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  }

  // Delete photo from pending queue
  async deletePendingPhoto(photoId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending_photos'], 'readwrite');
      const store = transaction.objectStore('pending_photos');

      const request = store.delete(photoId);

      request.onsuccess = () => {
        console.log('[LocalDB] Deleted photo from pending queue:', photoId);
        resolve();
      };

      request.onerror = () => {
        console.error('[LocalDB] Failed to delete photo:', request.error);
        reject(request.error);
      };
    });
  }

  // Cache photo from server (for offline gallery view)
  async cachePhoto(photo) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['cached_photos'], 'readwrite');
      const store = transaction.objectStore('cached_photos');

      const photoData = {
        ...photo,
        timestamp: Date.now()
      };

      const request = store.put(photoData);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // Get cached photos
  async getCachedPhotos(limit = 50) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['cached_photos'], 'readonly');
      const store = transaction.objectStore('cached_photos');
      const index = store.index('timestamp');

      const request = index.openCursor(null, 'prev');
      const photos = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && photos.length < limit) {
          photos.push(cursor.value);
          cursor.continue();
        } else {
          resolve(photos);
        }
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // Save setting
  async setSetting(key, value) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['settings'], 'readwrite');
      const store = transaction.objectStore('settings');

      const request = store.put({ key, value, updatedAt: new Date().toISOString() });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Get setting
  async getSetting(key) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['settings'], 'readonly');
      const store = transaction.objectStore('settings');

      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result ? request.result.value : null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // Get pending count
  async getPendingCount() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pending_photos'], 'readonly');
      const store = transaction.objectStore('pending_photos');
      const index = store.index('synced');

      const request = index.openCursor(IDBKeyRange.only(false));
      let count = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          count++;
          cursor.continue();
        } else {
          resolve(count);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // Clear old cached photos (older than 7 days)
  async clearOldCache(daysOld = 7) {
    if (!this.db) await this.init();

    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['cached_photos'], 'readwrite');
      const store = transaction.objectStore('cached_photos');
      const index = store.index('timestamp');

      const range = IDBKeyRange.upperBound(cutoffTime);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          console.log('[LocalDB] Cleared old cache');
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }
}

// Create global instance
const localDB = new LocalDB();
