// scripts/deployWithHardhat.js
const hre = require("hardhat");
const logger = require('../src/logger.js');
const { ADDRESSES } = require('../src/constants.js');
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

        // Get the flashloan Pool address from constants
        const balancerVaultAddress = ADDRESSES.BALANCER_V2.POOL;

        // Validate the Balancer Vault address
        if (!balancerVaultAddress || balancerVaultAddress === '0x0000000000000000000000000000000000000000') {
            throw new Error('Invalid Balancer Vault address. Please check your constants.js file.');
        }

        // Correctly import the flash loan-enabled contract
        const CrossDexArbitrageWithFlashLoan = await hre.ethers.getContractFactory("CrossDexArbitrageWithFlashLoan");

        // Deploy with Aave Pool address as constructor parameter
        logger.info('Deploying CrossDexArbitrageWithFlashLoan...', {
            balancerVaultAddress: balancerVaultAddress
        });

        const arbitrageContract = await CrossDexArbitrageWithFlashLoan.deploy(balancerVaultAddress);

        logger.info('Waiting for CrossDexArbitrageWithFlashLoan deployment transaction to be mined...');
        const receipt = await arbitrageContract.deployTransaction.wait(1); // Wait for 1 confirmation

        const deploymentTime = ((performance.now() - deploymentStartTime)/1000).toFixed(2);

        logger.info('Deployment completed successfully', {
            contractAddress: arbitrageContract.address,
            deploymentHash: arbitrageContract.deployTransaction.hash,
            network: hre.network.name,
            deploymentTime: `${deploymentTime}s`,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            balancerVaultAddress: balancerVaultAddress
        });

        // Save deployment addresses to a file for easy reference
        const deploymentInfo = {
            contractAddress: arbitrageContract.address,
            contractType: "CrossDexArbitrageWithFlashLoan",
            deploymentTime: new Date().toISOString(),
            network: hre.network.name,
            balancerVaultAddress: balancerVaultAddress
        };

        const deploymentPath = path.join(__dirname, '../deployment-info.json');
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        logger.info(`Deployment information saved to ${deploymentPath}`);

        // Output information for .env file
        logger.info('Add the following lines to your .env file:');
        logger.info(`ARBITRAGE_CONTRACT_ADDRESS=${arbitrageContract.address}`);

        return {
            contractAddress: arbitrageContract.address
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