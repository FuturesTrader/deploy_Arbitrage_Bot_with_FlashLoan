// scripts/verifyAllConfigs.js
const { createPublicClient, http, formatUnits } = require('viem');
const { avalanche } = require('viem/chains');
const { TOKEN_CONFIGS, POOL_FEES, ADDRESSES, CHAIN_IDS } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();

function formatTokenConfig(config, token) {
    try {
        if (!config || !Array.isArray(config) || config.length < 5) {
            return {
                error: 'Invalid configuration format'
            };
        }

        return {
            isEnabled: config[0],
            maxAmount: formatUnits(config[1] || 0n, token.decimals),
            minAmount: formatUnits(config[2] || 0n, token.decimals),
            decimals: config[3]?.toString() || '0',
            maxSlippage: `${Number(config[4] || 0)/100}%`
        };
    } catch (error) {
        return {
            error: `Failed to format config: ${error.message}`
        };
    }
}

function formatDexConfig(config) {
    try {
        if (!config || !Array.isArray(config) || config.length < 4) {
            return {
                error: 'Invalid configuration format'
            };
        }

        return {
            router: config[0],
            defaultFee: config[1]?.toString() || '0',
            maxGasUsage: config[2]?.toString() || '0',
            isEnabled: config[3]
        };
    } catch (error) {
        return {
            error: `Failed to format config: ${error.message}`
        };
    }
}

function formatPoolConfig(config) {
    try {
        if (!config || !Array.isArray(config) || config.length < 4) {
            return {
                error: 'Invalid configuration format'
            };
        }

        return {
            isEnabled: config[0],
            fee: config[1]?.toString() || '0',
            minLiquidity: formatUnits(config[2] || 0n, 18),
            dexRouter: config[3]
        };
    } catch (error) {
        return {
            error: `Failed to format config: ${error.message}`
        };
    }
}

async function main() {
    try {
        if (!process.env.ARBITRAGE_CONTRACT_ADDRESS) {
            throw new Error('Missing ARBITRAGE_CONTRACT_ADDRESS environment variable');
        }

        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;

        // Initialize client
        const publicClient = createPublicClient({
            chain: avalanche,
            transport: http('https://api.avax.network/ext/bc/C/rpc')
        });

        logger.info('Starting comprehensive configuration verification', {
            contractAddress,
            chainId: CHAIN_IDS.AVALANCHE
        });

        // 1. Verify Contract Owner
        const owner = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'owner'
        });

        logger.info('Contract ownership', {
            owner,
            expectedOwner: process.env.OWNER_ADDRESS || 'Not specified in .env'
        });

        // 2. Verify Token Configurations
        logger.info('Verifying token configurations...');

        // Check USDC
        const usdcConfig = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'getTokenConfig',
            args: [TOKEN_CONFIGS.USDC.address]
        });

        logger.info('USDC Configuration', {
            address: TOKEN_CONFIGS.USDC.address,
            ...formatTokenConfig(usdcConfig, TOKEN_CONFIGS.USDC)
        });

        // Check WAVAX
        const wavaxConfig = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'getTokenConfig',
            args: [TOKEN_CONFIGS.WAVAX.address]
        });

        logger.info('WAVAX Configuration', {
            address: TOKEN_CONFIGS.WAVAX.address,
            ...formatTokenConfig(wavaxConfig, TOKEN_CONFIGS.WAVAX)
        });

        // 3. Verify DEX Configurations
        logger.info('Verifying DEX configurations...');

        // Check Uniswap
        const uniswapConfig = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'getDexConfig',
            args: ['uniswap']
        });

        logger.info('Uniswap Configuration', {
            expectedRouter: ADDRESSES.UNISWAP_V3.ROUTER,
            ...formatDexConfig(uniswapConfig)
        });

        // Check TraderJoe
        const traderjoeConfig = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'getDexConfig',
            args: ['traderjoe']
        });

        logger.info('TraderJoe Configuration', {
            expectedRouter: ADDRESSES.TRADER_JOE.ROUTER,
            ...formatDexConfig(traderjoeConfig)
        });

        // 4. Verify Pool Configurations
        logger.info('Verifying pool configurations...');

        // Check Uniswap USDC-WAVAX pool
        const uniswapPool = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'getPoolConfig',
            args: [ADDRESSES.UNISWAP_V3.POOLS.USDC_WAVAX]
        });

        logger.info('Uniswap USDC-WAVAX Pool Configuration', {
            address: ADDRESSES.UNISWAP_V3.POOLS.USDC_WAVAX,
            ...formatPoolConfig(uniswapPool)
        });

        // Check TraderJoe USDC-WAVAX pool
        const traderjoePool = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'getPoolConfig',
            args: [ADDRESSES.TRADER_JOE.POOLS.USDC_WAVAX]
        });

        logger.info('TraderJoe USDC-WAVAX Pool Configuration', {
            address: ADDRESSES.TRADER_JOE.POOLS.USDC_WAVAX,
            ...formatPoolConfig(traderjoePool)
        });

        // 5. Verify Contract Status
        const isPaused = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'paused'
        });

        logger.info('Contract Status', { isPaused });

        logger.info('Configuration verification completed');

    } catch (error) {
        logger.error('Configuration verification failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    }
}

main().catch(console.error);