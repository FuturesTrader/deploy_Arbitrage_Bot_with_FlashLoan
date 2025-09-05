// scripts/configurePools.js
const { createPublicClient, createWalletClient, http, parseUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { POOL_FEES, ADDRESSES, ARBITRAGE_SETTINGS } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage, sleep } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();

// You can override these or pull from .env
const MAX_RETRY_ATTEMPTS = ARBITRAGE_SETTINGS.MAX_RETRY_ATTEMPTS || 5;
const RETRY_DELAY_MS = ARBITRAGE_SETTINGS.RETRY_DELAY || 2000;
const TRANSACTION_TIMEOUT_MS = ARBITRAGE_SETTINGS.TRANSACTION_TIMEOUT || 60000;

// A small helper to wait for a transaction receipt with retries, handling the "not found" error more gracefully.
async function waitForReceiptWithRetry(publicClient, txHash) {
    let attempts = 0;

    while (attempts < MAX_RETRY_ATTEMPTS) {
        try {
            const receipt = await publicClient.waitForTransactionReceipt({
                hash: txHash,
                confirmations: 1,
                // This "timeout" is a single attempt's max wait.
                // If you want each attempt to wait even longer, you can increase it.
                timeout: TRANSACTION_TIMEOUT_MS,
                retryCount: 0,           // We'll handle retries ourselves
                retryDelay: 0
            });
            return receipt; // If successful, return immediately
        } catch (err) {
            // If the error is "Transaction receipt not found" or a typical "not found" message, we retry
            if (getErrorMessage(err).toLowerCase().includes('transaction receipt with hash') ||
                getErrorMessage(err).toLowerCase().includes('could not be found')) {
                attempts++;
                logger.warn('Receipt not found yet, retrying...', {
                    attempt: attempts,
                    maxAttempts: MAX_RETRY_ATTEMPTS,
                    error: getErrorMessage(err)
                });
                await sleep(RETRY_DELAY_MS);
            } else {
                // For other errors, let's just throw
                throw err;
            }
        }
    }
    throw new Error(`Unable to find transaction receipt after ${MAX_RETRY_ATTEMPTS} attempts`);
}

async function configureSinglePool(
    walletClient,
    publicClient,
    contractAddress,
    poolAddress,
    fee,
    minLiquidity,
    dexName,
    pairName
) {
    logger.info(`Configuring ${dexName} ${pairName} pool`, {
        pool: poolAddress,
        fee: fee,
        dexName: dexName
    });

    // 1) Send transaction
    const txHash = await walletClient.writeContract({
        address: contractAddress,
        abi: ARBITRAGE_ABI,
        functionName: 'configurePool',
        args: [
            poolAddress,
            BigInt(fee),
            parseUnits(minLiquidity, 18),
            dexName
        ],
        gas: BigInt(5_000_000),
    });

    logger.debug(`${dexName} ${pairName} pool tx sent`, { txHash });

    // 2) Wait for receipt (with retries)
    const receipt = await waitForReceiptWithRetry(publicClient, txHash);

    logger.info(`${dexName} ${pairName} pool configuration successful`, {
        hash: txHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString()
    });

    return receipt;
}

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
        const publicClient = createPublicClient({ chain: avalanche, transport });
        const walletClient = createWalletClient({ account, chain: avalanche, transport });

        logger.info('Starting pool configuration process', {
            contractAddress,
            walletAddress: account.address,
            pools: {
                uniswap_usdc_wavax: ADDRESSES.UNISWAP_V3.POOLS.USDC_WAVAX,
                uniswap_usdc_wbtc: ADDRESSES.UNISWAP_V3.POOLS.USDC_WBTC,
                traderjoe_usdc_wavax: ADDRESSES.TRADER_JOE.POOLS.USDC_WAVAX,
                traderjoe_usdc_wbtc: ADDRESSES.TRADER_JOE.POOLS.USDC_WBTC
            }
        });

        // Configure pools in sequence - USDC/WAVAX pairs first
        await configureSinglePool(
            walletClient,
            publicClient,
            contractAddress,
            ADDRESSES.UNISWAP_V3.POOLS.USDC_WAVAX,
            POOL_FEES.MEDIUM,
            '100',  // minLiquidity
            'uniswap',
            'USDC-WAVAX'
        );

        // Small delay between transactions
        await sleep(2000);

        await configureSinglePool(
            walletClient,
            publicClient,
            contractAddress,
            ADDRESSES.TRADER_JOE.POOLS.USDC_WAVAX,
            30,  // Trader Joe fee
            '100',  // minLiquidity
            'traderjoe',
            'USDC-WAVAX'
        );

        // Small delay between transactions
        await sleep(2000);

        // Now configure USDC/WBTC pairs
        await configureSinglePool(
            walletClient,
            publicClient,
            contractAddress,
            ADDRESSES.UNISWAP_V3.POOLS.USDC_WBTC,
            POOL_FEES.MEDIUM,
            '100',  // minLiquidity
            'uniswap',
            'USDC-WBTC'
        );

        // Small delay between transactions
        await sleep(2000);

        await configureSinglePool(
            walletClient,
            publicClient,
            contractAddress,
            ADDRESSES.TRADER_JOE.POOLS.USDC_WBTC,
            30,  // Trader Joe fee
            '100',  // minLiquidity
            'traderjoe',
            'USDC-WBTC'
        );

        logger.info('All pools configuration completed successfully', {
            contract: contractAddress,
            configuredPools: [
                'Uniswap USDC-WAVAX',
                'TraderJoe USDC-WAVAX',
                'Uniswap USDC-WBTC',
                'TraderJoe USDC-WBTC'
            ]
        });

    } catch (error) {
        logger.error('Failed to configure pools', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);