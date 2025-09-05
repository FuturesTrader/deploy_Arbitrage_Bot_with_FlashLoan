// scripts/testOwnership.js
const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
    try {
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

        // First verify owner
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

        // Try to pause the contract (an owner-only function)
        logger.info('Attempting to pause contract');

        try {
            const pauseHash = await walletClient.writeContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'pause',
                gas: BigInt(500000)
            });

            const pauseReceipt = await publicClient.waitForTransactionReceipt({
                hash: pauseHash,
                confirmations: 1
            });

            logger.info('Pause transaction completed', {
                hash: pauseHash,
                status: pauseReceipt.status
            });

            // Check paused state
            const isPaused = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'paused'
            });

            logger.info('Contract pause state', {
                isPaused
            });

            // If successful, unpause
            if (isPaused) {
                const unpauseHash = await walletClient.writeContract({
                    address: contractAddress,
                    abi: ARBITRAGE_ABI,
                    functionName: 'unpause',
                    gas: BigInt(500000)
                });

                const unpauseReceipt = await publicClient.waitForTransactionReceipt({
                    hash: unpauseHash,
                    confirmations: 1
                });

                logger.info('Unpause transaction completed', {
                    hash: unpauseHash,
                    status: unpauseReceipt.status
                });
            }
        } catch (error) {
            logger.error('Owner function test failed', {
                error: getErrorMessage(error)
            });
        }

    } catch (error) {
        logger.error('Test failed', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);