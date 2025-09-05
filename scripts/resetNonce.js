// scripts/resetNonce.js
const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();
async function main() {
    try {
        if (!process.env.PRIVATE_KEY || !process.env.AVALANCHE_RPC_URL) {
            throw new Error('Missing required environment variables');
        }

        const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
            ? process.env.PRIVATE_KEY
            : `0x${process.env.PRIVATE_KEY}`;

        const account = privateKeyToAccount(privateKey);

        const publicClient = createPublicClient({
            chain: avalanche,
            transport: http(process.env.AVALANCHE_RPC_URL)
        });

        const walletClient = createWalletClient({
            account,
            chain: avalanche,
            transport: http(process.env.AVALANCHE_RPC_URL)
        });

        // Get the current nonce
        const nonce = await publicClient.getTransactionCount({
            address: account.address,
        });

        logger.info('Current account information', {
            address: account.address,
            currentNonce: nonce
        });

        // If you need to reset the nonce by sending a transaction, uncomment this:
        /*
        const hash = await walletClient.sendTransaction({
          to: account.address,
          value: 0n,
          nonce: nonce,
        });

        logger.info('Sent reset transaction', {
          hash,
          nonce
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        logger.info('Reset transaction confirmed', {
          blockNumber: receipt.blockNumber,
          status: receipt.status
        });
        */

    } catch (error) {
        logger.error('Nonce reset failed', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);