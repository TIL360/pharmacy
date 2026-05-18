// POS main.js - COMPLETE VERSION WITH DATE TAMPER PROTECTION
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

const { app, BrowserWindow, Menu, globalShortcut, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// --- 1. CONFIGURATION & PATHS ---
// Change this line to target June 30 exactly
const EXPIRY_DATE = new Date(2026, 5, 31); 
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json'); 

// --- 2. DATABASE IMPORTS ---
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
    getBillDetails, 
    processCustomerReturn, 
    processSupplierReturn,
    searchBatchesByName,
    updateProduct,
    deleteCategory,
    updateCategory,
    getPurchases,
    updatePurchase, 
    getReturnHistoryBySale,
    changeUserPassword,
    getReturnHistory,
    getNearExpiryReport
} = require('./database.js');

let win;

Menu.setApplicationMenu(null); 

// --- 3. CORE WINDOW LOGIC ---
function createWindow() {
    // OFFLINE PROTECTION & DATE TAMPERING LOGIC
    const today = new Date();
    let lastRunDate;

    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath));
            lastRunDate = new Date(config.lastRun);
        } catch (e) {
            lastRunDate = today;
        }
    } else {
        lastRunDate = today;
    }

    // Check A: Clock Tampering (Clock set back)
    if (today < lastRunDate) {
        dialog.showErrorBox(
            "Time Tamper Detected", 
            "Your system clock is incorrect or has been set back. Please correct your time settings to continue."
        );
        app.quit();
        return;
    }

    // Check B: License Expiry
    if (today > EXPIRY_DATE) {
        dialog.showErrorBox(
            "System Lock", 
            "Your license has expired. Please contact the administrator to continue.\nContact: 0322-5366745\nE-mail: itsmeaamer85@gmail.com"
        );
        app.quit();
        return;
    }

    // Update the "Last Run" date to today
    fs.writeFileSync(configPath, JSON.stringify({ lastRun: today.toISOString() }));

    win = new BrowserWindow({
        width: 1100,
        height: 850,
        title: "POS System",
        titleBarStyle: "default",
        backgroundColor: "#fdf0d5",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), 
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.loadFile(path.join(__dirname, 'components', 'login.html'));
    win.on('closed', () => { win = null; });
}

// --- 4. IPC HANDLERS (ALL FUNCTIONS) ---

// License & Navigation
ipcMain.handle('get-license-status', () => {
    const today = new Date();
    const diffTime = EXPIRY_DATE - today;
    if (diffTime <= 0) return "Expired";
    const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const months = Math.floor(totalDays / 30);
    const days = totalDays % 30;
    return `${months} Months, ${days} Days Remaining`;
});

ipcMain.on('change-page', (event, fileName) => {
    if (win) win.loadFile(path.join(__dirname, 'components', fileName));
});

// Sales Windows
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
    const filePath = path.join(__dirname, 'components', page);
    salesWin.loadURL(`file://${filePath}?user=${encodeURIComponent(user)}`);
}

ipcMain.on('open-sales-window', (event, data) => {
    createSalesWindow(data.page, data.user);
});

// Auth & User Management
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

ipcMain.handle('get-all-users', async () => {
    try {
        const { getAllUsers } = require('./database.js'); 
        return getAllUsers();
    } catch (err) { return []; }
});

ipcMain.handle('delete-user', async (event, id) => {
    try {
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('change-password', async (event, currentP, newP) => {
    return changeUserPassword(currentP, newP);
});

ipcMain.on('logout-trigger', () => { 
    if (win) win.loadFile(path.join(__dirname, 'components', 'login.html')); 
});

// Inventory, Products & Categories
ipcMain.handle('add-item', async (event, itemData) => {
    try {
        const info = addProduct(itemData);
        return { success: true, id: info.lastInsertRowid };
    } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('update-product', async (event, data) => {
    return updateProduct(data);
});

ipcMain.handle('get-all-inventory', async () => {
    try { return getAllProducts(); } catch (err) { return []; }
});

ipcMain.handle('get-inventory', async () => {
    const sql = `SELECT id, name, batch_no, selling_price, quantity, min_stock_level, category FROM products`;
    return db.prepare(sql).all();
});

ipcMain.handle('get-product-by-barcode', (event, barcode) => {
    try { return getProductByBarcode(barcode); } catch (err) { return null; }
});

ipcMain.handle('search-batches', async (event, query) => {
    try { return searchBatchesByName(query); } catch (err) { return []; }
});

ipcMain.handle('add-category', async (event, categoryName) => {
    try { return addCategory(categoryName); } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-categories', async () => {
    try { return getCategories(); } catch (error) { return []; }
});

ipcMain.handle('update-category', async (event, { id, name }) => {
    try { return { success: true, result: updateCategory(id, name) }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('delete-category', async (event, id) => {
    try { return { success: true, result: deleteCategory(id) }; } catch (e) { return { success: false, error: e.message }; }
});

// Sales & Bills
ipcMain.handle('process-sale-manual', async (event, saleData) => {
    try { return processSaleManual(saleData); } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('get-sale-details', async (event, saleId) => {
    try { return getSaleDetails(saleId); } catch (err) { return []; }
});

ipcMain.handle('get-bill-details', async (event, billId) => {
    try {
        const { getBillDetails } = require('./database.js');
        return getBillDetails(billId); 
    } catch (error) { return { success: false, message: error.message }; }
});

// Purchases
ipcMain.handle('save-purchase', async (event, purchaseData) => {
    try { addPurchase(purchaseData); return { success: true }; } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('get-purchases', async () => {
    try { return getPurchases(); } catch (error) { return []; }
});

ipcMain.handle('update-purchase', async (event, data) => {
    try { return updatePurchase(data); } catch (error) { return { success: false, error: error.message }; }
});

// Returns History
ipcMain.handle('process-customer-return', async (event, data) => {
    return processCustomerReturn(data);
});

ipcMain.handle('process-supplier-return', async (event, data) => {
    return processSupplierReturn(data); 
});

ipcMain.handle('get-return-history', async (event, saleId) => {
    try { return getReturnHistory(saleId); } catch (error) { throw error; }
});

ipcMain.handle('get-return-history-by-sale', async (event, saleId) => {
    return getReturnHistoryBySale(saleId);
});

// Reports & Stats
ipcMain.handle('get-dashboard-stats', async () => {
    const { getDashboardStats } = require('./database.js'); 
    return getDashboardStats();
});

ipcMain.handle('get-sales-report', async (event, { date, username }) => {
    try {
        const { getSalesReportWithDetails } = require('./database.js');
        return getSalesReportWithDetails(date, username);
    } catch (err) { return []; }
});

ipcMain.handle('get-near-expiry-report', async () => {
    try { return getNearExpiryReport(); } catch (err) { return []; }
});

ipcMain.handle('get-low-stock-report', async () => {
    try {
        const sql = `SELECT name, stock, stock, min_stock_level FROM products WHERE stock < (min_stock_level / 2.0)`;
        return db.prepare(sql).all();
    } catch (err) { return []; }
});

// UI Fixes & Utilities
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

ipcMain.on('open-db-folder', () => {
    shell.openPath(app.getPath('userData'));
});

// --- 5. LIFECYCLE ---
app.whenReady().then(createWindow);

app.on('window-all-closed', () => { 
    if (process.platform !== 'darwin') app.quit(); 
});

app.on('will-quit', () => { 
    globalShortcut.unregisterAll(); 
    if (db) db.close(); 
});
