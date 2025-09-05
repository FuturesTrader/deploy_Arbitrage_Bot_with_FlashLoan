// scripts/configureFlashLoan.js
const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { ADDRESSES } = require('../src/constants.js');
const { ARBITRAGE_ABI } = require('../src/services/constants/arbitrageAbi.js');
const { getErrorMessage } = require('../src/utils.js');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();
// Use Balancer V3 Vault address for flash loans (0% fee)
const BALANCER_VAULT = ADDRESSES.BALANCER_V2.POOL;
const FLASH_LOAN_FEE_BPS = ADDRESSES.BALANCER_V2.FLASH_LOAN_BPS;

async function main() {
    try {
        // Check for required environment variables
        if (!process.env.PRIVATE_KEY || !process.env.ARBITRAGE_CONTRACT_ADDRESS || !process.env.AVALANCHE_RPC_URL) {
            throw new Error('Missing required environment variables (PRIVATE_KEY, ARBITRAGE_CONTRACT_ADDRESS, or AVALANCHE_RPC_URL)');
        }

        // Ensure private key is properly formatted
        const privateKey = process.env.PRIVATE_KEY.startsWith('0x')
            ? process.env.PRIVATE_KEY
            : `0x${process.env.PRIVATE_KEY}`;

        // Create account from private key
        const account = privateKeyToAccount(privateKey);
        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;

        // Create transport and clients
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

        // Log the configuration attempt
        logger.info('Verifying Balancer V3 Vault configuration on contract', {
            contractAddress,
            walletAddress: account.address,
            balancerVaultAddress: BALANCER_VAULT
        });

        // Verify current configuration
        await verifyConfiguration(publicClient, contractAddress);

        // If configuration needs to be updated, it would be done here
        // But for Balancer, the vault address is set during contract deployment
        // and cannot be changed, so we just verify it instead

        logger.info('Balancer V3 Vault configuration verification complete', {
            contractAddress,
            balancerVaultAddress: BALANCER_VAULT,
            flashLoanFeeBps: FLASH_LOAN_FEE_BPS
        });

    } catch (error) {
        logger.error('Failed to verify Balancer V3 configuration', {
            error: error instanceof Error ? error.message : String(error),
            errorDetails: error instanceof Error ? error.stack : 'Unknown error'
        });
        process.exit(1);
    }
}

// Helper function to verify the configuration was successful
async function verifyConfiguration(publicClient, contractAddress) {
    try {
        // Read the flash loan configuration from the contract
        const [configuredVaultAddress, currentFeeBps] = await publicClient.readContract({
            address: contractAddress,
            abi: ARBITRAGE_ABI,
            functionName: 'verifyFlashLoanConfiguration'
        });

        logger.info('Balancer V3 Vault configuration verification', {
            configuredVaultAddress: configuredVaultAddress,
            expectedVaultAddress: BALANCER_VAULT,
            currentFeeBps: Number(currentFeeBps),
            expectedFeeBps: FLASH_LOAN_FEE_BPS
        });

        // Detailed logging of each configuration check
        logger.debug('Configuration Checks', {
            vaultAddressCheck: configuredVaultAddress.toLowerCase() === BALANCER_VAULT.toLowerCase(),
            feeCheck: Number(currentFeeBps) === FLASH_LOAN_FEE_BPS
        });

        // Verify vault address
        if (configuredVaultAddress.toLowerCase() !== BALANCER_VAULT.toLowerCase()) {
            logger.warn('Vault address mismatch', {
                configuredVaultAddress,
                expectedVaultAddress: BALANCER_VAULT,
                note: 'The Balancer Vault address is set during contract deployment and cannot be changed.'
            });
        } else {
            logger.info('Balancer Vault address correctly configured');
        }

        // Verify fee BPS
        if (Number(currentFeeBps) !== FLASH_LOAN_FEE_BPS) {
            logger.warn('Fee BPS mismatch', {
                currentFeeBps: Number(currentFeeBps),
                expectedFeeBps: FLASH_LOAN_FEE_BPS,
                note: 'Balancer V3 flash loans have 0% fee.'
            });
        } else {
            logger.info('Balancer flash loan fee correctly configured (0%)');
        }

        // Additional contract verification if needed
        // Get contract statistics to ensure the contract is properly functioning
        try {
            const stats = await publicClient.readContract({
                address: contractAddress,
                abi: ARBITRAGE_ABI,
                functionName: 'getContractStats'
            });

            if (stats) {
                logger.info('Contract statistics retrieved successfully', {
                    totalTrades: Number(stats[0]),
                    successfulTrades: Number(stats[1]),
                    failedTrades: Number(stats[2]),
                    successRate: Number(stats[3]) / 100, // Convert BPS to percentage
                    cumulativeProfit: stats[4].toString()
                });
            }
        } catch (statsError) {
            logger.warn('Unable to retrieve contract statistics', {
                error: getErrorMessage(statsError)
            });
        }

        return {
            vaultAddressCorrect: configuredVaultAddress.toLowerCase() === BALANCER_VAULT.toLowerCase(),
            feeBpsCorrect: Number(currentFeeBps) === FLASH_LOAN_FEE_BPS
        };
    } catch (error) {
        logger.error('Error verifying configuration', {
            error: getErrorMessage(error)
        });
        throw error;
    }
}

// Run the main function
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { verifyBalancerConfig: main };