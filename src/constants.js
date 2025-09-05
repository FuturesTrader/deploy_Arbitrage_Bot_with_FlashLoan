// /src/constants.js

const { parseUnits } = require('viem');
const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config();

/**
 * GAS_OPTIMIZATION
 * ------------------------------------------------------------------
 * Settings to help with dynamic or default gas usage
 */
const GAS_OPTIMIZATION = {
    BASE_FEE_MULTIPLIER: 1.1,  // Multiply base fee
    PRIORITY_FEE: {
        LOW: Number(parseUnits('2', 9)),
        MEDIUM: Number(parseUnits('3', 9)),
        HIGH: Number(parseUnits('5', 9))
    },
    CONFIRMATIONS: 1,  // e.g. wait for 1 confirmation
    MAX_CONFIRMATIONS: 3,
    MIN_DEADLINE: 60_000,  // 1 minute
    MAX_DEADLINE: 300, // 5 minutes
    TIMEOUT: 15000,    // 15 seconds transaction timeout
    ESTIMATOR: {
        BASE_GAS: 21000n,
        SWAP_BASE: 150000n,
        TOKEN_TRANSFER: 65000n,
        BUFFER_MULTIPLIER: 1.1
    },
    GAS_LIMIT_BUFFER: 1.05, // buffer
    ESTIMATED_GAS_LIMIT: 3000000n, // safety limit for gas
    POLLING_INTERVAL: 3_000, // 2 seconds
};


/**
 * ARBITRAGE_SETTINGS
 */
const ARBITRAGE_SETTINGS = {
    MIN_PROFIT_THRESHOLD: 0.0001,  // Minimum price difference (percent) to trigger arbitrage
    EXECUTION_RETRY_DELAY: 7000,
    MAX_PRICE_AGE: 5000,
    MONITORING_INTERVAL: 7000,  // time in ms between each arbitrage attempt
    TRANSACTION_TIMEOUT: 28_000, // 25 seconds
    PRICE_HISTORY_LENGTH: 10,
    MAX_RETRY_ATTEMPTS: 5,
    RETRY_DELAY: 4_000, // 4 seconds
    PERFORMANCE_THRESHOLD: 1000,
    POLLING_INTERVAL: 2000,
    CONFIRMATION_TIMEOUT: 30000,
    MAX_PRICE_IMPACT: 5, // 5%
    DEFAULT_SLIPPAGE_BPS: 200, // 1%
    DEFAULT_DEADLINE_MINS: 30, // 30% buffer
    MAX_PROFIT_THRESHOLD: 2, // this is a percent.  Sometimes we see issues on chain and this helps filter
};


/**
 * CHAIN_IDs, Pool Fees
 */
const CHAIN_IDS = {
    AVALANCHE: 43114,
    ARBITRUM: 42161,
    BASE: 8453,
    POLYGON: 137
};

// uniswap pool fees
const POOL_FEES = {
    LOWEST: 100,   // 0.01%
    LOW: 500,      // 0.05%
    MEDIUM: 3000,  // 0.3%
    HIGH: 10000    // 1%
};

// uniswap tick spacing
const TICK_SPACING = {
    LOW: 10,      // 0.05%
    MEDIUM: 60,  // 0.3%
    HIGH: 200    // 1%
};

/**
 * TOKEN_CONFIGS
 * ------------------------------------------------------------------
 * Basic metadata for each token.
 */
const TOKEN_CONFIGS = {
    WAVAX: {
        address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
        decimals: 18,
        symbol: 'WAVAX',
        name: 'Wrapped AVAX',
        chainId: CHAIN_IDS.AVALANCHE
    },
    USDC: {
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
        chainId: CHAIN_IDS.AVALANCHE
    },
    WBTC: {
        address: '0x152b9d0FdC40C096757F570A51E494bd4b943E50', // WBTC on Avalanche
        decimals: 8,  // WBTC uses 8 decimals unlike most tokens with 18
        symbol: 'BTC.b',
        name: 'Wrapped Bitcoin',
        chainId: CHAIN_IDS.AVALANCHE
    }
};

/**
 * TRADE_SETTINGS
 * ------------------------------------------------------------------
 * Perpetual trade logic settings, including quote/trade sizes and
 * direction definitions for both Uniswap and Trader Joe routes.
 */
const TRADE_SETTINGS = {
    TRADE_SIZE: '300',      // e.g. USDC for actual trades
    SAFETY_MARGIN: .999,
    MAX_PRICE_IMPACT: 5.0,
    PRICE_CHECK_INTERVAL: 1000,
    SLIPPAGE_TOLERANCE: 200,  // i.e. 1%
    MAX_SLIPPAGE_RECOVERY: 2.0,
};

/**
 * ADDRESSES
 * ------------------------------------------------------------------
 * Contract addresses for each Dex (factory, router, pools, etc.).
 */
const ADDRESSES = {
    UNISWAP_V3: {
        FACTORY: '0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD',
        ROUTER: '0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE',
        QUOTER: '0xbe0F5544EC67e9B3b2D979aaA43f18Fd87E6257F',
        POOLS: {
            USDC_WAVAX: '0xfAe3f424a0a47706811521E3ee268f00cFb5c45E',
            USDC_WBTC: '0xD1356d360F37932059E5b89b7992692aA234EDA6'
            // Add other pool pairs here if needed
        }
    },
    TRADER_JOE: {
        FACTORY: '0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10',
        ROUTER: '0x18556DA13313f3532c54711497A8FedAC273220E',
        POOLS: {
            USDC_WAVAX: '0x864d4e5Ee7318e97483DB7EB0912E09F161516EA',
            USDC_WBTC: '0x4224f6f4c9280509724db2dbac314621e4465c29'
            // Add other pool pairs here if needed
        },
    },
    AAVE_V3: {
        POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        FLASH_LOAN_BPS: 5,
    },
    BALANCER_V3: {
        POOL: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
        FLASH_LOAN_BPS: 0,
    },
    BALANCER_V2: {
        POOL: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
        FLASH_LOAN_BPS: 0,
    },

};

// Export all constants
module.exports = {
    GAS_OPTIMIZATION,
    ARBITRAGE_SETTINGS,
    CHAIN_IDS,
    POOL_FEES,
    TICK_SPACING,
    TOKEN_CONFIGS,
    TRADE_SETTINGS,
    ADDRESSES,
};
