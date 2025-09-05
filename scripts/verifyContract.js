// scripts/verifyContract.js
const { createPublicClient, http } = require('viem');
const { avalanche } = require('viem/chains');
const logger = require('../src/logger.js');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
    try {
        // Get the contract address from .env
        const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
        if (!contractAddress) {
            throw new Error('ARBITRAGE_CONTRACT_ADDRESS not set in .env file');
        }

        logger.info('Verifying contract deployment', {
            contractAddress
        });

        // Configure client
        const publicClient = createPublicClient({
            chain: avalanche,
            transport: http(process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc')
        });

        // First, check if the address has code (is a contract)
        const bytecode = await publicClient.getBytecode({
            address: contractAddress
        });

        if (!bytecode || bytecode === '0x') {
            logger.error('No contract found at the specified address', {
                contractAddress
            });
            return;
        }

        logger.info('Contract exists at the specified address', {
            contractAddress,
            bytecodeLength: bytecode.length
        });

        // Try to call a simple view function to see if it's our contract
        // Try with a minimal ABI that should be present in our contract
        const minimalAbi = [
            {
                "inputs": [],
                "name": "paused",
                "outputs": [{ "name": "", "type": "bool" }],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "owner",
                "outputs": [{ "name": "", "type": "address" }],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "MAX_BPS",
                "outputs": [{ "name": "", "type": "uint256" }],
                "stateMutability": "view",
                "type": "function"
            }
        ];

        // Try multiple functions to increase chances of success
        try {
            const isPaused = await publicClient.readContract({
                address: contractAddress,
                abi: minimalAbi,
                functionName: 'paused'
            });
            logger.info('Contract paused state', { isPaused });
        } catch (error) {
            logger.warn('Cannot call paused() function - might not be our contract', {
                error: error.message
            });
        }

        try {
            const maxBps = await publicClient.readContract({
                address: contractAddress,
                abi: minimalAbi,
                functionName: 'MAX_BPS'
            });
            logger.info('Contract MAX_BPS', { maxBps: maxBps.toString() });
        } catch (error) {
            logger.warn('Cannot call MAX_BPS() function - might not be our contract', {
                error: error.message
            });
        }

        try {
            const owner = await publicClient.readContract({
                address: contractAddress,
                abi: minimalAbi,
                functionName: 'owner'
            });
            logger.info('Contract owner', { owner });
        } catch (error) {
            logger.warn('Cannot call owner() function - might not be our contract', {
                error: error.message
            });
        }

        // Check deployment-info.json file if it exists
        const fs = require('fs');
        const path = require('path');
        const deploymentPath = path.join(__dirname, '../deployment-info.json');

        if (fs.existsSync(deploymentPath)) {
            const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
            logger.info('Found deployment info file', {
                deployedContract: deploymentInfo.contractAddress,
                libraryAddress: deploymentInfo.libraryAddress,
                deploymentTime: deploymentInfo.deploymentTime,
                matchesEnvFile: deploymentInfo.contractAddress === contractAddress
            });

            if (deploymentInfo.contractAddress !== contractAddress) {
                logger.warn('Contract address in .env does not match deployment-info.json!', {
                    envAddress: contractAddress,
                    deploymentAddress: deploymentInfo.contractAddress
                });
            }
        } else {
            logger.warn('No deployment-info.json file found');
        }

    } catch (error) {
        logger.error('Verification failed', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

main().catch(console.error);