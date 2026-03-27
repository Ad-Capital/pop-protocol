import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { PredictionRegistry, MockOracle } from "../typechain-types";

// Prices are scaled to 8 decimal places to match the oracle format.
// $90,000 = 90_000 * 100_000_000 = 9_000_000_000_000
const toPrice = (dollars: number) => BigInt(dollars) * BigInt(100_000_000);

const ONE_DAY = 24 * 60 * 60;

describe("PredictionRegistry", function () {
  let registry: PredictionRegistry;
  let oracle: MockOracle;
  let trader: any;

  // Deploy fresh contracts before each test so state never carries over
  beforeEach(async function () {
    [, trader] = await ethers.getSigners();

    const MockOracleFactory = await ethers.getContractFactory("MockOracle");
    oracle = (await MockOracleFactory.deploy()) as unknown as MockOracle;
    await oracle.waitForDeployment();

    const RegistryFactory = await ethers.getContractFactory("PredictionRegistry");
    registry = (await RegistryFactory.deploy(
      await oracle.getAddress()
    )) as unknown as PredictionRegistry;
    await registry.waitForDeployment();

    // Start at $90,000 - neutral entry price for all tests
    await oracle.setPrice(toPrice(90_000));
  });

  // Post a long call: entry ~$90k, TP $95k, SL $85k, expires in 7 days
  async function postLongCall() {
    const expiry = (await time.latest()) + ONE_DAY * 7;
    return registry
      .connect(trader)
      .postCall(true, toPrice(95_000), toPrice(85_000), expiry);
  }

  // Post a short call: entry ~$90k, TP $85k, SL $95k, expires in 7 days
  async function postShortCall() {
    const expiry = (await time.latest()) + ONE_DAY * 7;
    return registry
      .connect(trader)
      .postCall(false, toPrice(85_000), toPrice(95_000), expiry);
  }

  // Helper: trigger 5 calls with 1 hit and 4 misses to force a pause
  async function pauseTrader() {
    await postLongCall();
    await oracle.setPrice(toPrice(95_000));
    await registry.resolve(0); // Hit

    for (let i = 1; i <= 4; i++) {
      await oracle.setPrice(toPrice(90_000));
      await postLongCall();
      await oracle.setPrice(toPrice(85_000));
      await registry.resolve(i); // Miss
    }
  }

  // postCall

  describe("postCall", function () {
    it("emits CallPosted with correct fields", async function () {
      const expiry = (await time.latest()) + ONE_DAY;

      await expect(
        registry
          .connect(trader)
          .postCall(true, toPrice(95_000), toPrice(85_000), expiry)
      )
        .to.emit(registry, "CallPosted")
        .withArgs(
          0,                  // first call gets ID 0
          trader.address,     // trader who posted
          true,               // isLong
          toPrice(90_000),    // entryPrice captured from oracle at post time
          toPrice(95_000),    // takeProfit
          toPrice(85_000),    // stopLoss
          expiry,             // maxExpiry
          anyValue            // postedAt - block timestamp, checked loosely
        );
    });

    it("increments callCount after each post", async function () {
      await postLongCall();
      await postLongCall();
      expect(await registry.callCount()).to.equal(2);
    });

    it("reverts when expiry is in the past", async function () {
      const pastExpiry = (await time.latest()) - 1;
      await expect(
        registry
          .connect(trader)
          .postCall(true, toPrice(95_000), toPrice(85_000), pastExpiry)
      ).to.be.revertedWith("Expiry must be in the future");
    });

    it("reverts when trader is paused", async function () {
      await pauseTrader();

      await oracle.setPrice(toPrice(90_000));
      const expiry = (await time.latest()) + ONE_DAY;

      await expect(
        registry
          .connect(trader)
          .postCall(true, toPrice(95_000), toPrice(85_000), expiry)
      ).to.be.revertedWith("Trader is paused");
    });
  });

  // resolve - long calls

  describe("resolve (long)", function () {
    beforeEach(postLongCall);

    it("marks Hit when price reaches take profit", async function () {
      await oracle.setPrice(toPrice(95_000));
      await registry.resolve(0);

      const call = await registry.calls(0);
      expect(call.status).to.equal(1); // CallStatus.Hit
    });

    it("marks Miss when price hits stop loss", async function () {
      await oracle.setPrice(toPrice(85_000));
      await registry.resolve(0);

      const call = await registry.calls(0);
      expect(call.status).to.equal(2); // CallStatus.Miss
    });

    it("reverts when price has not crossed either level yet", async function () {
      // Price stays at $90k - between TP and SL, nothing to resolve
      await expect(registry.resolve(0)).to.be.revertedWith(
        "Price has not crossed TP or SL yet"
      );
    });

    it("marks Expired after maxExpiry passes", async function () {
      await time.increase(ONE_DAY * 8); // jump past the 7-day window
      await registry.resolve(0);

      const call = await registry.calls(0);
      expect(call.status).to.equal(3); // CallStatus.Expired
    });

    it("reverts on a second resolve attempt", async function () {
      await oracle.setPrice(toPrice(95_000));
      await registry.resolve(0);

      await expect(registry.resolve(0)).to.be.revertedWith(
        "Call already resolved"
      );
    });

    it("reverts for a call ID that does not exist", async function () {
      await expect(registry.resolve(999)).to.be.revertedWith(
        "Call does not exist"
      );
    });
  });

  // resolve - short calls

  describe("resolve (short)", function () {
    // Short: TP = $85k (price goes down), SL = $95k (price goes up)
    beforeEach(postShortCall);

    it("marks Hit when price falls to take profit", async function () {
      await oracle.setPrice(toPrice(85_000));
      await registry.resolve(0);

      const call = await registry.calls(0);
      expect(call.status).to.equal(1); // Hit
    });

    it("marks Miss when price rises to stop loss", async function () {
      await oracle.setPrice(toPrice(95_000));
      await registry.resolve(0);

      const call = await registry.calls(0);
      expect(call.status).to.equal(2); // Miss
    });
  });

  // events

  describe("events", function () {
    it("emits CallResolved with correct fields on hit", async function () {
      await postLongCall();
      await oracle.setPrice(toPrice(95_000));

      await expect(registry.resolve(0))
        .to.emit(registry, "CallResolved")
        .withArgs(
          0,              // callId
          trader.address, // trader
          true,           // hit
          toPrice(95_000),// resolvedPrice
          anyValue        // resolvedAt timestamp
        );
    });
  });

  // trader stats and auto-pause

  describe("trader stats", function () {
    it("updates totalCalls and hitCount after a hit", async function () {
      await postLongCall();
      await oracle.setPrice(toPrice(95_000));
      await registry.resolve(0);

      const stats = await registry.getTraderStats(trader.address);
      expect(stats.totalCalls).to.equal(1);
      expect(stats.hitCount).to.equal(1);
    });

    it("updates totalCalls but not hitCount after a miss", async function () {
      await postLongCall();
      await oracle.setPrice(toPrice(85_000));
      await registry.resolve(0);

      const stats = await registry.getTraderStats(trader.address);
      expect(stats.totalCalls).to.equal(1);
      expect(stats.hitCount).to.equal(0);
    });

    it("does not pause trader with fewer than 5 calls", async function () {
      // 0 hits out of 4 calls = 0% hit rate, but MIN_CALLS_BEFORE_PAUSE is 5
      for (let i = 0; i < 4; i++) {
        await postLongCall();
        await oracle.setPrice(toPrice(85_000));
        await registry.resolve(i);
        await oracle.setPrice(toPrice(90_000));
      }

      expect(await registry.isPaused(trader.address)).to.be.false;
    });

    it("pauses trader when hit rate drops below 40% after 5 calls", async function () {
      // 1 hit + 4 misses = 20% hit rate - below the 40% threshold
      await pauseTrader();
      expect(await registry.isPaused(trader.address)).to.be.true;
    });

    it("emits TraderPaused when auto-pause triggers", async function () {
      await postLongCall();
      await oracle.setPrice(toPrice(95_000));
      await registry.resolve(0); // Hit 1

      for (let i = 1; i <= 3; i++) {
        await oracle.setPrice(toPrice(90_000));
        await postLongCall();
        await oracle.setPrice(toPrice(85_000));
        await registry.resolve(i); // Misses 1-3
      }

      // 5th call - this resolution triggers the pause
      await oracle.setPrice(toPrice(90_000));
      await postLongCall();
      await oracle.setPrice(toPrice(85_000));

      await expect(registry.resolve(4)).to.emit(registry, "TraderPaused");
    });
  });
});
