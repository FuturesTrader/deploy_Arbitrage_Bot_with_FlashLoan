// scripts/configureTokens.js
const { createPublicClient, createWalletClient, http, parseUnits, formatUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { TOKEN_CONFIGS, ARBITRAGE_SETTINGS } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage, sleep } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();
const MAX_RETRY_ATTEMPTS = ARBITRAGE_SETTINGS.MAX_RETRY_ATTEMPTS;
const RETRY_DELAY = ARBITRAGE_SETTINGS.RETRY_DELAY;
const TRANSACTION_TIMEOUT = ARBITRAGE_SETTINGS.TRANSACTION_TIMEOUT;

async function configureToken(
    tokenName,
    tokenAddress,
    decimals,
    maxAmount,
    minAmount,
    walletClient,
    publicClient,
    contractAddress
) {
    logger.info(`Configuring ${tokenName} token`, {
        address: tokenAddress,
        decimals: decimals,
        maxAmount: formatUnits(maxAmount, decimals),
        minAmount: formatUnits(minAmount, decimals),
    });

    // Use a higher gas limit for safety
    const gasLimit = BigInt(600000);

    try {
        // Send the transaction with the correct parameters
        const hash = await walletClient.writeContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'configureToken',
            args: [
                tokenAddress,
                maxAmount,
                minAmount,
                BigInt(decimals),
            ],
            gas: gasLimit,
        });

        logger.info(`${tokenName} configuration transaction sent`, {
            hash,
            gasLimit: gasLimit.toString()
        });

        // Wait for receipt with explicit retry logic
        let receipt = null;
        let attempts = 0;
        const maxAttempts = MAX_RETRY_ATTEMPTS;

        while (!receipt && attempts < maxAttempts) {
            try {
                receipt = await publicClient.waitForTransactionReceipt({
                    hash,
                    confirmations: 2, // Increased confirmations for better certainty
                    timeout: TRANSACTION_TIMEOUT,
                });

                // Verify transaction was successful
                if (receipt.status !== 'success') {
                    throw new Error(`Transaction reverted: ${hash}`);
                }
            } catch (error) {
                attempts++;
                logger.warn(`Attempt ${attempts}/${maxAttempts} to get receipt for ${tokenName} failed`, {
                    hash,
                    error: getErrorMessage(error)
                });

                if (attempts >= maxAttempts) {
                    throw new Error(`Failed to get receipt after ${maxAttempts} attempts`);
                }

                // Wait before retrying
                await sleep(RETRY_DELAY);
            }
        }

        logger.info(`${tokenName} configuration successful`, {
            hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            confirmations: receipt.confirmations || 'unknown'
        });

        // Verify token configuration was successful
        try {
            const tokenConfig = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getTokenConfig',
                args: [tokenAddress]
            });

            logger.info(`${tokenName} configuration verified on-chain`, {
                isEnabled: tokenConfig[0],
                maxAmount: tokenConfig[1].toString(),
                minAmount: tokenConfig[2].toString(),
                decimals: tokenConfig[3].toString(),
            });
        } catch (error) {
            logger.warn(`Could not verify ${tokenName} configuration, but transaction was successful`, {
                error: getErrorMessage(error)
            });
        }

        // Add a small delay between transactions
        await sleep(5000);

        return receipt;
    } catch (error) {
        logger.error(`Failed to configure ${tokenName}`, {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        throw error;
    }
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
        const usdcMaxAmount = parseUnits('1000000', TOKEN_CONFIGS.USDC.decimals);  // max: 1M USDC
        const usdcMinAmount = parseUnits('0.00001', TOKEN_CONFIGS.USDC.decimals);  // min: 0.00001 USDC

        await configureToken(
            'USDC',
            TOKEN_CONFIGS.USDC.address,
            TOKEN_CONFIGS.USDC.decimals,
            usdcMaxAmount,
            usdcMinAmount,
            walletClient,
            publicClient,
            contractAddress
        );

        // Configure WAVAX
        const wavaxMaxAmount = parseUnits('10000', TOKEN_CONFIGS.WAVAX.decimals);    // max: 10,000 AVAX
        const wavaxMinAmount = parseUnits('0.00001', TOKEN_CONFIGS.WAVAX.decimals);  // min: 0.00001 AVAX

        await configureToken(
            'WAVAX',
            TOKEN_CONFIGS.WAVAX.address,
            TOKEN_CONFIGS.WAVAX.decimals,
            wavaxMaxAmount,
            wavaxMinAmount,
            walletClient,
            publicClient,
            contractAddress
        );

        // Configure WBTC (BTC.b)
        const wbtcMaxAmount = parseUnits('100', TOKEN_CONFIGS.WBTC.decimals);      // max: 100 BTC.b
        const wbtcMinAmount = parseUnits('0.00001', TOKEN_CONFIGS.WBTC.decimals);  // min: 0.00001 BTC.b

        await configureToken(
            'BTC.b',
            TOKEN_CONFIGS.WBTC.address,
            TOKEN_CONFIGS.WBTC.decimals,
            wbtcMaxAmount,
            wbtcMinAmount,
            walletClient,
            publicClient,
            contractAddress
        );

        logger.info('All tokens configured successfully');

    } catch (error) {
        logger.error('Token configuration process failed', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);