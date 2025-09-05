// scripts/configureTokens.js
const { createPublicClient, createWalletClient, http, parseUnits, formatUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { TOKEN_CONFIGS, ARBITRAGE_SETTINGS } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

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

        // Configure USDC
        logger.info('Configuring USDC token', {
            address: TOKEN_CONFIGS.USDC.address,
            decimals: TOKEN_CONFIGS.USDC.decimals
        });

        const usdcHash = await walletClient.writeContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'configureToken',
            args: [
                TOKEN_CONFIGS.USDC.address,
                parseUnits('1000000', TOKEN_CONFIGS.USDC.decimals),  // max: 1M USDC
                parseUnits('.00001', TOKEN_CONFIGS.USDC.decimals),        // min: 1 USDC
                BigInt(TOKEN_CONFIGS.USDC.decimals),                 // 6 decimals
            ],
            gas: BigInt(500000),
        });

        const usdcReceipt = await publicClient.waitForTransactionReceipt({
            hash: usdcHash,
            confirmations: 1,
            timeout: TRANSACTION_TIMEOUT,
            retryCount: MAX_RETRY_ATTEMPTS,
            retryDelay: RETRY_DELAY
        });

        logger.info('USDC configuration successful', {
            hash: usdcHash,
            blockNumber: usdcReceipt.blockNumber,
            gasUsed: usdcReceipt.gasUsed.toString()
        });

        // Configure WAVAX
        logger.info('Configuring WAVAX token', {
            address: TOKEN_CONFIGS.WAVAX.address,
            decimals: TOKEN_CONFIGS.WAVAX.decimals
        });

        const wavaxHash = await walletClient.writeContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'configureToken',
            args: [
                TOKEN_CONFIGS.WAVAX.address,
                parseUnits('10000', TOKEN_CONFIGS.WAVAX.decimals),    // max:  AVAX
                parseUnits('0.00001', TOKEN_CONFIGS.WAVAX.decimals),     // min:  AVAX
                BigInt(TOKEN_CONFIGS.WAVAX.decimals),                // 18 decimals
            ],
            gas: BigInt(500000),
        });

        const wavaxReceipt = await publicClient.waitForTransactionReceipt({
            hash: wavaxHash,
            confirmations: 1,
            timeout: TRANSACTION_TIMEOUT,
            retryCount: MAX_RETRY_ATTEMPTS,
            retryDelay: RETRY_DELAY
        });

        logger.info('WAVAX configuration successful', {
            hash: wavaxHash,
            blockNumber: wavaxReceipt.blockNumber,
            gasUsed: wavaxReceipt.gasUsed.toString()
        });

    } catch (error) {
        logger.error('Failed to configure tokens', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);