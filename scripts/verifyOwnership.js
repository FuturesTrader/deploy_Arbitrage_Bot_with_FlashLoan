// scripts/verifyOwnership.js
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

        // Get current owner
        const owner = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'owner'
        });

        logger.info('Contract ownership details', {
            contractAddress,
            currentOwner: owner,
            callingAccount: account.address
        });

        if (owner.toLowerCase() !== account.address.toLowerCase()) {
            logger.warn('Account is not the contract owner', {
                owner,
                account: account.address
            });

            // Optional: Transfer ownership
            const hash = await walletClient.writeContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'transferOwnership',
                args: [account.address]
            });

            const receipt = await publicClient.waitForTransactionReceipt({
                hash,
                confirmations: 1
            });

            logger.info('Ownership transfer completed', {
                hash,
                blockNumber: receipt.blockNumber,
                status: receipt.status
            });

            // Verify new owner
            const newOwner = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'owner'
            });

            logger.info('New ownership details', {
                newOwner,
                account: account.address
            });
        } else {
            logger.info('Account is already the contract owner');
        }

    } catch (error) {
        logger.error('Ownership verification failed', {
            error: getErrorMessage(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

main().catch(console.error);