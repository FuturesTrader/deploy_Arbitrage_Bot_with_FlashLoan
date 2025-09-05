// scripts/deployWithHardhat.js
const hre = require("hardhat");
const logger = require('../src/logger.js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
    try {
        const deploymentStartTime = performance.now();

        // Log which network we're deploying to
        logger.info(`Deploying to network: ${hre.network.name}`);
        if (hre.network.name === 'hardhat') {
            logger.warn('WARNING: You are deploying to the local hardhat network!');
            logger.warn('The contract will NOT be available on Avalanche mainnet.');
            logger.warn('To deploy to Avalanche, use: npx hardhat run scripts/deployWithHardhat.js --network avalanche');
        }

        logger.info('Starting CrossDexArbitrage deployment with proper library linking');

        // 1. Deploy ArbitrageUtils library first
        logger.info('Deploying ArbitrageUtils library...');
        const ArbitrageUtils = await hre.ethers.getContractFactory("ArbitrageUtils");
        const arbitrageUtils = await ArbitrageUtils.deploy();

        logger.info('Waiting for ArbitrageUtils deployment transaction to be mined...');
        await arbitrageUtils.deployTransaction.wait(1); // Wait for 1 confirmations

        logger.info('ArbitrageUtils library deployed successfully', {
            libraryAddress: arbitrageUtils.address,
            transactionHash: arbitrageUtils.deployTransaction.hash
        });

        // 2. Link the library to the main contract and deploy it
        logger.info('Linking ArbitrageUtils to CrossDexArbitrage...');
        const CrossDexArbitrage = await hre.ethers.getContractFactory("CrossDexArbitrage", {
            libraries: {
                ArbitrageUtils: arbitrageUtils.address
            }
        });

        // Deploy without arguments
        logger.info('Deploying CrossDexArbitrage...');
        const crossDexArbitrage = await CrossDexArbitrage.deploy();

        logger.info('Waiting for CrossDexArbitrage deployment transaction to be mined...');
        const receipt = await crossDexArbitrage.deployTransaction.wait(1); // Wait for 1 confirmations

        const deploymentTime = ((performance.now() - deploymentStartTime)/1000).toFixed(2);

        // No need to call updateTradeSettings anymore as it's been removed

        logger.info('Deployment completed successfully', {
            libraryAddress: arbitrageUtils.address,
            contractAddress: crossDexArbitrage.address,
            deploymentHash: crossDexArbitrage.deployTransaction.hash,
            network: hre.network.name,
            deploymentTime: `${deploymentTime}s`,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });

        // 3. Save deployment addresses to a file for easy reference
        const deploymentInfo = {
            libraryAddress: arbitrageUtils.address,
            contractAddress: crossDexArbitrage.address,
            deploymentTime: new Date().toISOString(),
            network: hre.network.name
        };

        const deploymentPath = path.join(__dirname, '../deployment-info.json');
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        logger.info(`Deployment information saved to ${deploymentPath}`);

        // 4. Output information for .env file
        logger.info('Add the following lines to your .env file:');
        logger.info(`ARBITRAGE_CONTRACT_ADDRESS=${crossDexArbitrage.address}`);
        logger.info(`ARBITRAGE_UTILS_ADDRESS=${arbitrageUtils.address}`);

        return {
            libraryAddress: arbitrageUtils.address,
            contractAddress: crossDexArbitrage.address
        };
    } catch (error) {
        logger.error('Deployment failed', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Run the deployment
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { deploy: main };