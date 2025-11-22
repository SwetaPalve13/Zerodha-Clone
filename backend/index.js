require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");

const { HoldingsModel } = require("./model/HoldingsModel");
const { PositionsModel } = require("./model/PositionsModel");
const { OrdersModel } = require("./model/OrdersModel");

const PORT = process.env.PORT || 3002;
const uri = process.env.MONGO_URL;

const app = express();

app.use(cors());
app.use(bodyParser.json());

// ----------------- ROUTES -----------------

// Ensure HOLDINGS always return numbers → prevents toFixed() crash
const sanitizeHolding = (h) => ({
  ...h._doc,
  qty: Number(h.qty ?? 0),
  price: Number(h.price ?? 0),
});

// GET ALL HOLDINGS
app.get("/allHoldings", async (req, res) => {
  try {
    const holdings = await HoldingsModel.find({});
    const cleanData = holdings.map(sanitizeHolding);
    res.json(cleanData);
  } catch (error) {
    console.error("Error fetching holdings:", error);
    res.status(500).send("Error fetching holdings");
  }
});

// GET ALL POSITIONS
app.get("/allPositions", async (req, res) => {
  try {
    const allPositions = await PositionsModel.find({});
    res.json(allPositions);
  } catch (error) {
    console.error("Error fetching positions:", error);
    res.status(500).send("Error fetching positions");
  }
});

// ----------------- BUY ORDER -----------------
app.post("/newOrder", async (req, res) => {
  console.log("📩 New BUY order:", req.body);

  try {
    const { name, qty, price, mode } = req.body;

    if (!name || !qty || !price || !mode)
      return res.status(400).send("Missing required fields");

    const qtyNum = Number(qty);
    const priceNum = Number(price);

    // Save buy order
    await new OrdersModel({
      name,
      qty: qtyNum,
      price: priceNum,
      mode: "BUY",
    }).save();

    // Update holdings
    const existing = await HoldingsModel.findOne({
      name: new RegExp(`^${name}$`, "i"),
    });

    if (existing) {
      const totalValue = existing.qty * existing.price + qtyNum * priceNum;
      const totalQty = existing.qty + qtyNum;

      existing.qty = totalQty;
      existing.price = totalValue / totalQty;

      await existing.save();
    } else {
      await new HoldingsModel({
        name,
        qty: qtyNum,
        price: priceNum,
      }).save();
    }

    res.status(201).send("Buy order executed!");
  } catch (error) {
    console.error("Error processing BUY order:", error);
    res.status(500).send("Error processing buy order");
  }
});

// ----------------- SELL ORDER -----------------
app.post("/sellStock", async (req, res) => {
  console.log("📩 Sell request:", req.body);

  try {
    const { nameOrId, name, qty, price } = req.body;
    const identifier = nameOrId ?? name;

    if (!identifier || qty == null || price == null)
      return res.status(400).send("Missing required fields");

    const qtyNum = Number(qty);
    const priceNum = Number(price);

    let holding = null;

    // Search by ID first
    if (typeof identifier === "string" && /^[0-9a-fA-F]{24}$/.test(identifier)) {
      holding = await HoldingsModel.findById(identifier);
    }

    // Search by name if ID not found
    if (!holding) {
      holding = await HoldingsModel.findOne({
        name: new RegExp(`^${identifier}$`, "i"),
      });
    }

    if (!holding) {
      return res.status(404).send("Stock not found in holdings");
    }

    // Check quantity
    if (holding.qty < qtyNum) {
      return res
        .status(400)
        .send(`Not enough quantity. Available: ${holding.qty}`);
    }

    // Deduct qty
    holding.qty -= qtyNum;

    if (holding.qty === 0) {
      await HoldingsModel.deleteOne({ _id: holding._id });
    } else {
      await holding.save();
    }

    // Save sell order
    await new OrdersModel({
      name: holding.name,
      qty: qtyNum,
      price: priceNum,
      mode: "SELL",
    }).save();

    res.status(201).send("Stock sold successfully!");
  } catch (error) {
    console.error("Error processing sell:", error);
    res.status(500).send("Error processing sell request");
  }
});

// ----------------- MongoDB Connection -----------------
mongoose
  .connect(uri)
  .then(() => {
    console.log(" Connected to MongoDB");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error(" MongoDB connection failed:", error);
  });
