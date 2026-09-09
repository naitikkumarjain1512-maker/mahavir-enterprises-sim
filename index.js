// index.js -- Cloud Run + Cloud SQL aware
const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const COMPANY_ID = 'mahavir_enterprises';
const SELL_DISCOUNT = 0.04; // seller receives 96% of market price

function makePoolFromEnv() {
  // Priority:
  // 1) DATABASE_URL (full connection string)
  // 2) Cloud Run + Cloud SQL socket (DB_USER/DB_PASS/DB_NAME + CLOUD_SQL_CONNECTION_NAME)
  // 3) local fallback: postgres://sim:simpass@localhost:5432/simdb
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }
  if (process.env.CLOUD_SQL_CONNECTION_NAME && process.env.DB_USER && process.env.DB_PASS && process.env.DB_NAME) {
    return new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      host: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
      port: 5432
    });
  }
  // local fallback
  return new Pool({ connectionString: 'postgres://sim:simpass@localhost:5432/simdb' });
}

const pool = makePoolFromEnv();

app.post('/api/sell', async (req, res) => {
  const { itemId, quantity } = req.body;
  if (!itemId || !Number.isInteger(quantity) || quantity <= 0) return res.json({ success: false, error: 'Invalid request' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock company row
    const companyRes = await client.query('SELECT * FROM companies WHERE id=$1 FOR UPDATE', [COMPANY_ID]);
    if (companyRes.rowCount === 0) { await client.query('ROLLBACK'); return res.json({ success: false, error: 'Company missing' }); }

    // Item
    const itemRes = await client.query('SELECT * FROM items WHERE id=$1', [itemId]);
    if (itemRes.rowCount === 0) { await client.query('ROLLBACK'); return res.json({ success: false, error: 'Unknown item' }); }
    const item = itemRes.rows[0];
    if (!item.sellable) { await client.query('ROLLBACK'); return res.json({ success: false, error: 'Item not sellable' }); }

    // Lock inventory row
    const invRes = await client.query('SELECT * FROM inventory WHERE company_id=$1 AND item_id=$2 FOR UPDATE', [COMPANY_ID, itemId]);
    if (invRes.rowCount === 0 || invRes.rows[0].qty < quantity) { await client.query('ROLLBACK'); return res.json({ success: false, error: 'Not enough items' }); }

    // Lock or create market state
    let msRes = await client.query('SELECT * FROM market_state WHERE item_id=$1 FOR UPDATE', [itemId]);
    if (msRes.rowCount === 0) {
      await client.query('INSERT INTO market_state (item_id, price_factor, buy_volume, sell_volume) VALUES ($1,1,0,0)', [itemId]);
      msRes = await client.query('SELECT * FROM market_state WHERE item_id=$1 FOR UPDATE', [itemId]);
    }
    const ms = msRes.rows[0];

    const marketUnitPrice = Math.round(item.base_price * ms.price_factor);
    const unitPrice = Math.round(marketUnitPrice * (1 - SELL_DISCOUNT));
    const totalGross = unitPrice * quantity;
    const fee = 0;
    const totalNet = totalGross - fee;

    // Update inventory
    const newQty = invRes.rows[0].qty - quantity;
    await client.query('UPDATE inventory SET qty=$1 WHERE company_id=$2 AND item_id=$3', [newQty, COMPANY_ID, itemId]);

    // Update balance
    const newBalance = companyRes.rows[0].balance + totalNet;
    await client.query('UPDATE companies SET balance=$1 WHERE id=$2', [newBalance, COMPANY_ID]);

    // Update market state
    const newSellVol = ms.sell_volume + quantity;
    const newFactor = Math.max(0.2, Math.min(5.0, ms.price_factor * (1 - 0.001 * quantity)));
    await client.query('UPDATE market_state SET sell_volume=$1, price_factor=$2, last_updated=now() WHERE item_id=$3', [newSellVol, newFactor, itemId]);

    // Insert transaction record
    await client.query(
      `INSERT INTO transactions (company_id,item_id,qty,unit_price,total_gross,fee,total_net,type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [COMPANY_ID, itemId, quantity, unitPrice, totalGross, fee, totalNet, 'sell']
    );

    await client.query('COMMIT');

    res.json({ success: true, unitPrice, totalGross, fee, totalNet, balance: newBalance, remainingQty: newQty });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('sell error', err);
    res.json({ success: false, error: 'Server error' });
  } finally {
    client.release();
  }
});

app.get('/api/price-preview', async (req, res) => {
  const itemId = req.query.itemId;
  const qty = parseInt(req.query.qty || '1', 10);
  if (!itemId || !qty || qty <= 0) return res.json({ success: false, error: 'Invalid' });

  const client = await pool.connect();
  try {
    const itemRes = await client.query('SELECT * FROM items WHERE id=$1', [itemId]);
    if (itemRes.rowCount === 0) return res.json({ success: false, error: 'Unknown item' });
    const item = itemRes.rows[0];

    const msRes = await client.query('SELECT * FROM market_state WHERE item_id=$1', [itemId]);
    const factor = msRes.rowCount ? msRes.rows[0].price_factor : 1.0;
    const marketUnit = Math.round(item.base_price * factor);
    const unitPrice = Math.round(marketUnit * (1 - SELL_DISCOUNT));
    const total = unitPrice * qty;
    res.json({ success: true, marketUnit, unitPrice, total });
  } catch (err) {
    console.error('preview error', err);
    res.json({ success: false, error: 'Server error' });
  } finally {
    client.release();
  }
});

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log('API listening on', port));
