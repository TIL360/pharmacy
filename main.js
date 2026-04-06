//this line removes yellow war warning
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

const { app, BrowserWindow, Menu, globalShortcut, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { shell } = require('electron'); // Add this at the top

// 1. EXPIRY CONFIGURATION
const EXPIRY_DATE = new Date(2026, 6, 30); // Dec 31, 2025 (Format: Year, Month-1, Day)

// 2. IMPORT FROM DATABASE.JS
const { 
    db, 
    checkUser, 
    addUser, 
    addProduct, 
    addPurchase, 
    getAllProducts, 
    processSaleManual, 
    getProductByBarcode, 
    addCategory, 
    getSaleDetails, 
    getCategories, 
    getBillDetails, // <--- MAKE SURE THIS IS HERE
    processCustomerReturn, 
    processSupplierReturn,
    searchBatchesByName,
    updateProduct,
    deleteCategory,
    updateCategory,
    getPurchases,
    updatePurchase, getReturnHistoryBySale,
    changeUserPassword,
    getReturnHistory,
    getNearExpiryReport
} = require('./database.js');
 

let win;
Menu.setApplicationMenu(null); 

function createWindow() {
    // EXPIRY CHECK
    const today = new Date();
    if (today > EXPIRY_DATE) {
        dialog.showErrorBox(
            "System Lock", 
            "Your license has expired. Please contact the administrator to continue using this software. Contact: 0322-5366745, E-mail: itsmeaamer85@gmail.com"
        );
        app.quit();
        return;
    }
    

    win = new BrowserWindow({
        
        width: 1100,
        height: 850,
        titleBarStyle: "default",
        backgroundColor: "#fdf0d5",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), 
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // FIX: Using path.join for reliable file loading
    win.loadFile(path.join(__dirname, 'components', 'login.html'));
    win.on('closed', () => { win = null; });
}
//licence status
ipcMain.handle('get-license-status', () => {
    const today = new Date();
    const diffTime = EXPIRY_DATE - today;
    
    if (diffTime <= 0) return "Expired";

    const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const months = Math.floor(totalDays / 30);
    const days = totalDays % 30;

    return `${months} Months, ${days} Days Remaining`;
});


// Add a function to create sales windows
function createSalesWindow(page, user) {
  const salesWin = new BrowserWindow({
    width: 1000,
    height: 800,
    backgroundColor: "#fdf0d5",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Construct the path with the user as a query parameter
  const filePath = path.join(__dirname, 'components', page);
  salesWin.loadURL(`file://${filePath}?user=${encodeURIComponent(user)}`);
}


// Add an IPC listener to trigger these windows
ipcMain.on('open-sales-window', (event, data) => {
  // data will be an object like { page: 'sale.html', user: 'Admin' }
  createSalesWindow(data.page, data.user);
});
// --- IPC HANDLERS ---

// Navigation Helper (Use this to change pages from your frontend)
ipcMain.on('change-page', (event, fileName) => {
    if (win) {
        win.loadFile(path.join(__dirname, 'components', fileName));
    }
});

// Auth
ipcMain.handle('login-attempt', async (event, credentials) => {
    try {
        const user = checkUser(credentials.username, credentials.password);
        return user ? { success: true, user } : { success: false, message: "Invalid credentials" };
    } catch (err) { return { success: false, message: "Database Error" }; }
});

ipcMain.handle('add-user', async (event, userData) => {
    try { addUser(userData); return { success: true }; } 
    catch (err) { return { success: false, error: err.message }; }
});

ipcMain.on('logout-trigger', () => { 
    if (win) win.loadFile(path.join(__dirname, 'components', 'login.html')); 
});

// Inventory
ipcMain.handle('add-item', async (event, itemData) => {
    try {
        const info = addProduct(itemData);
        return { success: true, id: info.lastInsertRowid };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('get-products', async () => {
    try { return db.prepare('SELECT id, name FROM products').all(); } 
    catch (err) { return []; }
});

ipcMain.handle('get-all-inventory', async () => {
    try { return getAllProducts(); } 
    catch (err) { return []; }
});

ipcMain.handle('save-purchase', async (event, purchaseData) => {
    try { addPurchase(purchaseData); return { success: true }; } 
    catch (err) { return { success: false, error: err.message }; }
});


ipcMain.handle('process-sale-manual', async (event, saleData) => {
    try {
        // Call the function we just created in database.js
        return processSaleManual(saleData); 
    } catch (err) {
        console.error("Sale Process Error:", err);
        return { success: false, error: err.message };
    }
});
//edit and update category

ipcMain.handle('delete-category', async (event, id) => {
    try { return { success: true, result: deleteCategory(id) }; } 
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('update-category', async (event, { id, name }) => {
    try { return { success: true, result: updateCategory(id, name) }; } 
    catch (e) { return { success: false, error: e.message }; }
});

//code ends update edit vategory


ipcMain.handle('get-product-by-barcode', (event, barcode) => {
    try { return getProductByBarcode(barcode); } catch (err) { return null; }
});

ipcMain.handle('add-category', async (event, categoryName) => {
    try { return addCategory(categoryName); } 
    catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-categories', async () => {
    try { return getCategories(); } catch (error) { return []; }
});

ipcMain.handle('get-sales-report', async (event, { date, username }) => {
    try {
        const { getSalesReportWithDetails } = require('./database.js');
        return getSalesReportWithDetails(date, username);
    } catch (err) {
        console.error("Report Error:", err);
        return [];
    }
});

// User Management
ipcMain.handle('get-all-users', async () => {
    try {
        const { getAllUsers } = require('./database.js'); 
        return getAllUsers();
    } catch (err) {
        console.error("Error fetching users:", err);
        return [];
    }
});
// Update your search handler to use the 'db' object correctly

ipcMain.handle('search-batches', async (event, query) => {
    try {
        // This calls the function we wrote in the previous step in Database.js
        return searchBatchesByName(query);
    } catch (err) {
        console.error("Search Error in Main:", err);
        return [];
    }
});

ipcMain.handle('delete-user', async (event, id) => {
    try {
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// UI Fixes
ipcMain.on('fix-focus', (event) => {
    const focusedWindow = BrowserWindow.fromWebContents(event.sender);
    if (focusedWindow) {
        focusedWindow.setIgnoreMouseEvents(false); 
        focusedWindow.blur();
        setTimeout(() => {
            if (!focusedWindow.isDestroyed()) {
                focusedWindow.focus();
                focusedWindow.webContents.focus();
            }
        }, 50);
    }
});

// Product Updates
ipcMain.handle('update-price', async (event, { id, price }) => {
    try {
        const stmt = db.prepare('UPDATE products SET price = ? WHERE id = ?');
        stmt.run(price, id);
        return { success: true };
    } catch (err) {
        console.error("Price Update Error:", err);
        return { success: false, error: err.message };
    }
});

// Low Stock Reporting

// Add this in main.js along with your other ipcMain.handle functions
ipcMain.handle('get-dashboard-stats', async () => {
    const { getDashboardStats } = require('./database.js'); // Ensure it's imported
    return getDashboardStats();
});

// In main.js
ipcMain.handle('get-inventory', async () => {
    // Make sure 'selling_price' and 'quantity' are explicitly in the SELECT
    const sql = `SELECT id, name, batch_no, selling_price, quantity, min_stock_level, category FROM products`;
    return db.prepare(sql).all();
});

//low stock report

ipcMain.handle('get-low-stock-report', async () => {
    try {
        // We need 'barcode' and 'min_stock_level' specifically
       const sql = `
    SELECT name, stock, stock, min_stock_level
    FROM products
    WHERE stock < (min_stock_level / 2.0)
`;
        return db.prepare(sql).all();
    } catch (err) {
        console.error("Database Error:", err);
        return [];
    }
});
//purchases
ipcMain.handle('get-purchases', async () => {
    try {
        return getPurchases(); // Calls the function in your database.js
    } catch (error) {
        console.error("Failed to fetch purchases:", error);
        return [];
    }
});

ipcMain.handle('update-purchase', async (event, data) => {
    try {
        return updatePurchase(data); // Calls the function in your database.js
    } catch (error) {
        console.error("Failed to update purchase:", error);
        return { success: false, error: error.message };
    }
});
//purchases ends

// --- RETURNS HANDLERS ---

// Customer Return (Increases Stock)
ipcMain.handle('process-customer-return', async (event, data) => {
    return processCustomerReturn(data);
});
ipcMain.handle('get-sale-details', async (event, saleId) => {
    try {
        const details = getSaleDetails(saleId);
        return details;
    } catch (err) {
        console.error("Error fetching bill details:", err);
        return [];
    }
});




// Supplier Return (Decreases Stock)
ipcMain.handle('process-supplier-return', async (event, data) => {
    return processSupplierReturn(data); 
});

ipcMain.handle('update-product-stock-level', async (event, id, newLevel) => {
    try {
        const sql = `UPDATE products SET min_stock_level = ? WHERE id = ?`;
        const stmt = db.prepare(sql);
        stmt.run(newLevel, id);
        return { success: true };
    } catch (err) {
        console.error("Database Error:", err);
        return { success: false, error: err.message };
    }
});

//low stock report ends
//expiry reports starts
// Add this inside the IPC HANDLERS section of main.js
ipcMain.handle('get-near-expiry-report', async () => {
    try {
        return getNearExpiryReport();
    } catch (err) {
        console.error("IPC Error:", err);
        return [];
    }
});
//update product
ipcMain.handle('update-product', async (event, data) => {
    return updateProduct(data);
});

//return history
ipcMain.handle('get-return-history', async (event, saleId) => {
    try {
        // REMOVE 'db.' from the line below
        // You imported the function directly at the top of the file
        return getReturnHistory(saleId); 
    } catch (error) {
        console.error("Database Error:", error);
        throw error;
    }
});

//return item detail
ipcMain.handle('get-return-history-by-sale', async (event, saleId) => {
    return getReturnHistoryBySale(saleId);
});

// main.js around line 378
ipcMain.handle('get-bill-details', async (event, billId) => {
    try {
        const { getBillDetails } = require('./database.js');
        return getBillDetails(billId); 
    } catch (error) {
        console.error("IPC Error:", error);
        return { success: false, message: error.message };
    }
});


//change password
ipcMain.handle('change-password', async (event, currentP, newP) => {
    return changeUserPassword(currentP, newP);
});
//expiry reports ends
// --- LIFECYCLE ---
app.whenReady().then(createWindow);
ipcMain.on('open-db-folder', () => {
  const userDataPath = app.getPath('userData');
  shell.openPath(userDataPath); // This opens the folder for the user automatically
});
app.on('window-all-closed', () => { 
    if (process.platform !== 'darwin') app.quit(); 
});

app.on('will-quit', () => { 
    globalShortcut.unregisterAll(); 
    if (db) db.close(); 
});
