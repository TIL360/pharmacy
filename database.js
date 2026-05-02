const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

const userDataPath = app.getPath('userData');
//this line would create db insie appdata
const dbPath = path.join(userDataPath, 'pharmacy.db');

// this would create db file inside the root area of the app
// const dbPath = path.join(__dirname, 'pharmacy.db');


if (!fs.existsSync(userDataPath)) {
    // fs.mkdirSync(userDataPath, { recursive: true });
}

const db = new Database(dbPath, { verbose: console.log });

const initializeDB = () => {
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, usertype TEXT CHECK(usertype IN ('Admin', 'User')) DEFAULT 'User')`);
        db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    name TEXT NOT NULL, 
    cost_price REAL DEFAULT 0.0, 
    price REAL NOT NULL, 
    stock INTEGER DEFAULT 0, 
    min_stock_level INTEGER DEFAULT 0, 
    category TEXT,
     status TEXT DEFAULT 'Active'
)`);
        db.exec(`CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)`);
      // Ensure purchases remains as is, as it holds the batch info
db.exec(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    product_id INTEGER, 
    quantity INTEGER, 
    cost_price REAL DEFAULT 0.0, 
    supplier TEXT, 
    batch_no TEXT, 
    expiry_date TEXT, 
    purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP, 
    FOREIGN KEY(product_id) REFERENCES products(id)
)`);

  // Replace inside your initializeDB function
db.exec(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    customer_name TEXT, 
    total REAL, 
    discount REAL DEFAULT 0.0, 
    cash_received REAL DEFAULT 0.0, 
    payment_method TEXT, 
    change_due REAL DEFAULT 0.0, 
    sale_date DATETIME DEFAULT CURRENT_TIMESTAMP, 
    processed_by TEXT, 
    refund_amount REAL DEFAULT 0.0, 
    return_date DATETIME
)`);

db.exec(`CREATE TABLE IF NOT EXISTS return_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER,
    product_id INTEGER,
    quantity_returned INTEGER,
    refund_amount REAL,
    return_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
)`);



    db.exec(`CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      sale_id INTEGER, 
      product_id INTEGER, 
      quantity INTEGER, 
      price REAL, 
      FOREIGN KEY(sale_id) REFERENCES sales(id)
    )`);

        const userCount = db.prepare('SELECT count(*) as count FROM users').get();
        if (userCount.count === 0) {
            db.prepare('INSERT INTO users (username, password, usertype) VALUES (?, ?, ?)')
              .run('Admin', 'admin123', 'Admin');
        }
    } catch (err) { console.error("DB Init Error:", err); }
};
initializeDB();

// --- FUNCTIONS ---
function checkUser(username, password) { return db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password); }
function addUser(userData) { return db.prepare('INSERT INTO users (username, password, usertype) VALUES (?, ?, ?)').run(userData.username, userData.password, userData.usertype); }
function getAllUsers() { return db.prepare('SELECT id, username FROM users').all(); }
function addProduct(item) {
    const transaction = db.transaction(() => {
        // 1. Auto-generate Batch No and Expiry (1 month from today)
        const autoBatch = "B-" + Date.now(); // Creates a unique batch ID like B-1711212345
        
        const today = new Date();
        today.setMonth(today.getMonth() + 1); // Move 1 month ahead
        const autoExpiry = today.toISOString().split('T')[0]; // Formats as YYYY-MM-DD

        // 2. Insert into products table (No batch/expiry here as requested)
        const info = db.prepare(`
            INSERT INTO products (name, cost_price, price, stock, min_stock_level, category) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            item.name, 
            item.cost_price, 
            item.price, 
            item.stock, 
            item.min_stock_level, 
            item.category
        );
        
        const productId = info.lastInsertRowid;

        // 3. Insert into purchases table with AUTO-GENERATED values
        db.prepare(`
            INSERT INTO purchases (product_id, quantity, cost_price, batch_no, expiry_date, supplier) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            productId, 
            item.stock, 
            item.cost_price, 
            autoBatch,    // Using the auto-generated batch
            autoExpiry,   // Using the 1-month-ahead expiry
            "Initial Stock"
        );

        return { lastInsertRowid: productId }; 
    });
    return transaction();
}


function getAllProducts() { return db.prepare('SELECT * FROM products ORDER BY id DESC').all(); }
function getProductByBarcode(barcode) { return db.prepare('SELECT * FROM products WHERE batch_no = ?').get(barcode); }
function addCategory(name) { try { db.prepare('INSERT INTO categories (name) VALUES (?)').run(name); return { success: true }; } catch (e) { return { success: false, error: e.message }; } }
function getCategories() { try { const rows = db.prepare('SELECT id, name FROM categories ORDER BY name ASC').all(); return { success: true, categories: rows }; } catch (e) { return { success: false, error: e.message }; } }

function addPurchase(data) {
    const autoBatch = "B-" + Date.now(); // Auto-generated unique ID
    const transaction = db.transaction(() => {
        db.prepare(`INSERT INTO purchases (product_id, quantity, cost_price, supplier, batch_no, expiry_date) 
                    VALUES (?, ?, ?, ?, ?, ?)`).run(
            data.productId, 
            data.quantity, 
            data.costPrice, 
            data.supplier, 
            autoBatch, // Auto-inserted
            data.expiry_date
        );
        // Only update total stock in products table
        db.prepare(`UPDATE products SET stock = stock + ?, cost_price = ? WHERE id = ?`).run(
            data.quantity, 
            data.costPrice, 
            data.productId
        );
    });
    return transaction();
}


function processSaleManual(saleData) {
    const transaction = db.transaction(() => {
        // UPDATE THIS QUERY to include the missing columns
        const saleStmt = db.prepare(`
            INSERT INTO sales (
                customer_name, 
                total, 
                discount, 
                cash_received, 
                change_due, 
                processed_by, 
                sale_date,
                payment_method
            ) 
            VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'),?)
        `);

        
       const info = saleStmt.run(
            saleData.customerName, 
            saleData.total, 
            saleData.discount,     // Add this
            saleData.cashReceived, // Add this
            saleData.changeDue,    // Add this
            saleData.processedBy,
            saleData.paymentMethod
        );
        
         const saleId = info.lastInsertRowid;

        // 2. Prepare Statements for Items and Stock
        const itemInsert = db.prepare(`
            INSERT INTO sale_items (sale_id, product_id, quantity, price) 
            VALUES (?, ?, ?, ?)
        `);
        const productStockUpdate = db.prepare(`
            UPDATE products SET stock = stock - ? WHERE id = ?
        `);
        const batchStockUpdate = db.prepare(`
            UPDATE purchases SET quantity = quantity - ? 
            WHERE batch_no = ? AND product_id = ?
        `);

        // 3. Loop through items to update Inventory (FIFO/Batch logic)
        for (const item of saleData.items) {
            // A. Record the sold item
            itemInsert.run(saleId, item.id, item.qty, item.price);

            // B. Reduce Global Stock
            productStockUpdate.run(item.qty, item.id);

            // C. Reduce Specific Batch Stock
            batchStockUpdate.run(item.qty, item.batch, item.id);
        }

        return { success: true, saleId };
    });

    return transaction();
}



function getSalesReportByUser(date, username) {
    return db.prepare('SELECT id, customer_name, total, sale_date FROM sales WHERE date(sale_date) = ? AND processed_by = ? ORDER BY sale_date DESC').all(date, username);
}
//edit product
// Add this inside database.js
// Inside Database.js
function updateProduct(data) {
    try {
        const stmt = db.prepare(`
            UPDATE products 
            SET name = ?, 
                category = ?, 
                cost_price = ?, 
                price = ?, 
                stock = ?, 
                min_stock_level = ?, 
                status = ? -- Added this
            WHERE id = ?
        `);

        const info = stmt.run(
            data.name, 
            data.category, 
            data.cost_price, 
            data.price, 
            data.stock, 
            data.min_stock_level, 
            data.status, // Added this
            data.id
        );
        return { success: info.changes > 0 };
    } catch (err) {
        console.error("Update Error:", err);
        return { success: false, error: err.message };
    }
}



function getReorderList() {
    return db.prepare('SELECT name, stock, min_stock_level, category FROM products WHERE stock <= (min_stock_level * 0.5)').all();
}

// DASHBOARD STATS FUNCTION
function getDashboardStats() {
    try {
        // Today's Sales & Orders (Existing)
        const revenue = db.prepare(`SELECT SUM(total) as total FROM sales WHERE date(sale_date) = date('now', 'localtime')`).get().total || 0;
        const orders = db.prepare(`SELECT COUNT(*) as count FROM sales WHERE date(sale_date) = date('now', 'localtime')`).get().count || 0;
        const activeProducts = db.prepare(`SELECT COUNT(*) as count FROM products WHERE status = 'Active'`).get().count || 0;
        const monthlySales = db.prepare(`SELECT SUM(total) as total FROM sales WHERE strftime('%m', sale_date) = strftime('%m', 'now')`).get().total || 0;

        // --- NEW PROFIT LOGIC ---
        // Daily Profit: (Sale Price - Cost Price) * Quantity for today's sales
        const dailyProfit = db.prepare(`
            SELECT SUM((si.price - p.cost_price) * si.quantity) as profit
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE date(s.sale_date) = date('now', 'localtime')
        `).get().profit || 0;

        // Monthly Profit: (Sale Price - Cost Price) * Quantity for current month
        const monthlyProfit = db.prepare(`
            SELECT SUM((si.price - p.cost_price) * si.quantity) as profit
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE strftime('%m', s.sale_date) = strftime('%m', 'now')
        `).get().profit || 0;

        return { 
            success: true, 
            revenue, 
            orders, 
            activeProducts, 
            monthlySales, 
            dailyProfit, 
            monthlyProfit 
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}



//low stcok function
function getLowStockReport() {
    try {
        const sql = `
            SELECT 
                name, 
                stock, 
                min_stock_level
            FROM products 
            WHERE stock <= min_stock_level
            ORDER BY stock ASC
        `;
        return db.prepare(sql).all();
    } catch (err) {
        console.error("Database Error:", err);
        return [];
    }
}




//low stock code ends

//expiry report starts
// Add this function inside database.js
function getNearExpiryReport() {
    try {
        // Corrected SQL syntax for SQLite
        const sql = `
            SELECT 
                p.id, 
                p.name, 
                pur.batch_no,
                pur.expiry_date,
                pur.quantity,
                p.category,
                p.stock
            FROM purchases pur 
            JOIN products p ON pur.product_id = p.id 
            WHERE pur.expiry_date IS NOT NULL 
            AND pur.quantity > 0
              AND date(pur.expiry_date) BETWEEN date('now') AND date('now', '+30 days')
            ORDER BY pur.expiry_date ASC
        `;
        
        return db.prepare(sql).all();
    } catch (err) {
        console.error("Database Error in getNearExpiryReport:", err);
        return [];
    }
}

//expiry report ends

//return
// --- RETURN FUNCTIONS ---

// 1. Customer Return: Customer -> You (Inventory Increases)
function processCustomerReturn(returnData) {
    const { saleItemId, saleId, returnQty } = returnData;

    const transaction = db.transaction(() => {
        // 1. Get the specific line item from the bill
        const item = db.prepare(`
            SELECT product_id, batch_no, price, quantity 
            FROM sale_items 
            WHERE id = ?
        `).get(saleItemId);

        if (!item) throw new Error("Sale item record not found");
        if (item.quantity < returnQty) throw new Error("Cannot return more than purchased");

        // 2. Reduce the quantity in the bill (sale_items)
        db.prepare('UPDATE sale_items SET quantity = quantity - ? WHERE id = ?')
          .run(returnQty, saleItemId);

        // 3. Deduct the amount from the main Bill Total (sales)
        const refundAmount = item.price * returnQty;
        db.prepare('UPDATE sales SET total = total - ? WHERE id = ?')
          .run(refundAmount, saleId);

        // 4. Put the stock back into the correct product batch
        // We use the product_id and batch_no we found in step 1
        const updateStock = db.prepare(`
            UPDATE products 
            SET stock = stock + ? 
            WHERE id = ? AND batch_no = ?
        `).run(returnQty, item.product_id, item.batch_no);

        if (updateStock.changes === 0) {
            throw new Error("Could not find matching product batch to update stock");
        }

        return { success: true };
    });

    try {
        return transaction();
    } catch (error) {
        return { success: false, error: error.message };
    }
}




// 2. Supplier Return: You -> Supplier (Inventory Decreases)
function processSupplierReturn(data) {
    const transaction = db.transaction(() => {
        // 1. Subtract from the main product total
        db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?")
          .run(data.quantity, data.productId);

        // 2. Subtract from the specific batch in purchases
        db.prepare("UPDATE purchases SET quantity = quantity - ? WHERE batch_no = ? AND product_id = ?")
          .run(data.quantity, data.batchNo, data.productId);

        // 3. Optional: Record in a separate returns table for history
        // db.prepare("INSERT INTO returns (product_id, batch_no, qty, type) VALUES (?, ?, ?, 'SUPPLIER')").run(...)
    });
    
    try {
        transaction();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Add this to database.js
// --- Updated getSaleDetails ---
function getSaleDetails(saleId) {
    const id = Number(saleId);
    const saleInfo = db.prepare('SELECT total FROM sales WHERE id = ?').get(id);
    if (!saleInfo) return null;

    const items = db.prepare(`
        SELECT 
            si.id, 
            si.product_id, 
            p.name, 
            pur.batch_no, 
            si.quantity, 
            si.price 
        FROM sale_items si 
        JOIN products p ON si.product_id = p.id 
        LEFT JOIN purchases pur ON p.id = pur.product_id
        WHERE si.sale_id = ?
        GROUP BY si.id
    `).all(id);

    return { billTotal: saleInfo.total, items: items };
}

// --- Updated processCustomerReturn ---
function processCustomerReturn(returnData) {
    const { saleItemId, saleId, returnQty } = returnData;
    const transaction = db.transaction(() => {
        // 1. Get item details
        const item = db.prepare(`
            SELECT si.product_id, pur.batch_no, si.price, si.quantity 
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN purchases pur ON p.id = pur.product_id
            WHERE si.id = ?
        `).get(saleItemId);

        if (!item) throw new Error("Item not found");
        const refundValue = item.price * returnQty;

        // 2. Log History
        db.prepare(`INSERT INTO return_history (sale_id, product_id, quantity_returned, refund_amount)
                    VALUES (?, ?, ?, ?)`).run(saleId, item.product_id, returnQty, refundValue);

        // 3. Update Sales Table (CRITICAL for your UI)
        db.prepare(`UPDATE sales SET 
                    total = total - ?, 
                    refund_amount = IFNULL(refund_amount, 0) + ?, 
                    return_date = CURRENT_TIMESTAMP 
                    WHERE id = ?`).run(refundValue, refundValue, saleId);

        // 4. Update Inventory
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(returnQty, item.product_id);
        if (item.batch_no) {
            db.prepare('UPDATE purchases SET quantity = quantity + ? WHERE batch_no = ? AND product_id = ?')
              .run(returnQty, item.batch_no, item.product_id);
        }

        // 5. Reduce sale item qty or delete if 0
        db.prepare('UPDATE sale_items SET quantity = quantity - ? WHERE id = ?').run(returnQty, saleItemId);
        db.prepare('DELETE FROM sale_items WHERE id = ? AND quantity <= 0').run(saleItemId);

        return { success: true };
    });
    return transaction();
}


function getBillDetails(saleId) {
    const id = Number(saleId);
    // Added discount, cash_received, and change_due to the SELECT
    const bill = db.prepare('SELECT id, total, discount, cash_received, change_due, refund_amount, return_date, customer_name FROM sales WHERE id = ?').get(id);
    
    if (!bill) return { success: false };

    const items = db.prepare(`
        SELECT si.id as sale_item_id, p.name, pur.batch_no as barcode, 
               si.quantity, si.price, si.product_id
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        LEFT JOIN purchases pur ON p.id = pur.product_id
        WHERE si.sale_id = ?
        GROUP BY si.id
    `).all(id);

    return { success: true, bill, items };
}




function searchBatchesByName(query) {
    const sql = `
        SELECT 
            p.id as product_id,
            p.name,
            pur.batch_no,
            pur.expiry_date,
            pur.cost_price,
            p.price,
            pur.quantity as batch_stock
        FROM purchases pur
        JOIN products p ON pur.product_id = p.id
        WHERE (p.name LIKE ? OR pur.batch_no LIKE ?) AND pur.quantity > 0
        ORDER BY pur.expiry_date ASC
    `;
    const searchVal = `%${query}%`;
    return db.prepare(sql).all(searchVal, searchVal);
}


function deleteCategory(id) {
    return db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

function updateCategory(id, newName) {
    return db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(newName, id);
}
// Add to module.exports...
// Fetch purchases joined with product names
function getPurchases() {
    return db.prepare(`
        SELECT p.*, pr.name as product_name 
        FROM purchases p 
        JOIN products pr ON p.product_id = pr.id 
        ORDER BY p.purchase_date DESC
    `).all();
}

// Update specific purchase record
function updatePurchase(data) {
    try {
        // 1. Fetch current record to check if batch_no is null
        const current = db.prepare("SELECT batch_no FROM purchases WHERE id = ?").get(data.id);
        
        let batchToSave = current.batch_no;

        // 2. If existing batch is null or empty, generate a new one
        if (!batchToSave || batchToSave === "null" || batchToSave === "") {
            batchToSave = "B-" + Date.now();
        }

        // 3. Perform the update
        const stmt = db.prepare(`
            UPDATE purchases 
            SET batch_no = ?, expiry_date = ?, quantity = ? 
            WHERE id = ?
        `);
        
        const info = stmt.run(
            batchToSave, 
            data.expiry_date, 
            data.quantity, 
            data.id
        );

        return { success: info.changes > 0 };
    } catch (err) {
        console.error("Update Error:", err);
        return { success: false, error: err.message };
    }
}

function getReturnHistory() {
    try {
        return db.prepare(`
            SELECT 
                rh.id, 
                rh.sale_id, 
                p.name AS product_name, 
                rh.quantity_returned, 
                rh.refund_amount, 
                rh.return_date 
            FROM return_history rh
            JOIN products p ON rh.product_id = p.id
            ORDER BY rh.return_date DESC
        `).all();
    } catch (error) {
        console.error("Error fetching return history:", error);
        return [];
    }
}
function getReturnHistoryBySale(saleId) {
    return db.prepare(`
        SELECT p.name, rh.quantity_returned, rh.refund_amount, rh.return_date 
        FROM return_history rh
        JOIN products p ON rh.product_id = p.id
        WHERE rh.sale_id = ?
    `).all(saleId);
}

// Don't forget to add getSaleDetails to your module.exports!
// database.js
function changeUserPassword(currentPass, newPass) {
    try {
        // 1. Check if the current password is correct (Assuming user ID 1 for single-user system)
        const user = db.prepare("SELECT password FROM users WHERE id = 1").get();
        
        if (user.password !== currentPass) {
            return { success: false, message: "Current password incorrect." };
        }
        
        // 2. Update to new password
        db.prepare("UPDATE users SET password = ? WHERE id = 1").run(newPass);
        return { success: true };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

// Don't forget to add changeUserPassword to module.exports!
function getSalesReportWithDetails(date, username) {
    const sql = `
        SELECT 
            s.id as sale_id, s.customer_name, s.sale_date, s.payment_method, s.total as grand_total,
            si.product_id, p.name as product_name, si.quantity, si.price
        FROM sales s
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        WHERE date(s.sale_date) = ? AND s.processed_by = ?
        ORDER BY s.sale_date DESC
    `;
    const rows = db.prepare(sql).all(date, username);
    
    const report = [];
    rows.forEach(row => {
        let sale = report.find(s => s.id === row.sale_id);
        if (!sale) {
            sale = {
                id: row.sale_id,
                customer: row.customer_name || 'Walking Customer',
                time: row.sale_date,
                total: row.grand_total,
                payment_method: row.payment_method, // CRITICAL: Add this line
                items: []
            };
            report.push(sale);
        }
        sale.items.push({
            id: row.product_id,
            name: row.product_name,
            qty: row.quantity,
            price: row.price
        });
    });
    return report;
}


// CRITICAL: ALL FUNCTIONS MUST BE EXPORTED HERE
module.exports = { 
    db,
    getAllUsers,
    checkUser, 
    addUser, 
    addProduct, 
    addPurchase, 
    getAllProducts, 
    processSaleManual, 
    getProductByBarcode, 
    addCategory, 
    getCategories,
    getReorderList,
    getSalesReportByUser,
    getDashboardStats, // <--- ADD THIS LINE HERE
    getLowStockReport,
    processSupplierReturn,
    processCustomerReturn,
    getSaleDetails,
    searchBatchesByName,
    getNearExpiryReport,
    updateProduct,
    deleteCategory,
    updateCategory,
    getPurchases,
    updatePurchase, getReturnHistoryBySale, getSalesReportWithDetails, changeUserPassword, getReturnHistory,
    getBillDetails
};  