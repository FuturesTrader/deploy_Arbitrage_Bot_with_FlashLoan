// scripts/configureTraderJoe.js
const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { ADDRESSES } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');
const {ARBITRAGE_SETTINGS} = require("../src/constants");

dotenv.config();
const MAX_RETRY_ATTEMPTS = ARBITRAGE_SETTINGS.MAX_RETRY_ATTEMPTS;
const RETRY_DELAY = ARBITRAGE_SETTINGS.RETRY_DELAY;
const TRANSACTION_TIMEOUT = ARBITRAGE_SETTINGS.TRANSACTION_TIMEOUT;
const ESTIMATED_GAS_LIMIT=ARBITRAGE_SETTINGS.ESTIMATED_GAS_LIMIT;
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

        logger.info('Attempting to configure TraderJoe', {
            contractAddress,
            account: account.address,
            traderJoeRouter: ADDRESSES.TRADER_JOE.ROUTER,
            defaultFee: 30
        });

        const hash = await walletClient.writeContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'configureDex',
            args: [
                'traderjoe',
                ADDRESSES.TRADER_JOE.ROUTER,
                BigInt(30),
                BigInt(3000000),
                [BigInt(30)]
            ],
            gas: BigInt(500000),
        });

        const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            confirmations: 1,
            timeout: TRANSACTION_TIMEOUT,
            retryCount: MAX_RETRY_ATTEMPTS,
            retryDelay: RETRY_DELAY
        });

        logger.info('TraderJoe configuration successful', {
            hash: hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            transactionIndex: receipt.transactionIndex
        });

    } catch (error) {
        logger.error('Failed to configure TraderJoe', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);