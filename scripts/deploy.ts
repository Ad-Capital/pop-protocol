import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "RBTC");

  // Deploy MockOracle first - PredictionRegistry needs its address
  const MockOracleFactory = await ethers.getContractFactory("MockOracle");
  const oracle = await MockOracleFactory.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("MockOracle deployed to:", oracleAddress);

  // Deploy PredictionRegistry with the oracle address
  const RegistryFactory = await ethers.getContractFactory("PredictionRegistry");
  const registry = await RegistryFactory.deploy(oracleAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("PredictionRegistry deployed to:", registryAddress);

  // Set an initial BTC price on the mock oracle: $90,000
  // Scaled to 8 decimal places: 90000 * 100_000_000 = 9_000_000_000_000
  await oracle.setPrice(9_000_000_000_000n);
  console.log("Oracle price set to $90,000");

  // Save deployment addresses to a JSON file for reference and README update
  const network = await ethers.provider.getNetwork();
  const deploymentInfo = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      MockOracle: oracleAddress,
      PredictionRegistry: registryAddress,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(deploymentsDir, "deployment.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n--- Deployment Complete ---");
  console.log("MockOracle:         ", oracleAddress);
  console.log("PredictionRegistry: ", registryAddress);
  console.log("Saved to:            deployments/deployment.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
