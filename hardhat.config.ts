import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomicfoundation/hardhat-verify";

dotenv.config();

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY as string;
const rootstockRpcUrl =
  process.env.ROOTSTOCK_RPC_URL || "https://rpc.testnet.rootstock.io";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {},
    rootstockTestnet: {
      url: rootstockRpcUrl,
      accounts: [deployerPrivateKey],
      chainId: 31,
    },
  },
  etherscan: {
    enabled: false,
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api.rootstock.io",
    browserUrl: "https://explorer.testnet.rootstock.io"
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
