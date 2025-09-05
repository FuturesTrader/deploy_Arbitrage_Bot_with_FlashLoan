// src/utils.js
const { formatUnits } = require('viem');
const { ARBITRAGE_SETTINGS, GAS_OPTIMIZATION } = require('./constants.js');
const dotenv = require('dotenv');
dotenv.config();
const logger = require('./logger.js');

const POLLING_INTERVAL = ARBITRAGE_SETTINGS.POLLING_INTERVAL;
const CONFIRMATION_TIMEOUT = ARBITRAGE_SETTINGS.CONFIRMATION_TIMEOUT;

/**
 * getErrorMessage
 * Decodes error data using the provided Error object.
 */
function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * sleep
 * Returns a Promise that resolves after the specified number of milliseconds.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * safeSerialize
 * Enhanced safe serialization of objects with special type handling (BigInt, Errors,
 * functions, symbols, and circular references).
 */
function safeSerialize(obj, indent = 2) {
    const seen = new WeakSet();

    return JSON.stringify(
        obj,
        (key, value) => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            if (value instanceof Error) {
                const error = {
                    name: value.name,
                    message: value.message,
                    stack: value.stack
                };
                Object.getOwnPropertyNames(value).forEach((prop) => {
                    if (!error[prop]) {
                        error[prop] = value[prop];
                    }
                });
                return error;
            }
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            switch (typeof value) {
                case 'undefined':
                    return 'undefined';
                case 'function':
                    return `[Function: ${value.name || 'anonymous'}]`;
                case 'symbol':
                    return value.toString();
                default:
                    return value;
            }
        },
        indent
    );
}

const DEFAULT_TRANSACTION_CONFIG = {
    gasLimit: GAS_OPTIMIZATION.ESTIMATED_GAS_LIMIT,
    gasPriceMultiplier: GAS_OPTIMIZATION.BASE_FEE_MULTIPLIER, // buffer multiplier
    maxConfirmationAttempts: GAS_OPTIMIZATION.MAX_CONFIRMATIONS,
    confirmationTimeout: GAS_OPTIMIZATION.MIN_DEADLINE, // 60 seconds (in ms)
    pollingInterval: GAS_OPTIMIZATION.POLLING_INTERVAL, // e.g. 2000ms
    priorityFee: GAS_OPTIMIZATION.PRIORITY_FEE.LOW
};

/**
 * GasTransactionUtility
 * Provides methods to calculate adjusted gas parameters and wait for transaction confirmation.
 */
class GasTransactionUtility {
    constructor(publicClient, config = {}) {
        this.publicClient = publicClient;
        this.config = { ...DEFAULT_TRANSACTION_CONFIG, ...config };
    }

    async getAdjustedGasPrice() {
        const baseGasPrice = await this.publicClient.getGasPrice();
        const multiplier = BigInt(Math.floor(this.config.gasPriceMultiplier * 100));
        const adjustedGasPrice = (baseGasPrice * multiplier) / 100n;

        logger.debug('Calculated gas price', {
            baseGasPriceGwei: formatUnits(baseGasPrice, 9),
            adjustedGasPriceGwei: formatUnits(adjustedGasPrice, 9),
            multiplier: this.config.gasPriceMultiplier
        });
        return adjustedGasPrice;
    }

    async getGasParameters() {
        const computedGasPrice = await this.getAdjustedGasPrice();
        const priorityFeeWei = BigInt(Math.floor(this.config.priorityFee));
        const latestBlock = await this.publicClient.getBlock({ blockTag: 'latest' });
        const baseFee = latestBlock?.baseFeePerGas ?? 0n;
        const safeGasPrice =
            computedGasPrice < baseFee + priorityFeeWei ? baseFee + priorityFeeWei : computedGasPrice;
        const gasLimit = this.config.gasLimit;
        const maxFeePerGas = safeGasPrice;

        logger.debug('Final gas parameters computed', {
            safeGasPrice: formatUnits(safeGasPrice, 9),
            baseFee: formatUnits(baseFee, 9),
            maxFeePerGas: formatUnits(maxFeePerGas, 9),
            gasLimit: gasLimit.toString()
        });
        return { gasPrice: safeGasPrice, gasLimit, maxFeePerGas };
    }
}

/**
 * waitForTransactionConfirmation
 *
 * Polls the blockchain using publicClient.getTransactionReceipt to determine whether a transaction
 * (identified by its hash) has been confirmed. This function is intended for waiting on the first leg
 * of an arbitrage trade. It will return true if the transaction is confirmed (receipt.status === 'success')
 * before the timeout; otherwise, it returns false.
 *
 * @param hash - the transaction hash to check.
 * @param publicClient - an instance of a viem PublicClient.
 * @param timeoutMs - maximum time to wait (default: CONFIRMATION_TIMEOUT)
 * @param pollingInterval - time between polls (default: POLLING_INTERVAL)
 * @returns a Promise that resolves to true if confirmed, or false if timed out.
 */
async function waitForTransactionConfirmation(
    hash,
    publicClient,
    timeoutMs = CONFIRMATION_TIMEOUT,
    pollingInterval = POLLING_INTERVAL
) {
    const startTime = performance.now();
    while (performance.now() - startTime < timeoutMs) {
        try {
            const receipt = await publicClient.getTransactionReceipt({ hash });
            if (receipt && receipt.status === 'success') {
                logger.info(`Transaction ${hash} confirmed on block ${receipt.blockNumber}.`);
                return true;
            }
        } catch (error) {
            logger.debug(`Error checking transaction confirmation for ${hash}: ${getErrorMessage(error)}`);
        }
        await sleep(pollingInterval);
    }
    logger.error(`Timeout waiting for transaction ${hash} confirmation after ${timeoutMs}ms.`);
    return false;
}

/**
 * TimingUtility
 * Utility class to record and log timing checkpoints for a trade.
 */
class TimingUtility {
    constructor(tradeId) {
        this.tradeId = tradeId;
        this.timings = { startTime: performance.now() };
        this.checkpoints = new Map();
        this.checkpoints.set('start', this.timings.startTime);
    }

    getTotalTime() {
        if (!this.timings.endTime || !this.timings.startTime) {
            throw new Error('End time or start time is missing');
        }
        return this.timings.endTime - this.timings.startTime;
    }

    recordEvent(event) {
        this.timings[event] = performance.now();
        this.checkpoints.set(event, this.timings[event]);
        this.logTimings(event);
    }

    logTimings(event) {
        const currentTime = performance.now();
        const elapsedTotal = (currentTime - this.timings.startTime) / 1000;
        const details = {
            tradeId: this.tradeId,
            totalElapsedSeconds: elapsedTotal.toFixed(3)
        };

        if (this.timings.firstTradeSubmitted) {
            details.firstTradeSubmissionTime = ((this.timings.firstTradeSubmitted - this.timings.startTime) / 1000).toFixed(3);
        }
        if (this.timings.firstTradeConfirmed && this.timings.firstTradeSubmitted) {
            details.firstTradeConfirmationTime = ((this.timings.firstTradeConfirmed - this.timings.firstTradeSubmitted) / 1000).toFixed(3);
        }
        if (this.timings.secondTradeSubmitted && this.timings.firstTradeConfirmed) {
            details.secondTradeSubmissionTime = ((this.timings.secondTradeSubmitted - this.timings.firstTradeConfirmed) / 1000).toFixed(3);
        }
        if (this.timings.secondTradeConfirmed && this.timings.secondTradeSubmitted) {
            details.secondTradeConfirmationTime = ((this.timings.secondTradeConfirmed - this.timings.secondTradeSubmitted) / 1000).toFixed(3);
        }
        if (this.timings.endTime) {
            details.totalExecutionTime = ((this.timings.endTime - this.timings.startTime) / 1000).toFixed(3);
        }
        logger.info(`Trade timing update - ${event}`, { metadata: details });
    }
}

/**
 * TransactionTracker
 * Utility class to track a limited number of transaction hashes.
 */
class TransactionTracker {
    constructor() {
        this.transactions = new Set();
        this.maxTransactions = 2;
    }

    addTransaction(hash) {
        if (this.transactions.size >= this.maxTransactions) {
            logger.error('Attempting to add more than allowed transactions', {
                existingTransactions: Array.from(this.transactions),
                newTransaction: hash
            });
            throw new Error('Maximum transaction count exceeded');
        }
        this.transactions.add(hash);
        logger.debug('Transaction added to tracker', {
            hash: hash.toString(),
            totalTracked: this.transactions.size
        });
    }

    clear() {
        this.transactions.clear();
        logger.debug('Transaction tracker cleared');
    }
}

module.exports = {
    getErrorMessage,
    sleep,
    safeSerialize,
    DEFAULT_TRANSACTION_CONFIG,
    GasTransactionUtility,
    waitForTransactionConfirmation,
    TimingUtility,
    TransactionTracker
};