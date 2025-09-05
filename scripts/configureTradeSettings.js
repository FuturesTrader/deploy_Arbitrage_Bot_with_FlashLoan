// scripts/configureTradeSettings.js

const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');
const {ARBITRAGE_SETTINGS} = require("../src/constants");

dotenv.config();
const MAX_RETRY_ATTEMPTS = ARBITRAGE_SETTINGS.MAX_RETRY_ATTEMPTS;
const RETRY_DELAY = ARBITRAGE_SETTINGS.RETRY_DELAY;
const TRANSACTION_TIMEOUT = ARBITRAGE_SETTINGS.TRANSACTION_TIMEOUT;
async function main() {
    try {
        if (!process.env.PRIVATE_KEY || !process.env.ARBITRAGE_CONTRACT_ADDRESS) {
            throw new Error('Missing required environment variables');
        }

        const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
            ? process.env.PRIVATE_KEY
            : `0x${process.env.PRIVATE_KEY}`;

        const account = privateKeyToAccount(privateKey);
        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;

        const transport = http(process.env.AVALANCHE_RPC_URL);
        const publicClient = createPublicClient({
            chain: avalanche,
            transport
        });

        const walletClient = createWalletClient({
            account,
            chain: avalanche,
            transport
        });

        // Set a minimal profit requirement for testing
        const minProfitBps = 1n;         // 0.01% - very low for testing
        const defaultDeadline = 60n;      // 60 seconds

        logger.info('Updating trade settings', {
            contractAddress,
            minProfitBps: minProfitBps.toString(),
            defaultDeadline: defaultDeadline.toString()
        });

        const hash = await walletClient.writeContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'updateTradeSettings',
            args: [
                minProfitBps,
                defaultDeadline
            ],
            gas: BigInt(300000),
        });

        const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            confirmations: 1,
            timeout: TRANSACTION_TIMEOUT,
            retryCount: MAX_RETRY_ATTEMPTS,
            retryDelay: RETRY_DELAY
        });

        logger.info('Trade settings update successful', {
            hash: hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });

        // Verify the new settings
        const settings = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'tradeSettings'
        });

        logger.info('Current trade settings', {
            minProfitBps: settings[0].toString(),
            defaultDeadline: settings[1].toString()
        });

    } catch (error) {
        logger.error('Failed to update trade settings', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);