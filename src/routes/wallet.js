const express = require("express");
const StellarSdk = require("stellar-sdk");
const fetch = require("node-fetch");
const Wallet = require("../models/wallet");

const router = express.Router();

const server = new StellarSdk.Horizon.Server(
  "https://horizon-testnet.stellar.org"
);

router.post("/wallets", async (req, res) => {
  try {
    
    const keypair = StellarSdk.Keypair.random();
    const publicKey = keypair.publicKey();

    
    await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
    );

    
    const wallet = await Wallet.create({
      publicKey,
    });

    return res.status(201).json({
      walletId: wallet.walletId,
      publicKey: wallet.publicKey,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to create wallet",
      error: error.message,
    });
  }
});


router.get("/wallet/:id", async (req, res) => {
  try {
    const { id } = req.params;

    
    const wallet = Wallet.getById(id);

    if (!wallet) {
      return res.status(404).json({
        message: "Wallet not found",
      });
    }

    
    const account = await server.loadAccount(wallet.publicKey);


    const nativeBalance = account.balances.find(
      (balance) => balance.asset_type === "native"
    );

    return res.status(200).json({
      walletId: wallet.walletId,
      balance: nativeBalance.balance,
      asset: "XLM",
    });

  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch wallet balance",
      error: error.message,
    });
  }
});

module.exports = router;

