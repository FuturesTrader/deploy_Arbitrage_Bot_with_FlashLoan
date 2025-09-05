/* ----------------------------------------------------------------------
   configureUniswap.js
   Example: node configureUniswap.js

   Description:
   - Configures the "uniswap" dex in the CrossDexArbitrage contract
   - Demonstrates manual polling for transaction receipt to avoid
     'TransactionReceiptNotFoundError' or 'Transaction may not be processed...' errors
   ---------------------------------------------------------------------- */

const { createPublicClient, createWalletClient, http, parseGwei } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { POOL_FEES, ADDRESSES, CHAIN_IDS, ARBITRAGE_SETTINGS } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage, sleep } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');
dotenv.config();

const MAX_RETRY_ATTEMPTS = ARBITRAGE_SETTINGS.MAX_RETRY_ATTEMPTS;
const RETRY_DELAY = ARBITRAGE_SETTINGS.RETRY_DELAY;

/**
 * Convert a Uniswap fee from e.g. 3000 (0.3%) to the CrossDexArbitrage contract's BPS-based integer
 */
function convertUniswapFeeToContractFee(uniswapFee) {
    // Uniswap fee 3000 => 0.3%
    // Our contract uses basis points directly, so uniswapFee / 100
    return Math.floor(uniswapFee / 100);
}

async function main() {
    try {
        // Basic environment checks
        if (!process.env.PRIVATE_KEY || !process.env.ARBITRAGE_CONTRACT_ADDRESS) {
            throw new Error('Missing required environment variables: PRIVATE_KEY, ARBITRAGE_CONTRACT_ADDRESS');
        }

        // Prepare signer account
        const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
            ? process.env.PRIVATE_KEY
            : `0x${process.env.PRIVATE_KEY}`;
        const account = privateKeyToAccount(privateKey);
        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;

        // Configure Avalanche chain
        const avalancheChain = {
            ...avalanche,
            id: CHAIN_IDS.AVALANCHE,
            name: 'Avalanche C-Chain'
        };

        const transport = http(process.env.AVALANCHE_RPC_URL);
        const publicClient = createPublicClient({
            chain: avalancheChain,
            transport
        });
        const walletClient = createWalletClient({
            chain: avalancheChain,
            transport,
            account
        });

        // Quick connectivity check
        const blockNumber = await publicClient.getBlockNumber();
        logger.info('Connected to Avalanche C-Chain', {
            blockNumber: blockNumber.toString(),
            chainId: avalancheChain.id
        });

        // Verify ownership
        const owner = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'owner'
        });

        logger.info('Current ownership state', {
            contractAddress,
            owner,
            callingAccount: account.address,
            isOwner: owner.toLowerCase() === account.address.toLowerCase()
        });

        // Convert fees for Uniswap → CrossDexArbitrage
        const defaultFee = convertUniswapFeeToContractFee(POOL_FEES.MEDIUM); // e.g. 3000 => 30
        const supportedFeeTiers = [
            POOL_FEES.LOWEST,  // 100
            POOL_FEES.LOW,     // 500
            POOL_FEES.MEDIUM,  // 3000
            POOL_FEES.HIGH     // 10000
        ].map(convertUniswapFeeToContractFee);

        logger.info('Fee conversion details', {
            originalDefaultFee: POOL_FEES.MEDIUM,
            convertedDefaultFee: defaultFee,
            originalFeeTiers: [POOL_FEES.LOWEST, POOL_FEES.LOW, POOL_FEES.MEDIUM, POOL_FEES.HIGH],
            convertedFeeTiers: supportedFeeTiers
        });

        // Get next nonce for this account
        const nonce = await publicClient.getTransactionCount({
            address: account.address
        });

        // Estimate gas parameters
        const baseFee = await publicClient.getGasPrice();
        const priorityFee = parseGwei('1'); // e.g. 1 Gwei
        // Add a ~20% buffer to base + priority
        const maxFeePerGas = baseFee + priorityFee + (baseFee * 20n / 100n);

        logger.info('Transaction parameters', {
            nonce,
            baseFee: baseFee.toString(),
            priorityFee: priorityFee.toString(),
            maxFeePerGas: maxFeePerGas.toString()
        });

        // -------------
        // Send the TX
        // -------------
        const hash = await walletClient.writeContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'configureDex',
            args: [
                'uniswap',
                ADDRESSES.UNISWAP_V3.ROUTER,
                BigInt(defaultFee),
                BigInt(3_000_000), // maxGasUsage
                supportedFeeTiers.map(fee => BigInt(fee))
            ],
            chain: avalancheChain,
            nonce,
            maxFeePerGas,
            maxPriorityFeePerGas: priorityFee,
            gas: BigInt(500_000) // 500k gas limit, adjust if needed
        });

        logger.info('Transaction sent successfully', { hash });

        // ------------------------------------------------------------------
        // MANUAL POLLING LOOP FOR RECEIPT (instead of waitForTransactionReceipt)
        // ------------------------------------------------------------------
        let attempts = 0;
        let receipt;
        const maxAttempts =MAX_RETRY_ATTEMPTS;      // number of times we poll
        const pollIntervalMs = RETRY_DELAY; // 4 seconds between polls

        while (attempts < maxAttempts) {
            await sleep(pollIntervalMs);

            try {
                receipt = await publicClient.getTransactionReceipt({ hash });
                if (receipt) {
                    break; // we have a receipt
                }
            } catch (err) {
                // In viem@1.21.3, if not found, it throws a TransactionReceiptNotFoundError
                // We'll just keep polling
                logger.debug(`Still waiting for transaction to be in a block (attempt=${attempts + 1})`, {
                    error: getErrorMessage(err)
                });
            }
            attempts++;
        }

        if (!receipt) {
            throw new Error(`Could not retrieve transaction receipt after ${maxAttempts} attempts. Hash: ${hash}`);
        }

        // Print out receipt details
        logger.info('Transaction confirmed!', {
            hash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed?.toString?.() || 'N/A',
            status: receipt.status
        });

        // Verify final config on-chain
        const config = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'getDexConfig',
            args: ['uniswap']
        });

        logger.info('Updated Uniswap configuration', {
            router: config[0],
            defaultFee: config[1].toString(),
            maxGasUsage: config[2].toString(),
            isEnabled: config[3]
        });

        process.exit(0); // Done
    } catch (error) {
        logger.error('Failed to configure Uniswap', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(err => {
    logger.error('configureUniswap.js script error', {
        error: getErrorMessage(err)
    });
    process.exit(1);
});
